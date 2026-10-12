import "server-only";
import { getDatabasePool } from "../db/index.ts";
import { gatewaySettings } from "./gateway-config.ts";

export async function recordGatewayRoute(input: { callId: string; runId: string; sessionId: string; startedAt: number; model?: string }) {
  const pool = getDatabasePool();
  try {
    const { baseURL, apiKey } = gatewaySettings();
    const response = await fetch(`${baseURL}/magpie/route?session=${encodeURIComponent(input.sessionId)}`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error("Route unavailable");
    const { route } = await response.json() as { route?: { id: number; time: string; model: string; tries: Array<{ model: string; status?: number; done: boolean; ms?: number }> } };
    if (!route || !Number.isSafeInteger(route.id) || !Array.isArray(route.tries) || route.tries.length > 50 || !Number.isFinite(+new Date(route.time)) || +new Date(route.time) < input.startedAt || (input.model && route.model !== input.model)) throw new Error("Ambiguous gateway route");
    for (const [index, attempt] of route.tries.entries()) {
      const slash = attempt.model.indexOf("/"); if (slash < 1) continue;
      await pool.query(`INSERT INTO app.agent_gateway_usage (id,session_id,provider,model,call_id,details,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [`route:${route.id}:${index}`,input.sessionId,attempt.model.slice(0,slash),attempt.model.slice(slash+1),input.callId,
          JSON.stringify({ kind:"route_attempt",routeId:route.id,attempt:index,status:attempt.status??null,durationMs:attempt.ms??null,done:attempt.done,cost:null,accounting:"Separate from measured completion; failed attempts are never charged to user." }),new Date(route.time)]);
    }
  } catch {
    await pool.query("INSERT INTO app.billing_review (id,run_id,kind,evidence) VALUES ($1,$2,'route_trace_missing',$3) ON CONFLICT DO NOTHING",[`trace:${input.callId}`,input.runId,JSON.stringify({callId:input.callId})]);
  }
}
