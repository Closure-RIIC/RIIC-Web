import assert from "node:assert/strict";
import test from "node:test";
import { budgetPoints, defaultRatePolicy, parseRatePolicy, priceModelCall, tokenPoints } from "./rate-policy.ts";
test("actual model rates preserve cache partition, precision, FX and peak boundaries", () => {
  const policy = defaultRatePolicy();
  const usage = { inputTokens: 1_000_000, cachedInputTokens: 400_000, outputTokens: 100_000 };
  assert.deepEqual(priceModelCall(policy,"riic-deepseek","deepseek-v4.1-flash",usage,new Date("2026-10-12T01:00:00Z")), { upstreamRmb: "2.016000000000", chargedRmb: "2.419200000000" });
  assert.equal(priceModelCall(policy,"riic-deepseek","deepseek-v4.1-flash",usage,new Date("2026-10-12T04:00:00Z")).upstreamRmb,"1.008000000000");
  assert.equal(tokenPoints(policy,["0.01","0.01"]),0.2);
  assert.equal(tokenPoints(policy,[]),0);
  assert.throws(() => priceModelCall(policy,"unknown","unknown",usage,new Date()));
  assert.throws(() => priceModelCall(policy,"riic-glm","glm-5.3-flash",{...usage,cachedInputTokens:2_000_000},new Date()));
  assert.throws(() => parseRatePolicy({...policy,pointValueRmb:"1"}));
  const fx = structuredClone(policy); fx.models[1].currency="USD";fx.models[1].exchangeRate="7";
  assert.equal(priceModelCall(fx,"riic-glm","glm-5.3-flash",{inputTokens:1_000_000,cachedInputTokens:0,outputTokens:0},new Date()).upstreamRmb,"7.560000000000");
  assert.ok(budgetPoints(policy,20_000,2048)>0);
  assert.throws(() => budgetPoints(policy,512_001,2048));
});

test("all steps are summed before four-decimal settlement, while reservations round up", () => {
  const policy = defaultRatePolicy();
  assert.equal(tokenPoints(policy, ["0.000004", "0.000004"]), 0.0001);
  assert.equal(tokenPoints(policy, ["0.000005"]), 0.0001);
  assert.equal(tokenPoints(policy, ["0.0000049"]), 0);
  assert.equal(tokenPoints(policy, ["0.0015624"]), 0.0156);
  const budget = budgetPoints(policy, 0, 1);
  assert.ok(budget > 0 && budget < 1);
  for (const rate of policy.models) {
    const cost = priceModelCall(policy, rate.provider, rate.model, { inputTokens: 8192, cachedInputTokens: 0, outputTokens: 1 }, new Date("2026-10-20T01:00:00Z"));
    assert.ok(budget >= tokenPoints(policy, [cost.chargedRmb]));
  }
});
