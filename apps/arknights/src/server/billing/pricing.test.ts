import test from "node:test";
import assert from "node:assert/strict";

import { calculateAgentTokenCost, sumAgentCacheWriteTokens } from "./pricing.ts";
import { defaultRatePolicy, priceModelCall, tokenPoints } from "./rate-policy.ts";

const policy = defaultRatePolicy("1.2");
const at = new Date("2026-09-27T00:00:00.000Z");

test("direct billing uses the published RMB off-peak price and multiplier", () => {
  const result = calculateAgentTokenCost(policy, "riic-deepseek", "deepseek-v4.1-flash", { inputTokens: 1_000_000, outputTokens: 1_000_000 }, at);
  assert.ok(result);
  assert.equal(result.sourceCurrency, "RMB");
  assert.equal(result.providerCostRmbFen, 500);
  assert.equal(result.chargedCostRmbFen, 600);
  assert.equal(result.chargedPoints, 60);
  assert.equal(result.cacheHitRate, 0);
});

test("token cache is an exclusive input bucket", () => {
  const result = calculateAgentTokenCost(policy, "riic-deepseek", "deepseek-v4.1-flash", { inputTokens: 1_000_000, cachedInputTokens: 250_000, outputTokens: 0 }, at);
  assert.ok(result);
  assert.equal(result.uncachedInputTokens, 750_000);
  assert.equal(result.cacheHitRate, 0.25);
  assert.equal(result.providerCostRmbFen, 75.5);
  assert.equal(result.chargedPoints, 9.06);
});

test("GLM-5.3-Flash returns RMB settlement values", () => {
  const result = calculateAgentTokenCost(policy, "riic-glm", "glm-5.3-flash", { inputTokens: 1_000_000, outputTokens: 1_000_000 }, at);
  assert.ok(result);
  assert.equal(result.sourceCurrency, "RMB");
  assert.equal(result.providerCostRmbFen, 468);
  assert.equal(result.chargedCostRmbFen, 561.6);
  assert.equal(result.chargedPoints, 56.16);
});

test("unknown provider or model is rejected without matching by name", () => {
  for (const [provider, model] of [["riic-deepseek", "unknown-model"], ["riic-deepseek", "other-deepseek-model"], ["riic-glm", "deepseek-v4.1-flash"]]) {
    assert.throws(() => calculateAgentTokenCost(policy, provider, model, { inputTokens: 100, outputTokens: 20 }), /Unknown actual model rate/);
  }
});

test("missing and invalid usage cannot become a zero-token charge", () => {
  for (const usage of [{ outputTokens: 20 }, { inputTokens: 100 }, { inputTokens: -1, outputTokens: 20 }, { inputTokens: 1.5, outputTokens: 20 }, { inputTokens: 100, outputTokens: 20, cachedInputTokens: 101 }]) {
    assert.throws(() => calculateAgentTokenCost(policy, "riic-deepseek", "deepseek-v4.1-flash", usage));
  }
  assert.equal(calculateAgentTokenCost(policy, "riic-deepseek", "deepseek-v4.1-flash", { inputTokens: 0, outputTokens: 0 }).chargedPoints, 0);
});

test("direct and gateway billing share the supplied snapshot including custom prices and FX", () => {
  const snapshot = defaultRatePolicy("1.75");
  snapshot.models[1] = { ...snapshot.models[1], currency: "USD", exchangeRate: "7.2", input: "0.3", cachedInput: "0.05", output: "0.9" };
  const usage = { inputTokens: 1_000_000, cachedInputTokens: 250_000, outputTokens: 100_000 };
  const gateway = priceModelCall(snapshot, "riic-glm", "glm-5.3-flash", usage, at);
  const direct = calculateAgentTokenCost(snapshot, "riic-glm", "glm-5.3-flash", usage, at);
  assert.equal(gateway.upstreamRmb, "2.358000000000");
  assert.equal(gateway.chargedRmb, "4.126500000000");
  assert.equal(direct.providerCostRmbFen, 235.8);
  assert.equal(direct.chargedCostRmbFen, 412.65);
  assert.equal(direct.chargedPoints, tokenPoints(snapshot, [gateway.chargedRmb]));
  assert.equal(direct.chargedPoints, 41.265);
});

