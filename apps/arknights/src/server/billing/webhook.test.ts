import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import test from "node:test";
import type { AfdianOrder } from "./afdian.ts";

register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) {
  return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context);
} });

test("payment callback uses only verified provider data and rejects forged payments", async (t) => {
  const originalEnv = { ...process.env };
  t.after(() => { process.env = originalEnv; });
  let verified: AfdianOrder | null = null;
  const writes: unknown[] = [];
  let queries = 0;
  await t.mock.module(new URL("../../../../../packages/platform-server/src/api-contract.ts", import.meta.url), { namedExports: {
    PublicApiError: class extends Error {}, createRequestId: () => "test",
    readJsonBody: (request: Request) => request.json(),
    failureResponse: () => Response.json({}, { status: 403 }),
  } });
  await t.mock.module(new URL("./afdian.ts", import.meta.url), { namedExports: { findAfdianOrderByOutTradeNo: async () => { queries++; return verified; } } });
  await t.mock.module(new URL("./payments.ts", import.meta.url), { namedExports: {
    afdianPaymentFacts: (order: AfdianOrder) => ({ customOrderId: order.custom_order_id ?? null }),
    processAfdianPayment: async (order: AfdianOrder) => { writes.push(order); return { accepted: order.status === 2, recorded: true }; },
  } });
  process.env.AFDIAN_WEBHOOK_SECRET = "";
  const { POST } = await import("../../app/api/billing/webhooks/afdian/route.ts");
  const sample = { ec: 200, data: { type: "order", order: {
    out_trade_no: "202106232138371083454010626", user_id: "adf397fe8374811eaacee52540025c377",
    plan_id: "a45353328af911eb973052540025c377", status: 2, total_amount: "5.00", remark: "",
  } } };
  for (const body of [undefined, "{}", JSON.stringify(sample)]) {
    const probe = await POST(new Request("https://riic.test/api/billing/webhooks/afdian", { method: "POST", body }));
    assert.equal(probe.status, 200);
    const payload = await probe.json();
    assert.equal(payload.ec, 200);
    assert.equal(payload.data.accepted, false, "health/test acknowledgments must never represent a fulfilled payment");
  }
  assert.equal(queries, 0, "probes must not depend on upstream API availability");
  assert.equal(writes.length, 0);
  const alteredSample = { ...sample, custom_order_id: "riic-forged" };
  assert.equal((await POST(new Request("https://riic.test/api/billing/webhooks/afdian", { method: "POST", body: JSON.stringify(alteredSample) }))).status, 403);
  assert.equal(writes.length, 0, "adding a payment reference must not bypass verification");
  const request = (trade = "real-trade") => new Request("https://riic.test/api/billing/webhooks/afdian", {
    method: "POST", body: JSON.stringify({ custom_order_id: "riic-forged", out_trade_no: trade, status: 2,
      data: { order: { custom_order_id: "riic-forged", total_amount: "999", status: 2 } } }),
  });
  assert.equal((await POST(request())).status, 403);
  verified = { out_trade_no: "other-trade", custom_order_id: "riic-real", status: 2, total_amount: "1" };
  assert.equal((await POST(request())).status, 403);
  verified.out_trade_no = "real-trade";
  verified.status = 0;
  assert.equal((await (await POST(request())).json()).data.accepted, false);
  delete verified.status;
  assert.equal((await (await POST(request())).json()).data.accepted, false);
  assert.equal(writes.length, 2, "verified unsuccessful notifications are recorded but not fulfilled");
  verified.status = 2;
  assert.equal((await (await POST(request())).json()).data.accepted, true);
  assert.deepEqual(writes.at(-1), verified, "only authenticated API data reaches payment persistence");
  verified = { out_trade_no: "real-trade", status: 2, total_amount: "5.00", remark: "DIAG-test" };
  assert.equal((await (await POST(request())).json()).data.recorded, true);
  assert.deepEqual(writes.at(-1), verified, "paid orders without a reference must also be persisted");
  process.env.AFDIAN_WEBHOOK_SECRET = "test-only-secret";
  assert.equal((await POST(request())).status, 403);
  assert.equal(writes.length, 4);
});
