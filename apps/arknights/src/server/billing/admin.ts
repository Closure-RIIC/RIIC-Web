import "@tanstack/react-start/server-only";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getDatabasePool } from "@riic/platform-server/db";
import { compileFilterPolicy, parseFilterPolicy } from "../agent/filter-policy.ts";
import { ensureAgentFilterPolicy, billingTransaction } from "./agent-accounting.ts";
import { SUPPLEMENTAL_MODEL_ID, SUPPLEMENTAL_MODEL_PROVIDER, createRatePolicyDraft, parseRatePolicy, findModelRate, type RatePolicy } from "./rate-policy.ts";
import { configuredAgentChoices, selectAgentModel } from "../agent/model-catalog.ts";
import { defaultModelPolicy, parseModelPolicy, type AgentModelPolicy } from "../agent/model-policy.ts";
import { AGENT_MODEL_IDS, AGENT_MODELS } from "../../agent-models.ts";
import { agentLlmSettings } from "../agent/config.ts";
import { parseResourcePolicy } from "../agent/resource-policy.ts";
import { adminModelDirectory } from "../agent/admin-models.ts";
import { sumPoints, validPoints } from "./points.ts";
import { MIN_POINT_AMOUNT } from "../../billing-points.ts";
import type { AgentModelSettingsPayload, AgentModelSettingsVersion, ModelSettingsData } from "../../agent-model-settings.ts";
import type { BillingModelStats } from "../../billing-model-stats.ts";

