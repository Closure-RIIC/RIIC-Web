import {
  assertEmptyBody,
  assertSameOrigin,
  createRequestId,
  enforceRateLimit,
  failureResponse,
  readJsonBody,
  requestClientIp,
  successResponse,
} from "../../../api-contract";
import { requireWebsiteSession } from "../../../auth/authorization";
import {
  acceptAccountDataConsent,
  accountDataConsent,
} from "../../../data-consent";
import { revokeAccountDataConsentAndPurgeCloudData } from "../../../workspace";


export async function GET(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    const session = await requireWebsiteSession(request);
    return successResponse(await accountDataConsent(session.user.id), requestId);
  } catch (error) {
    return failureResponse(error, requestId, "/api/account/data-consent", startedAt, "AIC-SYS-5000", request);
  }
}

export async function POST(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSameOrigin(request);
    enforceRateLimit("data-consent", requestClientIp(request), 10, 10 * 60_000);
    const session = await requireWebsiteSession(request);
    const body = await readJsonBody(request, 16 * 1024);
    return successResponse(await acceptAccountDataConsent(session.user.id, body), requestId);
  } catch (error) {
    return failureResponse(error, requestId, "/api/account/data-consent", startedAt, "AIC-SYS-5000", request);
  }
}

export async function DELETE(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSameOrigin(request);
    enforceRateLimit("data-consent-delete", requestClientIp(request), 3, 60 * 60_000);
    await assertEmptyBody(request, 1024);
    const session = await requireWebsiteSession(request);
    await revokeAccountDataConsentAndPurgeCloudData(session.user.id);
    return successResponse({ revoked: true as const, deleted: true as const }, requestId);
  } catch (error) {
    return failureResponse(error, requestId, "/api/account/data-consent", startedAt, "AIC-SYS-5000", request);
  }
}
