import { assertSameOrigin, createRequestId, enforceRateLimit, failureResponse, readJsonBody, successResponse, PublicApiError } from "@/server/api-contract";
import { requireFeatureSession } from "@/server/auth/feature-access";
import { BillingError, issueGiftCdk, redeemGiftCdk } from "@/server/billing/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSameOrigin(request);
    const session = await requireFeatureSession(request, "billing");
    enforceRateLimit("billing-cdk", session.user.id, 20, 60_000);
    const body = await readJsonBody(request, 8 * 1024) as { action?: unknown; points?: unknown; code?: unknown };
    if (body.action === "issue" && typeof body.points === "number") {
      return successResponse(await issueGiftCdk(session.user.id, body.points), requestId, 201);
    }
    if (body.action === "redeem" && typeof body.code === "string" && body.code.length <= 80) {
      return successResponse(await redeemGiftCdk(session.user.id, body.code), requestId);
    }
    throw new PublicApiError("AIC-REQ-1001");
  } catch (error) {
    const normalized = error instanceof BillingError
      ? new PublicApiError(error.code === "insufficient_points" ? "AIC-BILLING-4101" : "AIC-BILLING-4105", { message: error.message })
      : error;
    return failureResponse(normalized, requestId, "/api/billing/cdk", startedAt, "AIC-SYS-5000", request);
  }
}
