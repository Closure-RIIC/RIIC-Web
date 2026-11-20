import { createRequestId, enforceRateLimit, failureResponse, PublicApiError, successResponse } from "@riic/platform-server/api-contract";
import { websiteSession } from "@riic/platform-server/auth";
import { getReferralSummary, ReferralError } from "@riic/platform-server/referral/service";

export async function GET(request: Request) {
  const id = createRequestId();
  const start = performance.now();
  let response: Response;
  try {
    const session = await websiteSession(request);
    if (session?.user.id) enforceRateLimit("referral-summary", session.user.id, 60, 60_000);
    response = successResponse(await getReferralSummary(session?.user.id ?? null), id);
  } catch (error) {
    response = failureResponse(error instanceof ReferralError ? new PublicApiError("AIC-REQ-1001", { message: error.message }) : error, id, "/api/referral", start, "AIC-SYS-5000", request);
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