export class BillingAdminError extends Error {}
function numericBillingFields(row: Record<string, unknown>) {
  for (const key of ["points", "points_delta", "paid_points", "monthly_points", "held_paid_points", "held_monthly_points",
    "paid_points_after", "monthly_points_after", "held_paid", "held_monthly", "charged_points", "budget_points",
    "upstream_cost_rmb_fen", "charged_cost_rmb_fen"]) {
    if (row[key] != null) row[key] = Number(row[key]);
  }
  return row;
}
function field(value: unknown, name: string, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new BillingAdminError(`${name}不能为空，且不能超过 ${max} 字符。`);
  return value.trim();
}
async function audit(client: PoolClient, actor: string, action: string, target: string, reason: string, key: string, details: unknown) {
  await client.query(`INSERT INTO app.billing_admin_audit (id,actor_id,action,target,reason,idempotency_key,details) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [randomUUID(), actor, action, target, reason, key, JSON.stringify(details)]);
}
export async function billingOverview(from: Date, to: Date) {
  const pool = getDatabasePool();
  const [usage, orders, wallet, exceptions, series, modelStats] = await Promise.all([
    pool.query(`SELECT count(*)::int AS runs,coalesce(sum(points),0)::text AS points,
      count(*) FILTER (WHERE upstream_cost_rmb_fen IS NULL)::int AS unknown_cost_runs,
      (coalesce(sum(upstream_cost_rmb_fen) FILTER (WHERE coalesce(metadata->>'billingVersion','') NOT IN ('4','5')),0)
        +coalesce((SELECT sum(upstream_rmb)*100 FROM app.agent_model_call WHERE created_at >= $1 AND created_at < $2),0))::text AS known_cost_fen
      FROM app.agent_usage WHERE created_at >= $1 AND created_at < $2`, [from, to]),
    pool.query(`SELECT count(*)::int AS paid_orders,coalesce(sum(amount_fen),0)::text AS paid_fen FROM app.billing_order WHERE status='paid' AND paid_at >= $1 AND paid_at < $2`, [from, to]),
    pool.query(`SELECT coalesce(sum(paid_points),0)::text AS paid_points,
      coalesce(sum(CASE WHEN monthly_expires_at > now() THEN monthly_points ELSE 0 END),0)::text AS monthly_points,
      coalesce(sum(held_paid_points+held_monthly_points),0)::text AS reserved_points FROM app.billing_wallet`),
    pool.query("SELECT count(*)::int AS open_reviews FROM app.billing_review WHERE status='open'"),
    pool.query(`SELECT (created_at AT TIME ZONE 'Asia/Shanghai')::date::text AS day,count(*)::int AS runs,
      sum(points)::text AS points,count(*) FILTER (WHERE upstream_cost_rmb_fen IS NULL)::int AS unknown_cost_runs,
      sum(upstream_cost_rmb_fen)::text AS known_cost_fen FROM app.agent_usage WHERE created_at >= $1 AND created_at < $2 GROUP BY 1 ORDER BY 1`, [from, to]),
    billingModelStats("c.created_at >= $1 AND c.created_at < $2", [from, to]),
  ]);
  return { ...usage.rows[0], ...orders.rows[0], ...wallet.rows[0], ...exceptions.rows[0], series: series.rows, modelStats };
}
export function billingRange(params: URLSearchParams) {
  const to = params.get("to") ? new Date(params.get("to")!) : new Date();
  const from = params.get("from") ? new Date(params.get("from")!) : new Date(to.getTime() - 30 * 86400_000);
  if (!Number.isFinite(+from) || !Number.isFinite(+to) || +from >= +to || +to - +from > 366 * 86400_000) throw new BillingAdminError("日期范围应在一年以内。");
  return { from, to };
}
const actualRateJoin = `LEFT JOIN LATERAL (
  SELECT rate FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.policy->'models')='array' THEN r.policy->'models' ELSE '[]'::jsonb END) rate
  WHERE rate->>'provider'=c.provider AND rate->>'model'=c.model LIMIT 1
) actual_rate ON true`;
const pricingTierSql = `CASE WHEN c.input_tokens IS NULL OR actual_rate.rate IS NULL THEN NULL
  WHEN c.input_tokens::numeric > CASE WHEN (actual_rate.rate->'longContext'->>'inputTokenThreshold') ~ '^[0-9]+$'
    THEN (actual_rate.rate->'longContext'->>'inputTokenThreshold')::numeric ELSE NULL END THEN 'long-context'
  ELSE 'base' END`;
const listings = {
  usage: { from: `(SELECT coalesce(u.id,r.id) AS id,coalesce(u.user_id,r.user_id) AS user_id,coalesce(r.id,u.run_id) AS run_id,
    coalesce(u.tool_name,'agent_chat') AS tool_name,coalesce(r.state,u.status) AS status,coalesce(r.settlement,'legacy') AS settlement,coalesce(u.points,r.charged_points) AS points,
    u.input_tokens,u.output_tokens,u.cached_input_tokens,u.cache_write_tokens,u.upstream_cost_rmb_fen,u.charged_cost_rmb_fen,
    coalesce(r.created_at,u.created_at) AS created_at,u.metadata,
    r.model_selection->>'id' AS selected_model_id,r.model_selection->>'label' AS selected_model_label,
    coalesce((SELECT jsonb_agg(jsonb_build_object('provider',actual.provider,'model',actual.model) ORDER BY actual.provider,actual.model)
      FROM (SELECT DISTINCT c.provider,c.model FROM app.agent_model_call c WHERE c.run_id=r.id AND (c.provider IS NOT NULL OR c.model IS NOT NULL)) actual),'[]'::jsonb) AS actual_models
    FROM app.agent_usage u FULL JOIN app.agent_run r ON r.id=u.id) t`, select: "t.*", q: "t.id || ' ' || coalesce(t.run_id,'') || ' ' || coalesce(t.user_id,'') || ' ' || coalesce(t.selected_model_id,'') || ' ' || coalesce(t.selected_model_label,'') || ' ' || t.actual_models::text", status: "t.status", time: "t.created_at" },
  wallets: { from: 'app.billing_wallet t JOIN public."user" u ON u.id=t.user_id', select: "t.user_id,u.name,u.email,t.paid_points,t.monthly_points,t.monthly_expires_at,t.held_paid_points,t.held_monthly_points,t.updated_at", q: "t.user_id || ' ' || u.name || ' ' || u.email", status: "''", time: "t.updated_at" },
  ledger: { from: "app.billing_ledger t", select: "t.*", q: "t.id || ' ' || t.user_id || ' ' || coalesce(t.reference_id,'')", status: "t.kind", time: "t.created_at" },
  orders: { from: "app.billing_order t", select: "t.id,t.user_id,t.product_id,t.provider,t.status,t.amount_fen,t.points,t.custom_order_id,t.provider_order_id,t.created_at,t.paid_at", q: "t.id || ' ' || t.user_id || ' ' || t.custom_order_id || ' ' || coalesce(t.provider_order_id,'')", status: "t.status", time: "t.created_at" },
  reviews: { from: "app.billing_review t", select: "t.*", q: "t.id || ' ' || coalesce(t.run_id,'') || ' ' || coalesce(t.evidence->>'trade','') || ' ' || coalesce(t.evidence->>'customOrderId','')", status: "t.status", time: "t.created_at" },
  audit: { from: "app.billing_admin_audit t", select: "t.*", q: "t.id || ' ' || t.target || ' ' || coalesce(t.actor_id,'')", status: "t.action", time: "t.created_at" },
  filters: { from: "app.agent_filter_event t", select: "t.*", q: "t.request_id || ' ' || coalesce(t.user_id,'')", status: "t.stage", time: "t.created_at" },
  attempts: { from: `(SELECT g.*,c.run_id,r.user_id,
    CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id',c.id,'status',c.status,'provider',c.provider,'model',c.model,
      'inputTokens',c.input_tokens,'cachedInputTokens',c.cached_input_tokens,'cacheWriteTokens',c.cache_write_tokens,'outputTokens',c.output_tokens,
      'upstreamRmb',c.upstream_rmb::text,'chargedRmb',c.charged_rmb::text,'pricingTier',${pricingTierSql}) END AS related_call
    FROM app.agent_gateway_usage g LEFT JOIN app.agent_model_call c ON c.id=g.call_id LEFT JOIN app.agent_run r ON r.id=c.run_id ${actualRateJoin}) t`,
    select: "t.*", q: "t.id || ' ' || coalesce(t.call_id,'') || ' ' || coalesce(t.session_id,'') || ' ' || coalesce(t.user_id,'') || ' ' || coalesce(t.provider,'') || ' ' || coalesce(t.model,'')", status: "t.provider", time: "t.created_at" },
} as const;
function listingFilter(section: keyof typeof listings, params: URLSearchParams, range = billingRange(params)) {
  const config = listings[section];
  const q = (params.get("q") ?? "").trim().slice(0, 200); const status = (params.get("status") ?? "").slice(0, 80);
  return { where: `WHERE ($1='' OR (${config.q}) ILIKE '%' || $1 || '%') AND ($2='' OR ${config.status}=$2)
    AND ($5 OR (${config.time} >= $3 AND ${config.time} < $4))`, values: [q, status, range.from, range.to, section === "wallets"] };
}
async function billingModelStats(predicate: string, values: unknown[]): Promise<BillingModelStats[]> {
  const { rows } = await getDatabasePool().query(`SELECT c.provider,c.model,count(*)::int AS calls,
    sum(c.input_tokens)::text AS input_tokens,sum(c.cached_input_tokens)::text AS cached_input_tokens,sum(c.output_tokens)::text AS output_tokens,
    CASE WHEN count(c.cache_write_tokens)=count(*) THEN sum(c.cache_write_tokens)::text ELSE NULL END AS cache_write_tokens,
    sum(c.upstream_rmb)::text AS upstream_rmb,sum(c.charged_rmb)::text AS charged_rmb,
    count(*) FILTER (WHERE (${pricingTierSql})='long-context')::int AS long_context_calls,
    count(*) FILTER (WHERE c.input_tokens IS NULL OR c.cached_input_tokens IS NULL OR c.output_tokens IS NULL)::int AS unknown_usage_calls,
    count(*) FILTER (WHERE c.upstream_rmb IS NULL OR c.charged_rmb IS NULL)::int AS unknown_cost_calls,
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM app.billing_review review WHERE review.run_id=r.id AND review.status='open'
        AND (review.evidence->>'callId'=c.id OR review.kind='settlement')))::int AS pending_review_calls
    FROM app.agent_model_call c JOIN app.agent_run r ON r.id=c.run_id ${actualRateJoin}
    WHERE ${predicate} GROUP BY c.provider,c.model ORDER BY c.provider NULLS LAST,c.model NULLS LAST`, values);
  return rows.map(row => {
    const modelId = AGENT_MODEL_IDS.find(id => AGENT_MODELS[id].provider === row.provider) ?? null;
    return { modelId, label: modelId ? AGENT_MODELS[modelId].label : row.model, provider: row.provider, model: row.model,
      calls: row.calls, inputTokens: row.input_tokens, cachedInputTokens: row.cached_input_tokens, cacheWriteTokens: row.cache_write_tokens, outputTokens: row.output_tokens,
      knownUpstreamRmb: row.upstream_rmb, knownChargedRmb: row.charged_rmb, longContextCalls: row.long_context_calls,
      unknownUsageCalls: row.unknown_usage_calls, unknownCostCalls: row.unknown_cost_calls, pendingReviewCalls: row.pending_review_calls };
  });
}
export async function listBilling(section: string, params: URLSearchParams) {
  if (!(section in listings)) throw new BillingAdminError("未知记录类型。");
  const config = listings[section as keyof typeof listings];
  const page = Number(params.get("page") || "1");
  if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) throw new BillingAdminError("页码无效。");
  const { where, values } = listingFilter(section as keyof typeof listings, params);
  const pool = getDatabasePool();
  const [rows, count, modelStats] = await Promise.all([
    pool.query(`SELECT ${config.select} FROM ${config.from} ${where} ORDER BY ${config.time} DESC LIMIT 25 OFFSET $6`, [...values, (page - 1) * 25]),
    pool.query(`SELECT count(*)::int AS total FROM ${config.from} ${where}`, values),
    section === "usage" || section === "attempts" ? billingModelStats(section === "usage"
      ? `c.run_id IN (SELECT t.run_id FROM ${config.from} ${where})`
      : `c.id IN (SELECT t.call_id FROM ${config.from} ${where})`, values) : Promise.resolve(undefined),
  ]);
  return { rows: rows.rows.map(numericBillingFields), total: count.rows[0].total, page, pages: Math.max(1, Math.ceil(count.rows[0].total / 25)), ...(modelStats ? { modelStats } : {}) };
}
export async function billingRunDetail(id: string) {
  const pool = getDatabasePool();
  const [runs, calls, tools, ledger, reviews] = await Promise.all([
    pool.query("SELECT * FROM app.agent_run WHERE id=$1", [id]),
    pool.query(`SELECT c.*,${pricingTierSql} AS pricing_tier FROM app.agent_model_call c JOIN app.agent_run r ON r.id=c.run_id ${actualRateJoin} WHERE c.run_id=$1 ORDER BY c.step`, [id]),
    pool.query("SELECT * FROM app.agent_tool_charge WHERE run_id=$1 ORDER BY created_at", [id]),
    pool.query("SELECT * FROM app.billing_ledger WHERE reference_id=$1 ORDER BY created_at", [id]),
    pool.query("SELECT * FROM app.billing_review WHERE run_id=$1 ORDER BY created_at", [id]),
  ]);
  return { run: runs.rows[0] ? numericBillingFields(runs.rows[0]) : null, calls: calls.rows.map(numericBillingFields), tools: tools.rows, ledger: ledger.rows.map(numericBillingFields), reviews: reviews.rows };
}
export async function adjustBilling(actor: string, input: unknown) {
  const body = input as Record<string, unknown>;
  const userId = field(body?.userId, "用户 ID"); const reason = field(body.reason, "操作原因", 500);
  const key = field(body.idempotencyKey, "操作 ID", 128); const action = field(body.action, "操作");
  const points = Number(body.points);
  if (!["credit", "debit", "refund"].includes(action) || !validPoints(points) || points < MIN_POINT_AMOUNT || points > 100_000) throw new BillingAdminError("积分必须在 0.0001–100000 之间，最多保留 4 位小数。");
  const referenceId = action === "refund" ? field(body.referenceId, "原扣费流水 ID") : null;
  const providerOrderId = body.providerOrderId ? field(body.providerOrderId, "爱发电交易号", 128) : null;
  if (providerOrderId && action !== "credit") throw new BillingAdminError("爱发电付款关联仅用于补入永久积分。");
  const fingerprint = createHash("sha256").update(JSON.stringify({ userId, reason, action, points, referenceId, ...(providerOrderId ? { providerOrderId } : {}) })).digest("hex");
  return billingTransaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`admin-billing:${key}`]);
    const prior = await client.query("SELECT details FROM app.billing_admin_audit WHERE idempotency_key=$1", [key]);
    if (prior.rowCount) {
      if (prior.rows[0].details.fingerprint !== fingerprint) throw new BillingAdminError("相同操作 ID 不能用于不同操作。");
      return { ...prior.rows[0].details, duplicate: true };
    }
    let paymentId: string | null = null;
    if (providerOrderId) {
      const payment = (await client.query("SELECT id,status,provider_status FROM app.billing_payment WHERE provider='afdian' AND provider_order_id=$1 FOR UPDATE", [providerOrderId])).rows[0];
      if (!payment || payment.provider_status !== 2 || payment.status !== "review") throw new BillingAdminError("只能补入已核验且待对账的付款，已处理付款不能重复补入。");
      paymentId = payment.id;
    }
    if (!(await client.query('SELECT id FROM public."user" WHERE id=$1', [userId])).rowCount) throw new BillingAdminError("用户不存在。");
    await client.query("INSERT INTO app.billing_wallet (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
    const wallet = (await client.query("SELECT * FROM app.billing_wallet WHERE user_id=$1 FOR UPDATE", [userId])).rows[0];
    for (const key of ["paid_points", "monthly_points", "held_paid_points", "held_monthly_points"]) wallet[key] = Number(wallet[key]);
    let paid = action === "debit" ? -points : points; let monthly = 0; let expiredPoints = 0;
    let monthlyExpiresAt = wallet.monthly_expires_at;
    if (action === "refund") {
      const original = (await client.query("SELECT * FROM app.billing_ledger WHERE id=$1 AND user_id=$2 FOR UPDATE", [referenceId, userId])).rows[0];
      if (!original || original.points_delta >= 0 || !["agent_settlement", "admin_debit", "agent_tool", "agent_token", "token_settlement", "tool_charge"].includes(original.kind)) throw new BillingAdminError("仅支持退还有明确扣费依据的消费流水。");
      if (original.kind === "tool_charge" && (await client.query("SELECT id FROM app.billing_ledger WHERE kind='tool_refund' AND reference_type='agent_usage' AND reference_id=$1", [original.reference_id])).rowCount) throw new BillingAdminError("失败工具的积分已自动退还，不能重复退款。");
      const refunds = (await client.query("SELECT coalesce(sum((metadata->>'requestedPoints')::numeric),0) AS points,coalesce(sum((metadata->>'paidPoints')::numeric),0) AS paid FROM app.billing_ledger WHERE kind='admin_refund' AND reference_id=$1", [referenceId])).rows[0];
      if (sumPoints(points, refunds.points) > -original.points_delta) throw new BillingAdminError("累计退还积分不能超过原扣费积分。");
      const meta = original.metadata ?? {};
      if (!validPoints(meta.paidPoints) || !validPoints(meta.monthlyPoints)) throw new BillingAdminError("旧流水缺少分桶依据，需先通过对账确认，不能自动退还。");
      paid = Math.min(points, Math.max(0, sumPoints(meta.paidPoints, -Number(refunds.paid)))); monthly = sumPoints(points, -paid);
      if (monthly) {
        const expiry = meta.monthlyExpiresAt ? new Date(meta.monthlyExpiresAt) : null;
        if (!expiry || !Number.isFinite(+expiry)) throw new BillingAdminError("原月卡有效期缺失，不能自动退还。");
        if (+expiry <= Date.now()) { expiredPoints = monthly; monthly = 0; }
        else if (wallet.monthly_points > 0 && +new Date(wallet.monthly_expires_at) !== +expiry) throw new BillingAdminError("月卡有效期已变化，请在对账中处理；不能延长原退款积分有效期。");
        else monthlyExpiresAt = expiry;
      }
    }
    if (sumPoints(wallet.paid_points, paid) < wallet.held_paid_points) throw new BillingAdminError("可用永久积分不足；预留积分不能补扣。");
    await client.query("UPDATE app.billing_wallet SET paid_points=paid_points+$2,monthly_points=monthly_points+$3,monthly_expires_at=$4,updated_at=now() WHERE user_id=$1", [userId, paid, monthly, monthlyExpiresAt]);
    const id = randomUUID();
    const details = { fingerprint, ledgerId: id, requestedPoints: points, paidPoints: Math.abs(paid), monthlyPoints: monthly, monthlyExpiresAt, expiredPoints, reason, ...(providerOrderId ? { providerOrderId } : {}) };
    await client.query(`INSERT INTO app.billing_ledger (id,user_id,kind,points_delta,paid_points_after,monthly_points_after,reference_type,reference_id,idempotency_key,metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id,userId,`admin_${action}`,sumPoints(paid,monthly),sumPoints(wallet.paid_points,paid),sumPoints(wallet.monthly_points,monthly),providerOrderId ? "afdian_order" : referenceId ? "billing_ledger" : "admin",providerOrderId ?? referenceId ?? actor,`admin:${key}`,JSON.stringify(details)]);
    if (paymentId) {
      await client.query("UPDATE app.billing_payment SET status='fulfilled',updated_at=now() WHERE id=$1", [paymentId]);
      await client.query("UPDATE app.billing_review SET status='resolved',resolution=$2,actor_id=$3,resolved_at=now() WHERE id=$1 AND status='open'", ["payment:" + paymentId, JSON.stringify({ resolution: "adjusted", reason, ledgerId: id }), actor]);
    }
    await audit(client, actor, action, userId, reason, key, details);
    return details;
  });
}
type StoredModelSettings = AgentModelSettingsPayload & { linkedVersions?: { ratesId: string; modelsId: string } };
type ModelSettingsRow = { id: string; version: number; status: AgentModelSettingsVersion["status"]; payload: StoredModelSettings; created_at: Date | string };
function parseModelSettings(value: unknown): AgentModelSettingsPayload {
  if (!value || typeof value !== "object" || (value as AgentModelSettingsPayload).schema !== 1) throw new Error("Invalid model settings");
  const payload = value as AgentModelSettingsPayload;
  return { schema: 1, rates: parseRatePolicy(payload.rates), models: parseModelPolicy(payload.models) };
}
async function insertPolicyVersion(client: PoolClient, kind: string, payload: unknown, actor: string | null) {
  const version = Number((await client.query("SELECT coalesce(max(version),0)+1 AS version FROM app.agent_policy_version WHERE kind=$1", [kind])).rows[0].version);
  const id = `${kind}:${version}`;
  await client.query("INSERT INTO app.agent_policy_version (id,kind,version,payload,author_id) VALUES ($1,$2,$3,$4,$5)", [id, kind, version, JSON.stringify(payload), actor]);
  return id;
}
/** Call while holding riic-agent-policy; bind each historical pair without changing its individual snapshots. */
async function ensureModelSettingsBaseline(client: PoolClient, actor: string | null = null) {
  const { rows } = await client.query<{ id: string; kind: string; payload: unknown }>("SELECT id,kind,payload FROM app.agent_policy_version WHERE status='active' AND kind IN ('rates','models')");
  const rates = rows.find(row => row.kind === "rates"); const models = rows.find(row => row.kind === "models");
  if (!rates || !models) return null;
  let payload: AgentModelSettingsPayload;
  try { payload = parseModelSettings({ schema: 1, rates: rates.payload, models: models.payload }); }
  catch { return null; } // Keep invalid historical versions readable for administrator repair.
  const linkedVersions = { ratesId: rates.id, modelsId: models.id };
  const active = (await client.query<ModelSettingsRow>("SELECT * FROM app.agent_policy_version WHERE kind='model-settings' AND status='active'")).rows[0];
  if (active?.payload.linkedVersions?.ratesId === rates.id && active.payload.linkedVersions.modelsId === models.id) return { id: active.id, ...linkedVersions, payload };
  const id = await insertPolicyVersion(client, "model-settings", { ...payload, linkedVersions }, actor);
  await client.query("UPDATE app.agent_policy_version SET status='retired' WHERE kind='model-settings' AND status='active'");
  await client.query("UPDATE app.agent_policy_version SET status='active',published_at=now() WHERE id=$1", [id]);
  return { id, ...linkedVersions, payload };
}
function modelSettingsVersion(row: ModelSettingsRow): AgentModelSettingsVersion {
  return { id: row.id, version: row.version, status: row.status, payload: parseModelSettings(row.payload),
    created_at: new Date(row.created_at).toISOString(), ratesId: row.payload.linkedVersions?.ratesId ?? null, modelsId: row.payload.linkedVersions?.modelsId ?? null };
}
async function currentModelVersionIds(client: PoolClient) {
  const { rows } = await client.query<{ id: string; kind: string }>("SELECT id,kind FROM app.agent_policy_version WHERE status='active' AND kind IN ('rates','models')");
  return { ratesId: rows.find(row => row.kind === "rates")?.id ?? null, modelsId: rows.find(row => row.kind === "models")?.id ?? null };
}
function validateEnabledModelRates(models: AgentModelPolicy, rates: RatePolicy, modelsId: string) {
  for (const entry of models.models.filter(row => row.enabled)) {
    const selected = selectAgentModel(entry.id, { id: modelsId, policy: models }, rates);
    for (const route of selected.routes ?? [selected]) findModelRate(rates, route.provider, route.model);
  }
}
export async function getAgentPolicies() {
  await ensureAgentFilterPolicy();
  return billingTransaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('riic-agent-policy'))");
    const active = await ensureModelSettingsBaseline(client);
    const expectedActive = await currentModelVersionIds(client);
    const versions = await client.query(`SELECT * FROM (
      SELECT *,row_number() OVER (PARTITION BY kind ORDER BY (status='active') DESC,created_at DESC,version DESC) AS policy_rank
      FROM app.agent_policy_version WHERE kind IN ('rates','filter','models')
    ) versions WHERE policy_rank<=34 ORDER BY created_at DESC,version DESC`);
    const jointVersions = await client.query<ModelSettingsRow>("SELECT * FROM app.agent_policy_version WHERE kind='model-settings' ORDER BY (status='active') DESC,created_at DESC,version DESC LIMIT 34");
    const gateway = await client.query("SELECT * FROM app.agent_gateway_status ORDER BY id");
    let initialModels = defaultModelPolicy();
    try { initialModels = parseModelPolicy(versions.rows.find(row => row.kind === "models" && row.status === "active")?.payload); } catch { /* Use an editable template when historical data is invalid. */ }
    const initialPayload: AgentModelSettingsPayload = active?.payload ?? { schema: 1, rates: createRatePolicyDraft(), models: initialModels };
    const modelSettings: ModelSettingsData = { active, expectedActive, initialPayload, versions: jointVersions.rows.map(modelSettingsVersion) };
    // An unpublished template has no multiplier. Availability must not price it.
    const availableRates = active?.payload.rates ?? { ...createRatePolicyDraft(), markup: "1", models: [] };
    return { versions: versions.rows, gateway: gateway.rows, initialRates: createRatePolicyDraft(), modelSettings,
      models: configuredAgentChoices(initialPayload.models, availableRates), modelDirectory: adminModelDirectory(versions.rows),
      modelConfiguration: configuredAgentChoices({ ...initialPayload.models, models: initialPayload.models.models.map(row => ({ ...row, enabled: true })) }, availableRates),
      rateModels: [...AGENT_MODEL_IDS.map(id => ({ id, provider: AGENT_MODELS[id].provider, model: agentLlmSettings(id).model })),
        { id: "deepseek-official", provider: SUPPLEMENTAL_MODEL_PROVIDER, model: process.env.AGENT_LLM_DEEPSEEK_OFFICIAL_MODEL?.trim() || SUPPLEMENTAL_MODEL_ID }] };
  });
}
export async function changeAgentModelSettings(actor: string, input: unknown) {
  const body = input as Record<string, unknown>;
  const reason = field(body?.reason, "变更原因", 500); const action = field(body.action, "操作");
  if (!["draft", "publish", "rollback"].includes(action)) throw new BillingAdminError("配置操作无效。");
  const expected = body.expectedActive as { ratesId?: unknown; modelsId?: unknown } | undefined;
  if (!expected || (expected.ratesId !== null && typeof expected.ratesId !== "string") || (expected.modelsId !== null && typeof expected.modelsId !== "string")) throw new BillingAdminError("请刷新模型配置后重试。");
  await ensureAgentFilterPolicy();
  return billingTransaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('riic-agent-policy'))");
    const active = await ensureModelSettingsBaseline(client, actor);
    const current = await currentModelVersionIds(client);
    if (expected.ratesId !== current.ratesId || expected.modelsId !== current.modelsId) throw new BillingAdminError("配置已更新，请刷新后重试。");
    let source = body.payload;
    if (action !== "draft") {
      const id = field(body.id, "配置版本");
      const row = (await client.query<ModelSettingsRow>("SELECT * FROM app.agent_policy_version WHERE id=$1 AND kind='model-settings'", [id])).rows[0];
      if (!row || (action === "publish" ? row.status !== "draft" : row.status === "draft")) throw new BillingAdminError(action === "publish" ? "草稿不存在或已经发布。" : "回滚版本不存在或尚未发布。");
      source = row.payload;
    }
    let payload: AgentModelSettingsPayload;
    try { payload = parseModelSettings(source); }
    catch { throw new BillingAdminError("配置格式无效，请检查模型能力、图片预算和费率。"); }
    if (action !== "draft") {
      try {
        validateEnabledModelRates(payload.models, payload.rates, current.modelsId ?? "unpublished");
      } catch { throw new BillingAdminError("模型线路、图片预算或费率未完整配置，未发布。请先停用受影响模型或补齐配置。"); }
    }
    const id = action === "publish" ? String(body.id) : await insertPolicyVersion(client, "model-settings", payload, actor);
    let ratesId = current.ratesId; let modelsId = current.modelsId;
    if (action !== "draft") {
      ratesId = await insertPolicyVersion(client, "rates", payload.rates, actor);
      modelsId = await insertPolicyVersion(client, "models", payload.models, actor);
      await client.query("UPDATE app.agent_policy_version SET status='retired' WHERE kind IN ('rates','models','model-settings') AND status='active'");
      await client.query("UPDATE app.agent_policy_version SET status='active',published_at=now() WHERE id=ANY($1::text[])", [[ratesId, modelsId]]);
      await client.query("UPDATE app.agent_policy_version SET status='active',published_at=now(),payload=$2 WHERE id=$1", [id, JSON.stringify({ ...payload, linkedVersions: { ratesId, modelsId } })]);
    }
    await audit(client, actor, `model_settings_${action}`, id, reason, randomUUID(), { previous: { id: active?.id ?? null, ...current }, ratesId, modelsId,
      ...(action === "rollback" ? { restoredFrom: body.id } : {}) });
    return { id, action, status: action === "draft" ? "draft" : "active", ratesId, modelsId };
  });
}
export async function changeAgentPolicy(actor: string, input: unknown) {
  const body = input as Record<string, unknown>;
  const reason = field(body?.reason, "变更原因", 500); const action = field(body.action, "操作");
  const kind = field(body.kind, "配置类型");
  if (!["rates", "filter", "resources", "models"].includes(kind) || !["draft", "publish", "rollback"].includes(action)) throw new BillingAdminError("配置操作无效。");
  return billingTransaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('riic-agent-policy'))");
    const active = (await client.query("SELECT * FROM app.agent_policy_version WHERE kind=$1 AND status='active'", [kind])).rows[0];
    if ((body.expectedActive ?? null) !== (active?.id ?? null)) throw new BillingAdminError("配置已更新，请刷新后重试。");
    if (kind === "rates" || kind === "models") await ensureModelSettingsBaseline(client, actor);
    let payload = body.payload; let id: string;
    if (action === "publish") {
      const draft = (await client.query("SELECT * FROM app.agent_policy_version WHERE id=$1 AND kind=$2 AND status='draft'", [body.id, kind])).rows[0];
      if (!draft) throw new BillingAdminError("草稿不存在或已经发布。");
      payload = draft.payload; id = draft.id;
    } else {
      if (action === "rollback") {
        const old = (await client.query("SELECT payload FROM app.agent_policy_version WHERE id=$1 AND kind=$2", [body.id, kind])).rows[0];
        if (!old) throw new BillingAdminError("回滚版本不存在。"); payload = old.payload;
      }
      try { payload = kind === "rates" ? parseRatePolicy(payload) : kind === "models" ? parseModelPolicy(payload) : kind === "resources" ? parseResourcePolicy(payload) : parseFilterPolicy(payload); }
      catch { throw new BillingAdminError("配置格式无效，请检查费率、词条或规则上限。"); }
      const version = (await client.query("SELECT coalesce(max(version),0)+1 AS version FROM app.agent_policy_version WHERE kind=$1", [kind])).rows[0].version;
      id = `${kind}:${version}`;
      await client.query("INSERT INTO app.agent_policy_version (id,kind,version,payload,author_id) VALUES ($1,$2,$3,$4,$5)", [id,kind,version,JSON.stringify(payload),actor]);
    }
    if (action !== "draft") {
      // Validate at publication too: a draft can outlive route and rate changes.
      try {
        if (kind === "models") {
          const policy = parseModelPolicy(payload);
          const rates = parseRatePolicy((await client.query("SELECT payload FROM app.agent_policy_version WHERE kind='rates' AND status='active'")).rows[0]?.payload);
          validateEnabledModelRates(policy, rates, id);
        } else if (kind === "rates") {
          const rates = parseRatePolicy(payload);
          const modelRow = (await client.query("SELECT payload FROM app.agent_policy_version WHERE kind='models' AND status='active'")).rows[0];
          validateEnabledModelRates(modelRow ? parseModelPolicy(modelRow.payload) : defaultModelPolicy(), rates, id);
        }
      } catch { throw new BillingAdminError("模型线路、图片预算或费率未完整配置，未发布。请先停用受影响模型或补齐配置。"); }
      if (kind === "resources") {
        try { parseResourcePolicy(payload); } catch { throw new BillingAdminError("资源版本校验失败，未发布。"); }
      }
      await client.query("UPDATE app.agent_policy_version SET status='retired' WHERE kind=$1 AND status='active'", [kind]);
      await client.query("UPDATE app.agent_policy_version SET status='active',published_at=now() WHERE id=$1", [id]);
    }
    const combined = action !== "draft" && (kind === "rates" || kind === "models") ? await ensureModelSettingsBaseline(client, actor) : null;
    await audit(client, actor, `policy_${action}`, id, reason, randomUUID(), { previous: active?.id, ...(combined ? { modelSettingsId: combined.id } : {}) });
    return { id, status: action === "draft" ? "draft" : "active" };
  });
}
export async function testAgentFilter(input: unknown) {
  const body = input as Record<string, unknown>;
  const text = typeof body?.text === "string" ? body.text : "";
  if (text.length > 8000) throw new BillingAdminError("测试文本不能超过 8000 字符。");
  const filter = compileFilterPolicy(body.policy);
  return { matches: filter.inspect(text), masked: filter.mask(text) };
}
export async function resolveBillingReview(actor: string, input: unknown) {
  const body = input as Record<string, unknown>; const id = field(body?.id, "对账记录");
  const reason = field(body.reason, "处理依据", 1000);
  const resolution = field(body.resolution, "处理方式");
  if (!["platform_absorbed", "verified", "adjusted"].includes(resolution)) throw new BillingAdminError("处理方式无效。");
  return billingTransaction(async client => {
    // Payment processing locks payment before review; keep the same order here.
    const review = (await client.query("SELECT kind,evidence FROM app.billing_review WHERE id=$1", [id])).rows[0];
    if (review?.kind === "afdian_payment") await client.query("SELECT id FROM app.billing_payment WHERE id=$1 FOR UPDATE", [review.evidence?.paymentId]);
    const row = (await client.query("SELECT * FROM app.billing_review WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!row) throw new BillingAdminError("对账记录不存在。");
    if (row.status !== "open") return { duplicate: true };
    const ledgerId = resolution === "adjusted" ? field(body.ledgerId, "调账流水") : null;
    if (row.kind === "afdian_payment") {
      const paymentId = row.evidence?.paymentId;
      const payment = (await client.query("SELECT * FROM app.billing_payment WHERE id=$1 FOR UPDATE", [paymentId])).rows[0];
      if (!payment) throw new BillingAdminError("付款记录不存在。");
      if (ledgerId && !(await client.query("SELECT id FROM app.billing_ledger WHERE id=$1 AND kind='admin_credit' AND points_delta>0 AND (metadata->>'providerOrderId'=$2 OR (reference_type='afdian_order' AND reference_id=$2))", [ledgerId,payment.provider_order_id])).rowCount) throw new BillingAdminError("调账流水必须明确关联此付款交易号。");
      await client.query("UPDATE app.billing_payment SET status='closed',updated_at=now() WHERE id=$1 AND status<>'fulfilled'", [paymentId]);
    } else if (ledgerId && !(await client.query("SELECT l.id FROM app.billing_ledger l JOIN app.agent_run r ON r.user_id=l.user_id WHERE l.id=$1 AND r.id=$2 AND l.kind LIKE 'admin_%'", [ledgerId,row.run_id])).rowCount) throw new BillingAdminError("调账流水与用户不匹配。");
    await client.query("UPDATE app.billing_review SET status='resolved',resolution=$2,actor_id=$3,resolved_at=now() WHERE id=$1", [id,JSON.stringify({ resolution, reason, ledgerId }),actor]);
    await audit(client, actor, "review_resolve", id, reason, `review:${id}`, { resolution, ledgerId });
    return { resolved: true };
  });
}
