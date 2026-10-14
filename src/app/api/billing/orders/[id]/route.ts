import { createRequestId, failureResponse, successResponse, PublicApiError } from "@/server/api-contract";
import { requireFeatureSession } from "@/server/auth/feature-access";
import { getOrder, getWallet } from "@/server/billing/service";


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
