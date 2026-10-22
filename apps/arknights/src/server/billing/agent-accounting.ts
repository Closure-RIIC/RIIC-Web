import "@tanstack/react-start/server-only";
import { createHash, randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import type { PoolClient } from "pg";
import { getDatabasePool } from "@riic/platform-server/db";
import { DEFAULT_FILTER_POLICY, parseFilterPolicy, type FilterPolicy } from "../agent/filter-policy.ts";
import { budgetPoints, defaultRatePolicy, parseRatePolicy, priceModelCall, tokenPoints, type MeasuredUsage, type RatePolicy } from "./rate-policy.ts";
import { sumPoints, validPoints } from "./points.ts";

type Run = { id: string; user_id: string; state: string; settlement: string; policy: RatePolicy; held_paid: number; held_monthly: number; tool_points: number; rate_version: string; delivered: boolean; monthly_expires_at: Date | null };
type Wallet = { user_id: string; paid_points: number; monthly_points: number; held_paid_points: number; held_monthly_points: number; monthly_expires_at: Date | null };
export class AgentAccountingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "AgentAccountingError"; this.code = code; }
}
export async function billingTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getDatabasePool().connect();
  try { await client.query("BEGIN"); const result = await fn(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export async function activeAgentPolicies() {
  return billingTransaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('riic-agent-policy'))");
    for (const [kind, payload] of [["rates", defaultRatePolicy()], ["filter", DEFAULT_FILTER_POLICY]] as const) {
      await client.query(`INSERT INTO app.agent_policy_version (id,kind,version,status,payload,published_at)
        SELECT $1,$2,1,'active',$3,now() WHERE NOT EXISTS (SELECT 1 FROM app.agent_policy_version WHERE kind=$2)`, [`${kind}:1`, kind, JSON.stringify(payload)]);
    }
    const { rows } = await client.query<{ id: string; kind: string; payload: unknown }>("SELECT id,kind,payload FROM app.agent_policy_version WHERE status='active' AND kind IN ('rates','filter')");
    const rates = rows.find(row => row.kind === "rates"); const filter = rows.find(row => row.kind === "filter");
    if (!rates || !filter) throw new Error("Agent policy unavailable");
    return { rates: { id: rates.id, policy: parseRatePolicy(rates.payload) }, filter: { id: filter.id, policy: parseFilterPolicy(filter.payload) } };
  });
}
export async function recordFilterEvent(input: { requestId: string; userId: string; version: string; stage: string; ruleIds: string[] }) {
  await getDatabasePool().query(`INSERT INTO app.agent_filter_event (id,request_id,user_id,version,stage,rule_ids) VALUES ($1,$2,$3,$4,$5,$6)`,
    [randomUUID(), input.requestId, input.userId, input.version, input.stage, JSON.stringify(input.ruleIds)]);
}
async function lockWallet(client: PoolClient, userId: string) {
  await client.query("INSERT INTO app.billing_wallet (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
  const { rows: [wallet] } = await client.query<Wallet>("SELECT * FROM app.billing_wallet WHERE user_id=$1 FOR UPDATE", [userId]);
  return { ...wallet, paid_points: Number(wallet.paid_points), monthly_points: Number(wallet.monthly_points),
    held_paid_points: Number(wallet.held_paid_points), held_monthly_points: Number(wallet.held_monthly_points) };
}
async function lockRun(client: PoolClient, id: string) {
  const { rows: [owner] } = await client.query<{ user_id: string | null }>("SELECT user_id FROM app.agent_run WHERE id=$1", [id]);
  if (!owner?.user_id) throw new Error("Unknown agent run owner");
  const wallet = await lockWallet(client, owner.user_id);
  const { rows: [run] } = await client.query<Run>("SELECT * FROM app.agent_run WHERE id=$1 FOR UPDATE", [id]);
  return { run: { ...run, held_paid: Number(run.held_paid), held_monthly: Number(run.held_monthly) }, wallet };
}
async function ensureHold(client: PoolClient, run: Run, wallet: Wallet, target: number) {
  if (!validPoints(target)) throw new AgentAccountingError("budget_limit", "本次请求预算超出限制，请检查模型费率。");
  if (run.settlement !== "reserved" || run.state !== "running") throw new AgentAccountingError("run_closed", "本次请求已结束，请重新发送。");
  const extra = Math.max(0, sumPoints(target, -run.held_paid, -run.held_monthly));
  if (!extra) return;
  const monthlyAvailable = wallet.monthly_expires_at && wallet.monthly_expires_at > new Date() ? Math.max(0, sumPoints(wallet.monthly_points, -wallet.held_monthly_points)) : 0;
  const monthly = Math.min(extra, monthlyAvailable); const paid = sumPoints(extra, -monthly);
  if (sumPoints(wallet.paid_points, -wallet.held_paid_points) < paid) throw new AgentAccountingError("insufficient_points", "可用积分不足以继续本次请求，请充值或缩短对话后重试。");
  await client.query("UPDATE app.billing_wallet SET held_paid_points=held_paid_points+$2,held_monthly_points=held_monthly_points+$3,updated_at=now() WHERE user_id=$1", [run.user_id, paid, monthly]);
  await client.query("UPDATE app.agent_run SET held_paid=held_paid+$2,held_monthly=held_monthly+$3,monthly_expires_at=coalesce(monthly_expires_at,$4),heartbeat_at=now() WHERE id=$1", [run.id, paid, monthly, monthly ? wallet.monthly_expires_at : null]);
}
export async function beginAgentRun(input: { userId: string; conversationId: string; idempotencyKey: string; requestHash: string; rates: { id: string; policy: RatePolicy }; filterVersion: string }) {
  return billingTransaction(async client => {
    await lockWallet(client, input.userId);
    const existing = await client.query("SELECT id,state,request_hash FROM app.agent_run WHERE user_id=$1 AND idempotency_key=$2", [input.userId, input.idempotencyKey]);
    if (existing.rowCount) throw new AgentAccountingError("duplicate_request", "这条请求已处理或正在处理，请等待结果；需要重试时请使用重试按钮。");
    const active = await client.query("SELECT id FROM app.agent_run WHERE user_id=$1 AND settlement='reserved'", [input.userId]);
    if ((active.rowCount ?? 0) >= 2) throw new AgentAccountingError("concurrency", "同时进行的请求过多，请等待已有请求结束。");
    if ((await client.query("SELECT id FROM app.agent_run WHERE user_id=$1 AND conversation_id=$2 AND settlement='reserved'", [input.userId,input.conversationId])).rowCount) throw new AgentAccountingError("conversation_busy", "当前对话仍在生成，请等待结束。");
    const id = randomUUID();
    await client.query(`INSERT INTO app.agent_run (id,user_id,conversation_id,idempotency_key,request_hash,policy,rate_version,filter_version)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, input.userId, input.conversationId, input.idempotencyKey, input.requestHash, JSON.stringify(input.rates.policy), input.rates.id, input.filterVersion]);
    return id;
  });
}
export function agentSessionId(userId: string, conversationId: string) {
  return createHash("sha256").update(`${userId}\0${conversationId}`).digest("hex");
}
export async function beginModelCall(runId: string, step: number, bytes: number, maxOutputTokens: number) {
  if (!Number.isInteger(step) || step < 0 || step >= 12) throw new Error("Agent step limit exceeded");
  return billingTransaction(async client => {
    const { run, wallet } = await lockRun(client, runId);
    const { rows: calls } = await client.query<{ charged_rmb: string | null; status: string }>("SELECT charged_rmb,status FROM app.agent_model_call WHERE run_id=$1", [runId]);
    if (calls.some(call => call.status !== "measured" && call.status !== "waived")) throw new AgentAccountingError("usage_pending", "本次请求的用量尚未确认，已停止后续调用。");
    const budget = budgetPoints(run.policy, bytes, maxOutputTokens);
    const target = sumPoints(tokenPoints(run.policy, calls.flatMap(call => call.charged_rmb ? [call.charged_rmb] : [])), run.tool_points, budget);
    await ensureHold(client, run, wallet, target);
    const id = randomUUID();
    await client.query("INSERT INTO app.agent_model_call (id,run_id,step,budget_points,rate_version) VALUES ($1,$2,$3,$4,$5)", [id, runId, step, budget, run.rate_version]);
    return { id, policy: run.policy };
  });
}
export async function finishModelCall(input: { id: string; provider?: string; model?: string; gatewayRequestId?: string; usage?: MeasuredUsage; error?: string }) {
  return billingTransaction(async client => {
    const { rows: [call] } = await client.query("SELECT c.*,r.policy FROM app.agent_model_call c JOIN app.agent_run r ON r.id=c.run_id WHERE c.id=$1 FOR UPDATE OF c", [input.id]);
    if (!call || call.status !== "started") return;
    let pricing: ReturnType<typeof priceModelCall> | undefined;
    let status = input.error === "setup_failed" ? "waived" : "missing";
    if (input.usage && input.provider && input.model) {
      try { pricing = priceModelCall(call.policy, input.provider, input.model, input.usage, new Date(call.created_at)); status = "measured"; }
      catch { status = "unknown_model_or_usage"; }
    }
    await client.query(`UPDATE app.agent_model_call SET provider=$2,model=$3,gateway_request_id=$4,status=$5,input_tokens=$6,output_tokens=$7,cached_input_tokens=$8,
      upstream_rmb=$9,charged_rmb=$10,details=$11,finished_at=now() WHERE id=$1`,
    [input.id, input.provider ?? null, input.model ?? null, input.gatewayRequestId ?? null, status,
      input.usage?.inputTokens ?? null, input.usage?.outputTokens ?? null, input.usage?.cachedInputTokens ?? null,
      pricing?.upstreamRmb ?? null, pricing?.chargedRmb ?? null, JSON.stringify({ reason: input.error ?? null })]);
    if (!["measured", "waived"].includes(status)) await client.query("INSERT INTO app.billing_review (id,run_id,kind,evidence) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [`call:${input.id}`, call.run_id, status, JSON.stringify({ callId: input.id })]);
    await client.query("UPDATE app.agent_run SET heartbeat_at=now() WHERE id=$1", [call.run_id]);
  });
}
export async function beginToolCharge(runId: string, toolCallId: string, name: string) {
  return billingTransaction(async client => {
    const { run, wallet } = await lockRun(client, runId);
    const existing = await client.query("SELECT id FROM app.agent_tool_charge WHERE run_id=$1 AND tool_call_id=$2", [runId, toolCallId]);
    if (existing.rowCount) throw new AgentAccountingError("duplicate_tool", "工具调用已处理，不能自动重复执行。");
    await ensureHold(client, run, wallet, sumPoints(run.held_paid, run.held_monthly, run.policy.toolPoints));
    const id = randomUUID();
    await client.query("INSERT INTO app.agent_tool_charge (id,run_id,tool_call_id,name,status,points) VALUES ($1,$2,$3,$4,'reserved',$5)", [id, runId, toolCallId, name, run.policy.toolPoints]);
    return id;
  });
}
export async function finishToolCharge(id: string, success: boolean) {
  await billingTransaction(async client => {
    const { rows: [row] } = await client.query("UPDATE app.agent_tool_charge SET status=$2 WHERE id=$1 AND status='reserved' RETURNING run_id,points", [id, success ? "completed" : "failed"]);
    if (row && success) await client.query("UPDATE app.agent_run SET tool_points=tool_points+$2,delivered=true,heartbeat_at=now() WHERE id=$1", [row.run_id, row.points]);
  });
}
export async function markRunDelivered(id: string) {
  await getDatabasePool().query("UPDATE app.agent_run SET delivered=true,heartbeat_at=now() WHERE id=$1 AND state='running'", [id]);
}
export async function settleAgentRun(id: string, state: "completed" | "failed" | "cancelled" | "blocked") {
  return billingTransaction(async client => {
    const { run, wallet } = await lockRun(client, id);
    if (run.settlement !== "reserved") return;
    const { rows: calls } = await client.query("SELECT * FROM app.agent_model_call WHERE run_id=$1 ORDER BY step", [id]);
    const incomplete = calls.some(call => !["measured", "waived"].includes(call.status));
    const unknownUsage = calls.some(call => call.input_tokens === null || call.output_tokens === null);
    const unknownCost = calls.some(call => call.upstream_rmb === null);
    const billTokens = state === "completed" || state === "cancelled" || run.delivered;
    const amounts = billTokens ? calls.filter(call => call.status === "measured").map(call => String(call.charged_rmb)) : [];
    const due = sumPoints(tokenPoints(run.policy, amounts), run.tool_points);
    const held = sumPoints(run.held_paid, run.held_monthly);
    const charged = Math.min(due, held);
    const monthly = Math.min(charged, run.held_monthly); const paid = sumPoints(charged, -monthly);
    const expiredRelease = run.monthly_expires_at && run.monthly_expires_at <= new Date() ? sumPoints(run.held_monthly, -monthly) : 0;
    const nextPaid = sumPoints(wallet.paid_points, -paid); const nextMonthly = sumPoints(wallet.monthly_points, -monthly, -expiredRelease);
    if (nextPaid < 0 || nextMonthly < 0 || wallet.held_paid_points < run.held_paid || wallet.held_monthly_points < run.held_monthly) throw new Error("Wallet reservation invariant failed");
    await client.query(`UPDATE app.billing_wallet SET paid_points=$2,monthly_points=$3,held_paid_points=held_paid_points-$4,
      held_monthly_points=held_monthly_points-$5,updated_at=now() WHERE user_id=$1`, [run.user_id, nextPaid, nextMonthly, run.held_paid, run.held_monthly]);
    const needsReview = incomplete || due > held;
    const metadata = { billingVersion: 5, rateVersion: run.rate_version, paidPoints: paid, monthlyPoints: monthly,
      monthlyExpiresAt: run.monthly_expires_at, tokenPoints: Math.max(0, sumPoints(charged, -run.tool_points)), toolPoints: run.tool_points,
      duePoints: due, unsettledPoints: Math.max(0, sumPoints(due, -charged)), state };
    if (charged) await client.query(`INSERT INTO app.billing_ledger (id,user_id,kind,points_delta,paid_points_after,monthly_points_after,reference_type,reference_id,idempotency_key,metadata)
      VALUES ($1,$2,'agent_settlement',$3,$4,$5,'agent_run',$6,$7,$8)`, [randomUUID(), run.user_id, -charged, nextPaid, sumPoints(nextMonthly, expiredRelease), id, `agent_run:settle:${id}`, JSON.stringify(metadata)]);
    if (expiredRelease) await client.query(`INSERT INTO app.billing_ledger (id,user_id,kind,points_delta,paid_points_after,monthly_points_after,reference_type,reference_id,idempotency_key)
      VALUES ($1,$2,'monthly_expiry',$3,$4,$5,'agent_run',$6,$7)`, [randomUUID(), run.user_id, -expiredRelease, nextPaid, nextMonthly, id, `agent_run:expiry:${id}`]);
    const sum = (field: string) => calls.reduce((total, call) => total + Number(call[field] ?? 0), 0);
    const upstream = calls.reduce((total, call) => total.add(call.upstream_rmb ?? "0"), new Decimal(0));
    const chargedRmb = new Decimal(charged).mul(run.policy.pointValueRmb);
    await client.query(`INSERT INTO app.agent_usage (id,user_id,run_id,tool_name,status,points,input_tokens,output_tokens,cached_input_tokens,upstream_cost_rmb_fen,charged_cost_rmb_fen,idempotency_key,metadata,finalized_at)
      VALUES ($1,$2,$1,'agent_chat',$3,$4,$5,$6,$7,$8,$9,$10,$11,now())`, [id, run.user_id, needsReview ? "completed_unsettled" : "completed", charged,
      unknownUsage ? null : sum("input_tokens"), unknownUsage ? null : sum("output_tokens"), unknownUsage ? null : sum("cached_input_tokens"),
      unknownCost ? null : upstream.mul(100).toDecimalPlaces(10).toNumber(), chargedRmb.mul(100).toNumber(), `agent_run:${id}`,
      JSON.stringify({ ...metadata, settlement: { ...metadata, settledPoints: charged, settledTokenPoints: metadata.tokenPoints } })]);
    await client.query("UPDATE app.agent_run SET state=$2,settlement=$3,charged_points=$4,held_paid=0,held_monthly=0,finished_at=now(),heartbeat_at=now() WHERE id=$1", [id, state, needsReview ? "needs_review" : "settled", charged]);
    if (needsReview) await client.query("INSERT INTO app.billing_review (id,run_id,kind,evidence) VALUES ($1,$2,'settlement',$3) ON CONFLICT DO NOTHING", [`run:${id}`, id, JSON.stringify({ due, charged, incomplete, resolution: "Verified portion settled; unused reservation released; unknown portion requires review." })]);
  });
}
export async function recoverAgentRuns() {
  await getDatabasePool().query("UPDATE app.agent_run SET state='failed',settlement='needs_review',held_paid=0,held_monthly=0,finished_at=now() WHERE user_id IS NULL AND settlement='reserved' AND created_at < now()-interval '15 minutes'");
  // Runs have a ten-minute hard deadline. Recover only after an additional five-minute grace period.
  const { rows } = await getDatabasePool().query("SELECT id FROM app.agent_run WHERE settlement='reserved' AND created_at < now()-interval '15 minutes' ORDER BY created_at LIMIT 50");
  for (const row of rows) await settleAgentRun(row.id, "failed");
  return rows.length;
}
export type ActiveAgentPolicies = { rates: { id: string; policy: RatePolicy }; filter: { id: string; policy: FilterPolicy } };
