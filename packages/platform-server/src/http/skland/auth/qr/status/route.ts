import {
  assertSameOrigin,
  createRequestId,
  PublicApiError,
  readJsonBody,
  requestClientIp,
  successResponse,
} from "../../../../../api-contract";
import { consumeScan, pollScan, scanCompletionSignal } from "../../../../../skland/adapter";
import {
  assertSklandAvailable,
  assertSklandFeatureEnabled,
  setSklandAccountStoreCookies,
  sklandErrorResponse,
} from "../../../../../skland/http";
import { requireWebsiteSession } from "../../../../../auth/authorization";
import { finalizeSklandAuthentication } from "../../../../../skland/auth-completion";
import { enforceSklandPollRateLimit } from "../../../../../skland/poll-rate-limit";


export async function POST(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSklandFeatureEnabled();
    const website = await requireWebsiteSession(request);
    assertSklandAvailable(request);
    assertSameOrigin(request);
    enforceSklandPollRateLimit(website.user.id, requestClientIp(request));
    const body = await readJsonBody(request, 16 * 1024) as { scanId?: unknown } | null;
    if (typeof body?.scanId !== "string" || !body.scanId.trim()) {
      throw new PublicApiError("AIC-REQ-1001");
    }
    const scanId = body.scanId.trim();
    const result = await pollScan(scanId, website.user.id, request.signal);
    if (result.session && result.response.scheduleSnapshot && result.response.statusSnapshot) {
      const completionSignal = scanCompletionSignal(scanId, website.user.id, request.signal);
      completionSignal.throwIfAborted();
      const completed = await finalizeSklandAuthentication(website.user.id, {
        session: result.session,
        snapshot: result.response.scheduleSnapshot,
        statusSnapshot: result.response.statusSnapshot,
      }, completionSignal);
      completionSignal.throwIfAborted();
      const response = successResponse({
        status: result.response.status,
        scheduleSnapshot: completed.data.scheduleSnapshot,
        statusSnapshot: completed.data.statusSnapshot,
        accounts: completed.data.accounts,
        activeAccountId: completed.data.activeAccountId,
        bindingCount: completed.data.bindingCount,
        bindingSummary: completed.data.bindingSummary,
      }, requestId);
      scanCompletionSignal(scanId, website.user.id, completionSignal).throwIfAborted();
      setSklandAccountStoreCookies(response, request, completed.next, completed.previous);
      completionSignal.throwIfAborted();
      consumeScan(scanId, website.user.id);
      return response;
    }
    const response = successResponse({
      status: result.response.status,
      processing: result.response.processing,
      scheduleSnapshot: result.response.scheduleSnapshot,
      statusSnapshot: result.response.statusSnapshot,
    }, requestId);
    return response;
  } catch (error) {
    return sklandErrorResponse(error, requestId, "/api/skland/auth/qr/status", startedAt, request);
  }
}
