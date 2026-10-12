import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getDatabasePool } from "../db/index.ts";
import { compileFilterPolicy, parseFilterPolicy } from "../agent/filter-policy.ts";
import { activeAgentPolicies, billingTransaction } from "./agent-accounting.ts";
import { parseRatePolicy } from "./rate-policy.ts";

export class BillingAdminError extends Error {}
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
  const [usage, orders, wallet, exceptions, series] = await Promise.all([
    pool.query(`SELECT count(*)::int AS runs,coalesce(sum(points),0)::text AS points,
      count(*) FILTER (WHERE upstream_cost_rmb_fen IS NULL)::int AS unknown_cost_runs,
      (coalesce(sum(upstream_cost_rmb_fen) FILTER (WHERE metadata->>'billingVersion' IS DISTINCT FROM '4'),0)
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
  ]);
  return { ...usage.rows[0], ...orders.rows[0], ...wallet.rows[0], ...exceptions.rows[0], series: series.rows };
}
export function billingRange(params: URLSearchParams) {
  const to = params.get("to") ? new Date(params.get("to")!) : new Date();
  const from = params.get("from") ? new Date(params.get("from")!) : new Date(to.getTime() - 30 * 86400_000);
  if (!Number.isFinite(+from) || !Number.isFinite(+to) || +from >= +to || +to - +from > 366 * 86400_000) throw new BillingAdminError("日期范围应在一年以内。");
  return { from, to };
}
const listings = {
  usage: { from: `(SELECT coalesce(u.id,r.id) AS id,coalesce(u.user_id,r.user_id) AS user_id,coalesce(r.id,u.run_id) AS run_id,
    coalesce(u.tool_name,'agent_chat') AS tool_name,coalesce(r.state,u.status) AS status,coalesce(r.settlement,'legacy') AS settlement,coalesce(u.points,r.charged_points) AS points,
    u.input_tokens,u.output_tokens,u.cached_input_tokens,u.upstream_cost_rmb_fen,u.charged_cost_rmb_fen,
    coalesce(r.created_at,u.created_at) AS created_at,u.metadata FROM app.agent_usage u FULL JOIN app.agent_run r ON r.id=u.id) t`, select: "t.*", q: "t.id || ' ' || coalesce(t.run_id,'') || ' ' || coalesce(t.user_id,'')", status: "t.status", time: "t.created_at" },
  wallets: { from: 'app.billing_wallet t JOIN public."user" u ON u.id=t.user_id', select: "t.user_id,u.name,u.email,t.paid_points,t.monthly_points,t.monthly_expires_at,t.held_paid_points,t.held_monthly_points,t.updated_at", q: "t.user_id || ' ' || u.name || ' ' || u.email", status: "''", time: "t.updated_at" },
  ledger: { from: "app.billing_ledger t", select: "t.*", q: "t.id || ' ' || t.user_id || ' ' || coalesce(t.reference_id,'')", status: "t.kind", time: "t.created_at" },
  orders: { from: "app.billing_order t", select: "t.id,t.user_id,t.product_id,t.provider,t.status,t.amount_fen,t.points,t.custom_order_id,t.provider_order_id,t.created_at,t.paid_at", q: "t.id || ' ' || t.user_id || ' ' || t.custom_order_id || ' ' || coalesce(t.provider_order_id,'')", status: "t.status", time: "t.created_at" },
  reviews: { from: "app.billing_review t", select: "t.*", q: "t.id || ' ' || coalesce(t.run_id,'')", status: "t.status", time: "t.created_at" },
  audit: { from: "app.billing_admin_audit t", select: "t.*", q: "t.id || ' ' || t.target || ' ' || coalesce(t.actor_id,'')", status: "t.action", time: "t.created_at" },
  filters: { from: "app.agent_filter_event t", select: "t.*", q: "t.request_id || ' ' || coalesce(t.user_id,'')", status: "t.stage", time: "t.created_at" },
  attempts: { from: "app.agent_gateway_usage t", select: "t.*", q: "t.id || ' ' || coalesce(t.call_id,'') || ' ' || t.session_id", status: "t.provider", time: "t.created_at" },
} as const;
export async function listBilling(section: string, params: URLSearchParams) {
  if (!(section in listings)) throw new BillingAdminError("未知记录类型。");
  const config = listings[section as keyof typeof listings];
  const page = Number(params.get("page") || "1");
  if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) throw new BillingAdminError("页码无效。");
  const { from, to } = billingRange(params);
  const q = (params.get("q") ?? "").trim().slice(0, 200); const status = (params.get("status") ?? "").slice(0, 80);
  const where = `WHERE ($1='' OR (${config.q}) ILIKE '%' || $1 || '%') AND ($2='' OR ${config.status}=$2)
    AND ($5 OR (${config.time} >= $3 AND ${config.time} < $4))`;
  const values = [q, status, from, to, section === "wallets"];
  const pool = getDatabasePool();
  const [rows, count] = await Promise.all([
    pool.query(`SELECT ${config.select} FROM ${config.from} ${where} ORDER BY ${config.time} DESC LIMIT 25 OFFSET $6`, [...values, (page - 1) * 25]),
    pool.query(`SELECT count(*)::int AS total FROM ${config.from} ${where}`, values),
  ]);
  return { rows: rows.rows, total: count.rows[0].total, page, pages: Math.max(1, Math.ceil(count.rows[0].total / 25)) };
}
export async function billingRunDetail(id: string) {
  const pool = getDatabasePool();
  const [runs, calls, tools, ledger, reviews] = await Promise.all([
    pool.query("SELECT * FROM app.agent_run WHERE id=$1", [id]),
    pool.query("SELECT * FROM app.agent_model_call WHERE run_id=$1 ORDER BY step", [id]),
    pool.query("SELECT * FROM app.agent_tool_charge WHERE run_id=$1 ORDER BY created_at", [id]),
    pool.query("SELECT * FROM app.billing_ledger WHERE reference_id=$1 ORDER BY created_at", [id]),
    pool.query("SELECT * FROM app.billing_review WHERE run_id=$1 ORDER BY created_at", [id]),
  ]);
  return { run: runs.rows[0] ?? null, calls: calls.rows, tools: tools.rows, ledger: ledger.rows, reviews: reviews.rows };
}
export async function adjustBilling(actor: string, input: unknown) {
  const body = input as Record<string, unknown>;
  const userId = field(body?.userId, "用户 ID"); const reason = field(body.reason, "操作原因", 500);
  const key = field(body.idempotencyKey, "操作 ID", 128); const action = field(body.action, "操作");
  const points = Number(body.points);
  if (!["credit", "debit", "refund"].includes(action) || !Number.isSafeInteger(points) || points < 1 || points > 100_000) throw new BillingAdminError("积分必须是 1–100000 的整数。");
  const referenceId = action === "refund" ? field(body.referenceId, "原扣费流水 ID") : null;
  const fingerprint = createHash("sha256").update(JSON.stringify({ userId, reason, action, points, referenceId })).digest("hex");
  return billingTransaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`admin-billing:${key}`]);
    const prior = await client.query("SELECT details FROM app.billing_admin_audit WHERE idempotency_key=$1", [key]);
    if (prior.rowCount) {
      if (prior.rows[0].details.fingerprint !== fingerprint) throw new BillingAdminError("相同操作 ID 不能用于不同操作。");
      return { ...prior.rows[0].details, duplicate: true };
    }
    if (!(await client.query('SELECT id FROM public."user" WHERE id=$1', [userId])).rowCount) throw new BillingAdminError("用户不存在。");
    await client.query("INSERT INTO app.billing_wallet (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
    const wallet = (await client.query("SELECT * FROM app.billing_wallet WHERE user_id=$1 FOR UPDATE", [userId])).rows[0];
    let paid = action === "debit" ? -points : points; let monthly = 0; let expiredPoints = 0;
    let monthlyExpiresAt = wallet.monthly_expires_at;
    if (action === "refund") {
      const original = (await client.query("SELECT * FROM app.billing_ledger WHERE id=$1 AND user_id=$2 FOR UPDATE", [referenceId, userId])).rows[0];
      if (!original || original.points_delta >= 0 || !["agent_settlement", "admin_debit", "agent_tool", "agent_token"].includes(original.kind)) throw new BillingAdminError("仅支持退还有明确扣费依据的消费流水。");
      const refunds = (await client.query("SELECT coalesce(sum((metadata->>'requestedPoints')::int),0)::int AS points,coalesce(sum((metadata->>'paidPoints')::int),0)::int AS paid FROM app.billing_ledger WHERE kind='admin_refund' AND reference_id=$1", [referenceId])).rows[0];
      if (points + refunds.points > -original.points_delta) throw new BillingAdminError("累计退还积分不能超过原扣费积分。");
      const meta = original.metadata ?? {};
      if (!Number.isSafeInteger(meta.paidPoints) || !Number.isSafeInteger(meta.monthlyPoints)) throw new BillingAdminError("旧流水缺少分桶依据，需先通过对账确认，不能自动退还。");
      paid = Math.min(points, Math.max(0, meta.paidPoints - refunds.paid)); monthly = points - paid;
      if (monthly) {
        const expiry = meta.monthlyExpiresAt ? new Date(meta.monthlyExpiresAt) : null;
        if (!expiry || !Number.isFinite(+expiry)) throw new BillingAdminError("原月卡有效期缺失，不能自动退还。");
        if (+expiry <= Date.now()) { expiredPoints = monthly; monthly = 0; }
        else if (wallet.monthly_points > 0 && +new Date(wallet.monthly_expires_at) !== +expiry) throw new BillingAdminError("月卡有效期已变化，请在对账中处理；不能延长原退款积分有效期。");
        else monthlyExpiresAt = expiry;
      }
    }
    if (wallet.paid_points + paid < wallet.held_paid_points) throw new BillingAdminError("可用永久积分不足；预留积分不能补扣。");
    await client.query("UPDATE app.billing_wallet SET paid_points=paid_points+$2,monthly_points=monthly_points+$3,monthly_expires_at=$4,updated_at=now() WHERE user_id=$1", [userId, paid, monthly, monthlyExpiresAt]);
    const id = randomUUID();
    const details = { fingerprint, ledgerId: id, requestedPoints: points, paidPoints: Math.abs(paid), monthlyPoints: monthly, monthlyExpiresAt, expiredPoints, reason };
    await client.query(`INSERT INTO app.billing_ledger (id,user_id,kind,points_delta,paid_points_after,monthly_points_after,reference_type,reference_id,idempotency_key,metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id,userId,`admin_${action}`,paid+monthly,wallet.paid_points+paid,wallet.monthly_points+monthly,referenceId ? "billing_ledger" : "admin",referenceId ?? actor,`admin:${key}`,JSON.stringify(details)]);
    await audit(client, actor, action, userId, reason, key, details);
    return details;
  });
}
export async function getAgentPolicies() {
  await activeAgentPolicies();
  const pool = getDatabasePool();
  const [versions, gateway] = await Promise.all([pool.query("SELECT * FROM app.agent_policy_version ORDER BY created_at DESC LIMIT 100"), pool.query("SELECT * FROM app.agent_gateway_status ORDER BY id")]);
  return { versions: versions.rows, gateway: gateway.rows };
}
export async function changeAgentPolicy(actor: string, input: unknown) {
  const body = input as Record<string, unknown>;
  const reason = field(body?.reason, "变更原因", 500); const action = field(body.action, "操作");
  const kind = field(body.kind, "配置类型");
  if (!["rates", "filter"].includes(kind) || !["draft", "publish", "rollback"].includes(action)) throw new BillingAdminError("配置操作无效。");
  return billingTransaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('riic-agent-policy'))");
    const active = (await client.query("SELECT * FROM app.agent_policy_version WHERE kind=$1 AND status='active'", [kind])).rows[0];
    if (body.expectedActive !== active?.id) throw new BillingAdminError("配置已更新，请刷新后重试。");
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
      try { payload = kind === "rates" ? parseRatePolicy(payload) : parseFilterPolicy(payload); }
      catch { throw new BillingAdminError("配置格式无效，请检查费率、词条或规则上限。"); }
      const version = (await client.query("SELECT coalesce(max(version),0)+1 AS version FROM app.agent_policy_version WHERE kind=$1", [kind])).rows[0].version;
      id = `${kind}:${version}`;
      await client.query("INSERT INTO app.agent_policy_version (id,kind,version,payload,author_id) VALUES ($1,$2,$3,$4,$5)", [id,kind,version,JSON.stringify(payload),actor]);
    }
    if (action !== "draft") {
      await client.query("UPDATE app.agent_policy_version SET status='retired' WHERE kind=$1 AND status='active'", [kind]);
      await client.query("UPDATE app.agent_policy_version SET status='active',published_at=now() WHERE id=$1", [id]);
    }
    await audit(client, actor, `policy_${action}`, id, reason, randomUUID(), { previous: active?.id });
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
    const row = (await client.query("SELECT * FROM app.billing_review WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!row) throw new BillingAdminError("对账记录不存在。");
    if (row.status !== "open") return { duplicate: true };
    const ledgerId = resolution === "adjusted" ? field(body.ledgerId, "调账流水") : null;
    if (ledgerId && !(await client.query("SELECT l.id FROM app.billing_ledger l JOIN app.agent_run r ON r.user_id=l.user_id WHERE l.id=$1 AND r.id=$2 AND l.kind LIKE 'admin_%'", [ledgerId,row.run_id])).rowCount) throw new BillingAdminError("调账流水与用户不匹配。");
    await client.query("UPDATE app.billing_review SET status='resolved',resolution=$2,actor_id=$3,resolved_at=now() WHERE id=$1", [id,JSON.stringify({ resolution, reason, ledgerId }),actor]);
    await audit(client, actor, "review_resolve", id, reason, `review:${id}`, { resolution, ledgerId });
    return { resolved: true };
  });
}
