import assert from "node:assert/strict";
import test from "node:test";
import { billingDetailReplacer, billingProviderDisplay } from "./billing-presentation.ts";

const models = [{ provider: "model-source-a", role: "primary" }, { provider: "model-source-c", role: "reserve" }] as const;
const labels = { primary: "首选模型", secondary: "第二模型", reserve: "备用模型", modelService: "模型服务" };

test("model records use neutral labels while payment tables retain their channel", () => {
  assert.equal(billingProviderDisplay("model-source-c", { model: "reserve-model" }, models, labels), "备用模型");
  assert.equal(billingProviderDisplay("unlisted-model-source", { model: "custom-model" }, models, labels), "模型服务");
  assert.equal(billingProviderDisplay("afdian", { provider: "afdian", amount_fen: 500 }, models, labels), "afdian");
});

test("mixed billing details preserve payment references and audit data while presenting model names", () => {
  const record = {
    payment: { provider: "afdian", provider_order_id: "afdian-123", amount_fen: 500 },
    calls: [{ provider: "model-source-a", model: "first-model", call_provider: "model-source-c", tokenPoints: null }],
    unknownCall: { provider: "unlisted-model-source", model: "custom-model" },
  };
  const original = structuredClone(record);
  const displayed = JSON.parse(JSON.stringify(record, billingDetailReplacer(models, labels)));
  assert.deepEqual(displayed.payment, record.payment);
  assert.equal(displayed.calls[0].provider, "首选模型");
  assert.equal(displayed.calls[0].call_provider, "备用模型");
  assert.equal(displayed.unknownCall.provider, "模型服务");
  assert.equal(displayed.calls[0].tokenPoints, null);
  assert.deepEqual(record, original);
});

test("missing provider evidence stays null in both cells and details", () => {
  const record = { model: "custom-model", provider: null, tokenPoints: null };
  assert.equal(billingProviderDisplay(record.provider, record, models, labels), null);
  assert.deepEqual(JSON.parse(JSON.stringify(record, billingDetailReplacer(models, labels))), record);
});
