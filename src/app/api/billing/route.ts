import { assertSameOrigin, createRequestId, failureResponse, readJsonBody, successResponse, PublicApiError } from "@/server/api-contract";
import { requireFeatureActor, requireFeatureSession } from "@/server/auth/feature-access";
import { BillingError, createBillingOrder, getWallet, listBillingProducts, listLedger, listOrders, listUsage } from "@/server/billing/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeBillingError(error: unknown): unknown {
  if (!(error instanceof BillingError)) return error;
  if (error.code === "insufficient_points") return new PublicApiError("AIC-BILLING-4101", { message: error.message });
  if (error.code === "invalid_product") return new PublicApiError("AIC-BILLING-4102", { message: error.message });
  if (error.code === "checkout_unavailable") return new PublicApiError("AIC-BILLING-4106", { message: error.message });
  return new PublicApiError("AIC-BILLING-4103", { message: error.message });
}

export async function GET(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    const { session, isAdmin } = await requireFeatureActor(request, "billing");
    const url = new URL(request.url);
    const [wallet, ledger, orders, usage] = await Promise.all([
      getWallet(session.user.id),
      listLedger(session.user.id, Number(url.searchParams.get("ledgerLimit") ?? 40)),
      listOrders(session.user.id),
      listUsage(session.user.id),
    ]);
    const canSimulatePayment = isAdmin && (process.env.NODE_ENV !== "production" || process.env.BILLING_PROTOTYPE_MODE === "1");
    return successResponse({ products: listBillingProducts(), wallet, ledger, orders, usage, canSimulatePayment, canManageCodes: isAdmin }, requestId);
  } catch (error) {
    return failureResponse(normalizeBillingError(error), requestId, "/api/billing", startedAt, "AIC-SYS-5000", request);
  }
}

export async function POST(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSameOrigin(request);
    const session = await requireFeatureSession(request, "billing");
    const body = await readJsonBody(request, 32 * 1024) as { productId?: unknown; provider?: unknown };
    if (typeof body.productId !== "string" || body.productId.length > 80) throw new PublicApiError("AIC-BILLING-4102");
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    const result = await createBillingOrder(session.user.id, body.productId, typeof body.provider === "string" ? body.provider : "afdian", idempotencyKey && idempotencyKey.length <= 120 ? idempotencyKey : undefined);
    return successResponse(result, requestId, 201);
  } catch (error) {
    return failureResponse(normalizeBillingError(error), requestId, "/api/billing", startedAt, "AIC-SYS-5000", request);
  }
}
