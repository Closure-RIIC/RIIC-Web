import assert from "node:assert/strict";
import test from "node:test";
import { budgetPoints, createRatePolicyDraft, defaultRatePolicy, supplementalModelRate, parseRatePolicy, priceModelCall, tokenPoints } from "./rate-policy.ts";
test("rate drafts require an explicitly published multiplier", () => {
  const draft = createRatePolicyDraft();
  assert.equal(draft.markup, "");
  assert.throws(() => parseRatePolicy(draft));
  assert.throws(() => defaultRatePolicy(undefined as unknown as string));
  for (const markup of ["", "0", "-1", "NaN"]) assert.throws(() => defaultRatePolicy(markup));
  assert.equal(defaultRatePolicy("1.35").markup, "1.35");
  assert.equal(draft.markup, "", "supplying a multiplier does not mutate the unpublished template");
});
test("actual model rates preserve cache partition, precision, FX and peak boundaries", () => {
  const policy = defaultRatePolicy("1.2");
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

test("supplemental model uses its actual identity, RMB prices and the published markup", () => {
  const policy = parseRatePolicy(defaultRatePolicy("1.2"));
  const rate = supplementalModelRate();
  const usage = { inputTokens: 1_000_000, cachedInputTokens: 250_000, outputTokens: 100_000 };
  const cost = (at: string) => priceModelCall(policy, rate.provider, rate.model, usage, new Date(at));
  assert.deepEqual(cost("2026-11-16T01:00:00Z"), { upstreamRmb: "2.310000000000", chargedRmb: "2.772000000000" });
  assert.deepEqual(cost("2026-11-16T04:00:00Z"), { upstreamRmb: "1.155000000000", chargedRmb: "1.386000000000" });
  assert.equal(cost("2026-11-16T05:59:59Z").upstreamRmb, "1.155000000000");
  assert.equal(cost("2026-11-16T06:00:00Z").upstreamRmb, "2.310000000000");
  assert.equal(cost("2026-11-16T10:00:00Z").upstreamRmb, "1.155000000000");
  assert.equal(cost("2026-11-15T01:00:00Z").upstreamRmb, "1.155000000000");
  assert.equal(cost("2026-10-01T01:00:00Z").upstreamRmb, "1.155000000000");
  assert.equal(cost("2027-02-05T01:00:00Z").upstreamRmb, "1.155000000000");
  assert.equal(cost("2027-06-09T01:00:00Z").upstreamRmb, "1.155000000000");
  assert.equal(cost("2027-09-15T01:00:00Z").upstreamRmb, "1.155000000000");
  assert.equal(cost("2026-10-10T01:00:00Z").upstreamRmb, "1.155000000000", "make-up Saturday stays off-peak");
  assert.throws(() => priceModelCall(policy, "riic-deepseek", rate.model, usage, new Date()));
});

test("legacy policies stay readable and only the exact third model is accepted", () => {
  const policy = defaultRatePolicy("1.2");
  const legacy = { ...policy, models: policy.models.slice(0, 2) };
  assert.deepEqual(parseRatePolicy(legacy), legacy);
  assert.throws(() => parseRatePolicy({ ...policy, models: [policy.models[0], policy.models[2]] }));
  assert.throws(() => parseRatePolicy({ ...policy, models: [policy.models[0], policy.models[1], policy.models[1]] }));
  assert.throws(() => parseRatePolicy({ ...policy, models: [...policy.models, policy.models[2]] }));
  assert.throws(() => parseRatePolicy({ ...policy, models: policy.models.map((rate, i) => i === 2 ? { ...rate, provider: "untrusted" } : rate) }));
  for (const offPeakDates of [["2026-02-30"], ["2026-1-01"], ["2026-01-01", "2026-01-01"], ["private-value"]]) {
    assert.throws(() => parseRatePolicy({ ...policy, models: policy.models.map((rate, i) => i === 2 ? { ...rate, offPeakDates } : rate) }));
  }
  const parsed = parseRatePolicy(policy);
  parsed.models[2].offPeakDates!.push("2028-01-01");
  assert.notDeepEqual(parsed, policy, "parsed policy is an isolated snapshot");
});

test("all steps are summed before four-decimal settlement, while reservations round up", () => {
  const policy = defaultRatePolicy("1.2");
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
