import { assertSameOrigin, enforceRateLimit, createRequestId, failureResponse, successResponse, PublicApiError } from "@riic/platform-server/api-contract";
import { requireFeatureSession } from "@/server/auth/feature-access";
import { getOrder, getWallet, hidePendingOrder } from "@/server/billing/service";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSameOrigin(request);
    const session = await requireFeatureSession(request, "billing");
    enforceRateLimit("billing-hide-order", session.user.id, 30, 60_000);
    const { id } = await context.params;
    if (!id || id.length > 120) throw new PublicApiError("AIC-DATA-8004");
    if (!await hidePendingOrder(session.user.id, id)) throw new PublicApiError("AIC-BILLING-4103", { message: "订单不存在或已付款，请刷新后重试。" });
    return successResponse({ deleted: true }, requestId);
  } catch (error) {
    return failureResponse(error, requestId, "/api/billing/orders/[id]", startedAt, "AIC-SYS-5000", request);
  }
}


export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    const session = await requireFeatureSession(request, "billing");
    const { id } = await context.params;
    const order = await getOrder(session.user.id, id);
    if (!order) throw new PublicApiError("AIC-DATA-8004");
    return successResponse({ order, wallet: await getWallet(session.user.id) }, requestId);
  } catch (error) {
    return failureResponse(error, requestId, "/api/billing/orders/[id]", startedAt, "AIC-SYS-5000", request);
  }
}
