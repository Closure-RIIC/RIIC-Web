import {
  assertSameOrigin,
  createRequestId,
  PublicApiError,
  readJsonBody,
  requestClientIp,
  successResponse,
} from "@/server/api-contract";
import { consumeScan, pollScan } from "@/server/skland/adapter";
import {
  assertSklandAvailable,
  assertSklandFeatureEnabled,
  setSklandAccountStoreCookies,
  sklandErrorResponse,
} from "@/server/skland/http";
import { requireWebsiteSession } from "@/server/auth/authorization";
import { finalizeSklandAuthentication } from "@/server/skland/auth-completion";
import { enforceSklandPollRateLimit } from "@/server/skland/poll-rate-limit";


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
      request.signal.throwIfAborted();
      const completed = await finalizeSklandAuthentication(website.user.id, {
        session: result.session,
        snapshot: result.response.scheduleSnapshot,
        statusSnapshot: result.response.statusSnapshot,
      }, request.signal);
      request.signal.throwIfAborted();
      const response = successResponse({
        status: result.response.status,
        scheduleSnapshot: completed.data.scheduleSnapshot,
        statusSnapshot: completed.data.statusSnapshot,
        accounts: completed.data.accounts,
        activeAccountId: completed.data.activeAccountId,
        bindingCount: completed.data.bindingCount,
        bindingSummary: completed.data.bindingSummary,
      }, requestId);
      setSklandAccountStoreCookies(response, request, completed.next, completed.previous);
      request.signal.throwIfAborted();
      consumeScan(scanId, website.user.id);
      return response;
    }
    const response = successResponse({
      status: result.response.status,
      scheduleSnapshot: result.response.scheduleSnapshot,
      statusSnapshot: result.response.statusSnapshot,
    }, requestId);
    return response;
  } catch (error) {
    return sklandErrorResponse(error, requestId, "/api/skland/auth/qr/status", startedAt, request);
  }
}