test("small conversations charge actual token cost without a one-point or one-cent minimum", () => {
  const result = calculateAgentTokenCost(policy, "riic-deepseek", "deepseek-v4.1-flash", { inputTokens: 1000, cachedInputTokens: 100, outputTokens: 100 }, at);
  assert.ok(result);
  assert.equal(result.providerCostRmbFen, 0.1302);
  assert.equal(result.chargedCostRmbFen, 0.15624);
  assert.equal(result.chargedPoints, 0.0156);
});

test("direct cache writes use the published bucket while historical rates keep their formula", () => {
  const snapshot = defaultRatePolicy("1.2");
  const usage = { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 100, cacheWriteTokens: 200 };
  const historical = calculateAgentTokenCost(snapshot, "riic-deepseek", "deepseek-v4.1-flash", usage, at);
  assert.equal(historical.chargedPoints, 0.0156);
  assert.equal(historical.cacheWriteTokens, 200);
  const rate = snapshot.models[0]; rate.cacheWrite = "3"; rate.peak!.cacheWrite = "6";
  const priced = calculateAgentTokenCost(snapshot, rate.provider, rate.model, usage, at);
  assert.equal(priced.uncachedInputTokens, 700);
  assert.equal(priced.chargedPoints, 0.0204);
  assert.equal(calculateAgentTokenCost(snapshot, rate.provider, rate.model, { ...usage, cacheWriteTokens: 0 }, at).chargedPoints, historical.chargedPoints);
  assert.throws(() => calculateAgentTokenCost(snapshot, rate.provider, rate.model, { inputTokens: 1000, outputTokens: 100 }, at), /Unmeasured cache-write usage/);
  for (const cacheWriteTokens of [-1, 0.5, 901, Number.NaN]) {
    assert.throws(() => calculateAgentTokenCost(snapshot, rate.provider, rate.model, { ...usage, cacheWriteTokens }, at), /Invalid cache-write usage/);
  }
});

test("cache-write totals require every model step and distinguish zero, missing and invalid counters", () => {
  const step = (cacheWriteTokens?: number) => ({ inputTokens: 100, inputTokenDetails: { cacheReadTokens: 20, cacheWriteTokens } });
  assert.equal(sumAgentCacheWriteTokens([step(0), step(0)]), 0);
  assert.equal(sumAgentCacheWriteTokens([step(10), step(20)]), 30);
  assert.equal(sumAgentCacheWriteTokens([step(10), step()]), undefined);
  assert.equal(sumAgentCacheWriteTokens([]), undefined);
  for (const count of [-1, 0.5, 81, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => sumAgentCacheWriteTokens([step(count)]), /Invalid cache-write usage/);
  }
  assert.throws(() => sumAgentCacheWriteTokens([step(-1), step(1)]), /Invalid cache-write usage/);
});

test("direct adapters preserve raw missing counters instead of accepting synthesized SDK zero", () => {
  const step = { inputTokens: 100, inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 0 } };
  assert.equal(sumAgentCacheWriteTokens([{ ...step, raw: { input_tokens: 100, output_tokens: 10 } }]), undefined);
  assert.equal(sumAgentCacheWriteTokens([{ ...step, raw: { input_tokens: 100, cache_creation_input_tokens: 0 } }]), 0);
  assert.equal(sumAgentCacheWriteTokens([{ ...step, inputTokenDetails: { cacheWriteTokens: 20 }, raw: { input_tokens: 80, cache_creation_input_tokens: 20 } }]), 20);
  const compatible = { inputTokens: 100, inputTokenDetails: { cacheReadTokens: 0 } };
  assert.equal(sumAgentCacheWriteTokens([{ ...compatible, raw: { prompt_tokens: 100, prompt_tokens_details: { cache_write_tokens: 20 } } }]), 20);
  assert.equal(sumAgentCacheWriteTokens([{ ...compatible, raw: { prompt_tokens: 100 } }]), undefined);
  assert.throws(() => sumAgentCacheWriteTokens([{ ...step, raw: { cache_creation_input_tokens: 20 } }]), /Invalid cache-write usage/);
  assert.throws(() => sumAgentCacheWriteTokens([{ ...compatible, raw: { prompt_tokens_details: { cache_write_tokens: -1 } } }]), /Invalid cache-write usage/);
});
