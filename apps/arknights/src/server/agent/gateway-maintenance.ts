import "@tanstack/react-start/server-only";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDatabasePool } from "@riic/platform-server/db";
import { activeAgentPolicies, agentSessionId, recoverAgentRuns } from "../billing/agent-accounting.ts";
import { gatewayFilterOptions } from "./filter-policy.ts";
import { gatewaySettings } from "./gateway-config.ts";

type Usage = { t: string; route_id?: number; session?: string; provider?: string; model?: string; response_id?: string;
  in?: number; out?: number; cache_read?: number; status?: number; priced?: boolean; cost?: number; ms?: number; ttft_ms?: number };
export function gatewayUsageIdentity(row: Usage) {
  return createHash("sha256").update(JSON.stringify([row.t,row.route_id,row.provider,row.model,row.response_id,row.session])).digest("hex");
}
export async function maintainAgentGateway() {
  const pool = getDatabasePool(); const policies = await activeAgentPolicies();
  const settings = gatewaySettings();
  const policyDir = process.env.AGENT_GATEWAY_POLICY_DIR;
  if (!policyDir || !path.isAbsolute(policyDir)) throw new Error("Gateway policy directory is not configured");
  const target = path.join(policyDir, "plugins.json");
  const config = { plugins: [{ spec: "/riic-policy/word-guard.middleware.js", options: gatewayFilterOptions(policies.filter.policy) }] };
  const content = JSON.stringify(config, null, 2) + "\n";
  let previous = "";
  try { previous = await readFile(target,"utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (previous !== content) { const temp = `${target}.${randomUUID()}.tmp`; await writeFile(temp,content,{mode:0o644}); await rename(temp,target); }
  const headers = { Authorization: `Bearer ${settings.apiKey}` };
  const prior = (await pool.query("SELECT details FROM app.agent_gateway_status WHERE id='gateway'")).rows[0];
  const resume = Number(prior?.details?.nextOffset ?? 0);
  let imported = 0; let offset = 0; let incomplete = false;
  // Bound each pass. Persisted IDs permit repeated reads and overlapping pages without double counting.
  for (let page=0; page<20; page++) {
    const response = await fetch(`${settings.baseURL}/magpie/usage/requests?period=7d&limit=200&offset=${offset}`, { headers, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Gateway usage unavailable (${response.status})`);
    const data = await response.json() as { rows?: Usage[]; total?: number };
    if (!Array.isArray(data.rows)) throw new Error("Invalid gateway usage response");
    let fresh = 0;
    for (const row of data.rows) {
      if (!row.session || !row.provider?.startsWith("riic-") || !row.model || !Number.isFinite(+new Date(row.t))) continue;
      const id = gatewayUsageIdentity(row);
      // Only whitelisted usage fields are persisted: never request text, response bodies or keys.
      const details = { responseId: row.response_id ?? null, routeId: row.route_id ?? null, status: row.status ?? null,
        inputTokens: Number.isSafeInteger(row.in) ? Number(row.in) + Number(row.cache_read ?? 0) : null,
        outputTokens: row.out ?? null, cachedInputTokens: row.cache_read ?? null, durationMs: row.ms ?? null, firstTokenMs: row.ttft_ms ?? null,
        gatewayCost: row.priced ? row.cost : null, gatewayPriced: row.priced === true };
      const result = await pool.query(`INSERT INTO app.agent_gateway_usage (id,session_id,provider,model,details,created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[id,row.session,row.provider,row.model,JSON.stringify(details),new Date(row.t)]);
      fresh += result.rowCount ?? 0;
    }
    imported += fresh; offset += data.rows.length;
    if (offset >= (data.total ?? 0) || !data.rows.length) { offset = 0; break; }
    if (page === 0 && Number.isSafeInteger(resume) && resume > offset) offset = Math.max(offset,resume-200);
    if (page === 19) incomplete = true;
  }
  // Response IDs plus owner/session/model identify a call; never associate solely by timestamp.
  const { rows } = await pool.query(`SELECT g.id,g.session_id,g.provider,g.model,g.details,c.id AS call_id,c.run_id,c.input_tokens,c.output_tokens,c.cached_input_tokens,
    r.user_id,r.conversation_id,c.provider AS call_provider,c.model AS call_model FROM app.agent_gateway_usage g JOIN app.agent_model_call c ON c.gateway_request_id=g.details->>'responseId'
    JOIN app.agent_run r ON r.id=c.run_id WHERE g.call_id IS NULL AND g.created_at > now()-interval '8 days' AND c.status='measured' LIMIT 1000`);
  for (const row of rows) {
    if (!row.user_id || row.session_id !== agentSessionId(row.user_id,row.conversation_id) || row.provider !== row.call_provider || row.model !== row.call_model) continue;
    const matching = rows.filter(other=>other.id===row.id);
    if (matching.length !== 1) continue;
    await pool.query("UPDATE app.agent_gateway_usage SET call_id=$2 WHERE id=$1 AND call_id IS NULL",[row.id,row.call_id]);
    const mismatch = row.input_tokens !== row.details.inputTokens || row.output_tokens !== row.details.outputTokens || row.cached_input_tokens !== (row.details.cachedInputTokens ?? 0);
    if (mismatch) await pool.query("INSERT INTO app.billing_review (id,run_id,kind,evidence) VALUES ($1,$2,'gateway_usage_mismatch',$3) ON CONFLICT DO NOTHING",[`gateway:${row.id}`,row.run_id,JSON.stringify({gatewayUsageId:row.id,callId:row.call_id})]);
  }
  // Recovery must also work while the gateway is down; the worker invokes it independently.
  const recovered = await recoverAgentRuns();
  await pool.query(`INSERT INTO app.agent_gateway_status (id,filter_version,status,details,updated_at) VALUES ('gateway',$1,$2,$3,now())
    ON CONFLICT (id) DO UPDATE SET filter_version=excluded.filter_version,status=excluded.status,details=excluded.details,updated_at=now()`,[policies.filter.id,incomplete?"catching_up":"healthy",JSON.stringify({imported,recovered,nextOffset:offset,policyWritten:true,pluginRuntimeVerified:false})]);
  return { imported,recovered };
}
export async function recordGatewayMaintenanceFailure() {
  await getDatabasePool().query(`INSERT INTO app.agent_gateway_status (id,status,details,updated_at) VALUES ('gateway','degraded','{"reason":"maintenance_failed"}',now())
    ON CONFLICT (id) DO UPDATE SET status='degraded',details=excluded.details,updated_at=now()`);
}
