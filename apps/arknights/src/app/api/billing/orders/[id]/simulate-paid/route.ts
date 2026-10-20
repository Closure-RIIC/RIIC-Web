import { assertSameOrigin, createRequestId, failureResponse, successResponse, PublicApiError } from "@/server/api-contract";
import { requireFeatureSession } from "@/server/auth/feature-access";
import { requireWebsiteAdmin } from "@/server/auth/authorization";
import { BillingError, fulfillBillingOrder, getOrder } from "@/server/billing/service";


export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    if (process.env.NODE_ENV === "production" && process.env.BILLING_PROTOTYPE_MODE !== "1") {
      throw new PublicApiError("AIC-AUTH-2007");
    }
    assertSameOrigin(request);
    const session = await requireFeatureSession(request, "billing");
    // Test crediting must never become public when billing is launched.
    await requireWebsiteAdmin(request);
    const { id } = await context.params;
    const current = await getOrder(session.user.id, id);
    if (!current) throw new PublicApiError("AIC-BILLING-4103", { message: "订单不存在。" });
    const result = await fulfillBillingOrder({ orderId: id, userId: session.user.id, amountFen: current.amountFen, providerOrderId: `prototype-${id}` });
    return successResponse(result, requestId);
  } catch (error) {
    const normalized = error instanceof BillingError
      ? new PublicApiError(error.code === "insufficient_points" ? "AIC-BILLING-4101" : error.code === "invalid_product" ? "AIC-BILLING-4102" : error.code === "checkout_unavailable" ? "AIC-BILLING-4106" : "AIC-BILLING-4103", { message: error.message })
      : error;
    return failureResponse(normalized, requestId, "/api/billing/orders/[id]/simulate-paid", startedAt, "AIC-SYS-5000", request);
  }
}
