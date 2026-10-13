import { assertSameOrigin, createRequestId, enforceRateLimit, failureResponse, PublicApiError, readJsonBody, requestClientIp, successResponse } from "@/server/api-contract";
import { requireWebsiteSession } from "@/server/auth/authorization";
import { fetchGachaHistory, gachaSession, publicGachaError } from "@/server/gacha-history";
import { assertSklandFeatureEnabled } from "@/server/skland/http";
import { clearGachaArchive, readGachaArchive, saveGachaArchive } from "@/server/gacha-archive";
import { validateGachaImport } from "@/server/gacha-archive-validation";

export const runtime = "nodejs";

async function handle(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSklandFeatureEnabled();
    assertSameOrigin(request);
    const user = await requireWebsiteSession(request);
    const uid = new URL(request.url).searchParams.get("uid") ?? "";
    if (!/^\d{4,20}$/.test(uid)) throw new PublicApiError("AIC-REQ-1001");
    let data;
    if (request.method === "GET") {
      data = await readGachaArchive(user.user.id, uid);
    } else if (request.method === "DELETE") {
      const body = await readJsonBody(request, 1024) as { confirmUid?: unknown } | null;
      if (body?.confirmUid !== uid) throw new PublicApiError("AIC-REQ-1001");
      await clearGachaArchive(user.user.id, uid);
      data = { cleared: true };
    } else {
      enforceRateLimit("gacha-history", `${user.user.id}:${requestClientIp(request)}`, 10, 60 * 60_000);
      const session = gachaSession(request, user.user.id);
      const role = session?.roles.find((item) => item.uid === uid);
      if (!session || !role) throw new PublicApiError("AIC-AUTH-2008", { message: "请为当前角色重新授权以更新或上传记录；云端历史仍可查看。" });
      const body = await readJsonBody(request, 16 * 1024 * 1024) as { action?: unknown; history?: unknown } | null;
      if (body?.action === "import") {
        let records;
        try { records = validateGachaImport(body.history, uid); }
        catch (error) { throw new PublicApiError("AIC-REQ-1001", { message: error instanceof Error ? error.message : "历史记录格式无效。" }); }
        data = await saveGachaArchive(user.user.id, { uid, nickname: role.nickname, records, warnings: [], fetchedAt: new Date().toISOString() }, "browser");
      } else if (body?.action === "refresh") {
        data = await saveGachaArchive(user.user.id, await fetchGachaHistory(session, uid), "official");
      } else throw new PublicApiError("AIC-REQ-1001");
    }
    const response = successResponse(data, requestId);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return failureResponse(publicGachaError(error), requestId, "/api/gacha/history", startedAt, "AIC-SYS-5000", request);
  }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
