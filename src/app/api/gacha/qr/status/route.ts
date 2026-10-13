import { assertSameOrigin, createRequestId, enforceRateLimit, failureResponse, PublicApiError, readJsonBody, requestClientIp, successResponse } from "@/server/api-contract";
import { requireWebsiteSession } from "@/server/auth/authorization";
import { gachaCookieName, pollGachaScan, publicGachaError } from "@/server/gacha-history";
import { assertSklandFeatureEnabled } from "@/server/skland/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSklandFeatureEnabled();
    assertSameOrigin(request);
    const user = await requireWebsiteSession(request);
    enforceRateLimit("gacha-qr-poll", `${user.user.id}:${requestClientIp(request)}`, 120, 5 * 60_000);
    const body = await readJsonBody(request, 1024) as { scanId?: unknown };
    if (typeof body?.scanId !== "string" || !/^[a-zA-Z0-9_-]{1,150}$/.test(body.scanId)) throw new PublicApiError("AIC-REQ-1001");
    const result = await pollGachaScan(body.scanId, user.user.id);
    const response = successResponse({ status: result.status, roles: result.roles ?? [] }, requestId);
    if (result.sessionId) response.cookies.set(gachaCookieName(), result.sessionId, {
      httpOnly: true, sameSite: "lax", secure: new URL(request.url).protocol === "https:", path: "/api/gacha", maxAge: 60 * 60,
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return failureResponse(publicGachaError(error), requestId, "/api/gacha/qr/status", startedAt, "AIC-SYS-5000", request);
  }
}
