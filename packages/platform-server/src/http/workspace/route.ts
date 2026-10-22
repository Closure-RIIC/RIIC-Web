import {
  assertEmptyBody,
  assertSameOrigin,
  createRequestId,
  enforceRateLimit,
  failureResponse,
  readJsonBody,
  requestClientIp,
  successResponse,
} from "../../api-contract";
import { requireWebsiteSession } from "../../auth/authorization";
import { getWorkspace, putWorkspace, revokeAccountDataConsentAndPurgeCloudData } from "../../workspace";


export async function GET(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    const session = await requireWebsiteSession(request);
    return successResponse(await getWorkspace(session.user.id), requestId);
  } catch (error) {
    return failureResponse(error, requestId, "/api/workspace", startedAt, "AIC-SYS-5000", request);
  }
}

export async function PUT(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSameOrigin(request);
    enforceRateLimit("workspace-write", requestClientIp(request), 30, 10 * 60_000);
    const session = await requireWebsiteSession(request);
    return successResponse(await putWorkspace(session.user.id, await readJsonBody(request, 3 * 1024 * 1024)), requestId);
  } catch (error) {
    return failureResponse(error, requestId, "/api/workspace", startedAt, "AIC-SYS-5000", request);
  }
}

export async function DELETE(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSameOrigin(request);
    enforceRateLimit("workspace-delete", requestClientIp(request), 3, 60 * 60_000);
    await assertEmptyBody(request, 1024);
    const session = await requireWebsiteSession(request);
    await revokeAccountDataConsentAndPurgeCloudData(session.user.id);
    const response = successResponse({ deleted: true as const }, requestId);
    response.headers.set("Deprecation", "true");
    response.headers.set("Link", "</api/account/data-consent>; rel=\"successor-version\"");
    return response;
  } catch (error) {
    const response = failureResponse(error, requestId, "/api/workspace", startedAt, "AIC-SYS-5000", request);
    response.headers.set("Deprecation", "true");
    response.headers.set("Link", "</api/account/data-consent>; rel=\"successor-version\"");
    return response;
  }
}
