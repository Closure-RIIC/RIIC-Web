import { assertSameOrigin, createRequestId, enforceRateLimit, failureResponse, PublicApiError, readJsonBody, successResponse } from "@/server/api-contract";
import { requireWebsiteAdmin } from "@/server/auth/authorization";
import { getDatabasePool } from "@/server/db";
import { BillingAdminError, changeAgentPolicy } from "@/server/billing/admin";
import { importAgentResources } from "@/server/agent/resources";
import { RESOURCE_PAYLOAD_LIMIT } from "@/server/agent/resource-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  const requestId = createRequestId(); const start = performance.now();
  let response: Response;
  try {
    const { session } = await requireWebsiteAdmin(request);
    let data: unknown;
    if (request.method === "GET") {
      const id = new URL(request.url).searchParams.get("id");
      const pool = getDatabasePool();
      if (id) {
        const row = (await pool.query("SELECT id,payload FROM app.agent_policy_version WHERE kind='resources' AND id=$1", [id.slice(0, 128)])).rows[0];
        if (!row) throw new PublicApiError("AIC-REQ-1001", { message: "资源版本不存在。" });
        data = row;
      } else {
        const [versions, active] = await Promise.all([
          pool.query("SELECT id,version,status,author_id,created_at,published_at FROM app.agent_policy_version WHERE kind='resources' ORDER BY version DESC LIMIT 100"),
          pool.query("SELECT id,payload FROM app.agent_policy_version WHERE kind='resources' AND status='active'"),
        ]);
        data = { versions: versions.rows, active: active.rows[0] ?? null };
      }
    } else {
      assertSameOrigin(request); enforceRateLimit("admin-agent-resources", session.user.id, 20, 60_000);
      const body = await readJsonBody(request, RESOURCE_PAYLOAD_LIMIT + 10_000) as Record<string, unknown>;
      if (body?.action === "import") {
        try { data = { payload: await importAgentResources() }; }
        catch { throw new PublicApiError("AIC-REQ-1001", { message: "导入失败，请检查配置的人格、知识库及指引文件是否完整且可读。现有版本未改变。" }); }
      } else data = await changeAgentPolicy(session.user.id, { ...body, kind: "resources" });
    }
    response = successResponse(data, requestId);
  } catch (error) {
    response = failureResponse(error instanceof BillingAdminError ? new PublicApiError("AIC-REQ-1001", { message: error.message }) : error, requestId, "/api/admin/agent/resources", start, "AIC-SYS-5000", request);
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}
export const GET = handle;
export const POST = handle;
