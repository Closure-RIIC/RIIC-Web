import { createRequestId, failureResponse, readJsonBody, PublicApiError } from "@riic/platform-server/api-contract";
import { findAfdianOrderByOutTradeNo } from "@/server/billing/afdian";
import { fulfillBillingOrder } from "@/server/billing/service";


type AfdianPrototypePayload = {
  custom_order_id?: unknown;
  out_trade_no?: unknown;
  status?: unknown;
  ec?: unknown;
  data?: {
    type?: unknown;
    order?: {
      out_trade_no?: unknown;
      user_id?: unknown;
      plan_id?: unknown;
      status?: unknown;
      total_amount?: unknown;
      remark?: unknown;
      custom_order_id?: unknown;
    };
  };
};

function afdianAck(requestId: string, data: Record<string, unknown> = {}) {
  return Response.json({ ec: 200, em: "", data: { ...data, request_id: requestId } }, { status: 200, headers: { "X-Request-Id": requestId } });
}

// Afdian's dashboard tester may probe the configured address with GET before
// sending the real JSON POST webhook. Keep this probe fast and return the same
// success envelope used by the provider callback.
export async function GET() {
  return afdianAck(createRequestId(), { accepted: true, method: "health_check" });
}

export async function POST(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    const expected = process.env.AFDIAN_WEBHOOK_SECRET?.trim();
    if (expected && request.headers.get("x-afdian-prototype-secret") !== expected) {
      throw new PublicApiError("AIC-BILLING-4104");
    }
    if (request.body === null || request.headers.get("content-length") === "0") {
      return afdianAck(requestId, { accepted: false, method: "health_check" });
    }
    const body = await readJsonBody(request, 64 * 1024) as AfdianPrototypePayload;
    if (body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 0) {
      return afdianAck(requestId, { accepted: false, method: "health_check" });
    }
    const order = body.data?.order;
    // The creator dashboard sends the public example order to validate the URL.
    // Acknowledge this exact fixture as a probe, never as a payment. All real
    // notifications still go through the authenticated query-order API below.
    // Source: https://guide.afdian.com/creator/developer
    if (body.ec === 200 && body.data?.type === "order"
      && order?.out_trade_no === "202106232138371083454010626"
      && order.user_id === "adf397fe8374811eaacee52540025c377"
      && order.plan_id === "a45353328af911eb973052540025c377"
      && !order.custom_order_id && !order.remark && !body.custom_order_id) {
      return afdianAck(requestId, { accepted: false, method: "dashboard_test" });
    }
    const outTradeNo = typeof order?.out_trade_no === "string" ? order.out_trade_no : typeof body.out_trade_no === "string" ? body.out_trade_no : undefined;
    if (!outTradeNo || outTradeNo.length > 128) throw new PublicApiError("AIC-BILLING-4104");
    // A callback is an untrusted notification, not proof of payment. Always
    // authenticate the transaction through the provider, even with a local ID.
    const queriedOrder = await findAfdianOrderByOutTradeNo(outTradeNo);
    if (!queriedOrder || queriedOrder.out_trade_no !== outTradeNo) throw new PublicApiError("AIC-BILLING-4104");
    const customOrderIdCandidates = [queriedOrder.custom_order_id, queriedOrder.remark]
      .filter((value): value is string => typeof value === "string" && /^riic-[a-z0-9]+$/i.test(value.trim()))
      .map((value) => value.trim());
    const customOrderId = customOrderIdCandidates[0] ?? null;
    const status = queriedOrder.status;
    const totalAmount = queriedOrder.total_amount !== undefined ? Number(queriedOrder.total_amount) : undefined;
    console.info(JSON.stringify({
      level: "info",
      event: "afdian_webhook_received",
      requestId,
      outTradeNo,
      customOrderId,
      status,
      totalAmount,
      matched: Boolean(customOrderId),
    }));
    if (!customOrderId || Number(status) !== 2) {
      return afdianAck(requestId, { accepted: false, reason: "payment_not_success_or_unmatched" });
    }
    if (totalAmount === undefined || !Number.isFinite(totalAmount)) {
      return afdianAck(requestId, { accepted: false, reason: "payment_amount_missing" });
    }
    const result = await fulfillBillingOrder({
      customOrderId,
      providerOrderId: outTradeNo,
      amountFen: Math.round(totalAmount * 100),
    });
    return afdianAck(requestId, { accepted: true, idempotent: result.idempotent });
  } catch (error) {
    return failureResponse(error, requestId, "/api/billing/webhooks/afdian", startedAt, "AIC-SYS-5000", request);
  }
}
