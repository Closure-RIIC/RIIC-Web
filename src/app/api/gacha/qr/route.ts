import { assertSameOrigin, createRequestId, enforceRateLimit, PublicApiError, readJsonBody, requestClientIp, successResponse, failureResponse } from "@/server/api-contract";
import { requireWebsiteSession } from "@/server/auth/authorization";
import { publicGachaError, startGachaScan } from "@/server/gacha-history";
import { isCurrentPolicyConsent } from "@/legal-policy";
import { assertSklandFeatureEnabled } from "@/server/skland/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSklandFeatureEnabled();
    assertSameOrigin(request);
    const user = await requireWebsiteSession(request);
    enforceRateLimit("gacha-qr", `${user.user.id}:${requestClientIp(request)}`, 6, 10 * 60_000);
    const body = await readJsonBody(request, 2048) as { consent?: unknown; gachaConsent?: unknown };
    if (!isCurrentPolicyConsent(body?.consent) || body.gachaConsent !== true) throw new PublicApiError("AIC-AUTH-2005");
    return successResponse(await startGachaScan(user.user.id), requestId);
  } catch (error) {
    return failureResponse(publicGachaError(error), requestId, "/api/gacha/qr", startedAt, "AIC-SYS-5000", request);
  }
}
