import {
  assertSameOrigin,
  createRequestId,
  enforceRateLimit,
  PublicApiError,
  readJsonBody,
  requestClientIp,
  successResponse,
} from "@/server/api-contract";
import { isCurrentPolicyConsent } from "@/legal-policy";
import { startScan } from "@/server/skland/adapter";
import { assertSklandAvailable, assertSklandFeatureEnabled, sklandErrorResponse } from "@/server/skland/http";
import { requireWebsiteSession } from "@/server/auth/authorization";


export async function POST(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSklandFeatureEnabled();
    const website = await requireWebsiteSession(request);
    assertSklandAvailable(request);
    assertSameOrigin(request);
    enforceRateLimit("skland-qr-account", website.user.id, 30, 10 * 60_000);
    const ip = requestClientIp(request);
    const body = await readJsonBody(request, 16 * 1024) as { consent?: unknown } | null;
    if (!isCurrentPolicyConsent(body?.consent)) throw new PublicApiError("AIC-AUTH-2005");
    return successResponse(await startScan(website.user.id, ip, body.consent), requestId);
  } catch (error) {
    return sklandErrorResponse(error, requestId, "/api/skland/auth/qr", startedAt, request);
  }
}
