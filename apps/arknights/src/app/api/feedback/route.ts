import { saveFeedback } from "@riic/platform-server/infra";
import { websiteSession as readWebsiteSession } from "@riic/platform-server/auth";
import { activeSklandAccount, readSklandAccountStore } from "@riic/platform-server/skland/http";
import { sklandDataOwnerTag } from "@riic/platform-server/skland/session";
import {
  assertSameOrigin,
  createRequestId,
  enforceRateLimit,
  failureResponse,
  readJsonBody,
  requestClientIp,
  successResponse,
  validateFeedbackRequest,
} from "@riic/platform-server/api-contract";


export async function POST(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSameOrigin(request);
    enforceRateLimit("feedback", requestClientIp(request), 5, 60 * 60_000);
    const body = await readJsonBody(request, 2 * 1024 * 1024);
    validateFeedbackRequest(body);
    const websiteSession = await readWebsiteSession(request).catch(() => null);
    const sklandAccount = body.reproduction.sourceType === "skland"
      ? activeSklandAccount(await readSklandAccountStore())
      : null;
    return successResponse(await saveFeedback(body, {
      userId: websiteSession?.user.id ?? null,
      dataOwnerTag: sklandAccount ? sklandDataOwnerTag(sklandAccount.session.userId) : null,
    }), requestId);
  } catch (error) {
    return failureResponse(error, requestId, "/api/feedback", startedAt, "AIC-FEEDBACK-4002");
  }
}
