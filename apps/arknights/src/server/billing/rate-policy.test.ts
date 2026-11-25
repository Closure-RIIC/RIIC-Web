import assert from "node:assert/strict";
import test from "node:test";
import { budgetPoints, createRatePolicyDraft, defaultRatePolicy, supplementalModelRate, parseRatePolicy, priceModelCall, tokenPoints, modelBudgetRoutes, type LongContextRate, type ModelRate } from "./rate-policy.ts";
test("rate drafts require an explicitly published multiplier", () => {
  const draft = createRatePolicyDraft();
  assert.equal(draft.markup, "");
  assert.ok(draft.models.every(rate => !rate.offPeakDates?.length), "draft templates leave off-peak dates for administrators to enter");
  assert.throws(() => parseRatePolicy(draft));
  assert.throws(() => defaultRatePolicy(undefined as unknown as string));
  for (const markup of ["", "0", "-1", "NaN"]) assert.throws(() => defaultRatePolicy(markup));
  assert.equal(defaultRatePolicy("1.35").markup, "1.35");
  assert.equal(draft.markup, "", "supplying a multiplier does not mutate the unpublished template");
});


// Synthetic published prices exercise accounting; these are not provider quotes.
const gptRate: ModelRate = { provider: "riic-gpt", model: "gpt-6.1-sol", currency: "USD", exchangeRate: "7", input: "5", cachedInput: "1", output: "15" };
const gptLongContext: LongContextRate = { inputTokenThreshold: 272000, input: "10", cachedInput: "2", output: "22.5" };
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
  assert.equal(cost("2027-02-05T01:00:00Z").upstreamRmb, "2.310000000000", "weekdays use peak prices without a published calendar override");
  policy.models[2].offPeakDates = ["2027-02-05"];
  assert.equal(cost("2027-02-05T01:00:00Z").upstreamRmb, "1.155000000000", "administrator-entered dates override the weekday peak window");
  assert.equal(cost("2027-02-08T01:00:00Z").upstreamRmb, "2.310000000000", "other weekdays retain peak prices");
  assert.equal(cost("2026-10-10T01:00:00Z").upstreamRmb, "1.155000000000", "make-up Saturday stays off-peak");
  assert.throws(() => priceModelCall(policy, "riic-deepseek", rate.model, usage, new Date()));
});

test("legacy policies stay readable and route identities remain distinct", () => {
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
  policy.models[2].offPeakDates = ["2028-01-01"];
  const parsed = parseRatePolicy(policy);
  parsed.models[2].offPeakDates!.push("2028-01-02");
  assert.deepEqual(policy.models[2].offPeakDates, ["2028-01-01"], "published calendars remain unchanged");
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

function twoRoutePolicy() {
  const policy = defaultRatePolicy("1.2");
  policy.models = policy.models.slice(0, 2);
  return policy;
}
test("published rates retain old snapshots and accept configured model identities without inventing GPT prices", () => {
  const historical = twoRoutePolicy();
  assert.deepEqual(parseRatePolicy(historical), historical);
  assert.equal(historical.models.some(rate => rate.provider === "riic-gpt"), false);
  const configured = structuredClone(historical);
  configured.models[0].model = "deepseek-flash";
  configured.models[1].model = "vendor/glm-flash-latest";
  configured.models.push(structuredClone(gptRate));
  assert.deepEqual(parseRatePolicy(configured), configured);
  assert.equal(historical.models.length, 2);
  for (const replacement of [
    { ...gptRate, provider: "unknown" }, { ...gptRate, provider: "riic-glm" },
    { ...gptRate, model: "" }, { ...gptRate, model: "gpt sol" },
    { ...gptRate, input: "" }, { ...gptRate, input: "0" }, { ...gptRate, output: "0" },
  ]) assert.throws(() => parseRatePolicy({ ...historical, models: [...historical.models, replacement] }));
  assert.throws(() => parseRatePolicy({ ...historical, models: [historical.models[0], gptRate] }));
});

test("selected model budgets do not reserve other models and cover every permitted cache and peak partition", () => {
  const policy = twoRoutePolicy();
  const budget = { provider: "riic-deepseek", model: "deepseek-v4.1-flash", inputTokens: 12_000, maxOutputTokens: 2048 };
  const before = budgetPoints(policy, budget);
  policy.models.push(structuredClone(gptRate));
  assert.equal(budgetPoints(policy, budget), before);
  const selected = { ...budget, provider: gptRate.provider, model: gptRate.model };
  assert.ok(budgetPoints(policy, selected) > before);
  const rate = policy.models[2];
  rate.peak = { input: "8", cachedInput: "10", output: "20" };
  for (const at of [new Date("2026-10-20T01:00:00Z"), new Date("2026-10-20T04:00:00Z")]) {
    for (const cachedInputTokens of [0, selected.inputTokens / 2, selected.inputTokens]) {
      const priced = priceModelCall(policy, rate.provider, rate.model, {
        inputTokens: selected.inputTokens, cachedInputTokens, outputTokens: selected.maxOutputTokens,
      }, at);
      assert.ok(budgetPoints(policy, selected) >= tokenPoints(policy, [priced.chargedRmb]));
    }
  }
  assert.throws(() => budgetPoints(twoRoutePolicy(), selected), /Unknown actual model rate/);
  assert.throws(() => budgetPoints(policy, { ...selected, model: "wrong-alias" }), /Unknown actual model rate/);
  for (const inputTokens of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => budgetPoints(policy, { ...selected, inputTokens }));
  for (const maxOutputTokens of [0, 4097, NaN, 1.5]) assert.throws(() => budgetPoints(policy, { ...selected, maxOutputTokens }));
  assert.ok(budgetPoints(policy, { ...selected, inputTokens: 262_144, maxOutputTokens: 4096 }) > 0);
});

test("image and reasoning usage are validated subsets and never charged twice", () => {
  const policy = twoRoutePolicy(); policy.models.push(structuredClone(gptRate));
  const usage = { inputTokens: 1000, cachedInputTokens: 100, outputTokens: 100 };
  const at = new Date("2026-10-20T04:00:00Z");
  const price = priceModelCall(policy, gptRate.provider, gptRate.model, usage, at);
  assert.deepEqual(priceModelCall(policy, gptRate.provider, gptRate.model, { ...usage, imageTokens: 600, reasoningTokens: 80 }, at), price);
  assert.deepEqual(priceModelCall(policy, gptRate.provider, gptRate.model, { ...usage, imageTokens: undefined, reasoningTokens: undefined }, at), price);
  for (const detail of [{ imageTokens: 1001 }, { reasoningTokens: 101 }, { imageTokens: -1 }, { reasoningTokens: 1.5 }, { imageTokens: NaN }]) {
    assert.throws(() => priceModelCall(policy, gptRate.provider, gptRate.model, { ...usage, ...detail }, at), /Invalid token detail usage/);
  }
  assert.throws(() => priceModelCall(policy, gptRate.provider, gptRate.model, { ...usage, inputTokens: undefined } as never, at), /Unmeasured token usage/);
});

test("GPT long-context rates are explicit versioned prices and preserve historical snapshots", () => {
  const historical = twoRoutePolicy(); historical.models.push(structuredClone(gptRate));
  const serialized = JSON.stringify(historical);
  const policy = structuredClone(historical); policy.models[2].longContext = structuredClone(gptLongContext);
  assert.deepEqual(parseRatePolicy(historical), historical);
  assert.equal(parseRatePolicy(historical).models[2].longContext, undefined);
  assert.deepEqual(parseRatePolicy(policy), policy);
  const usage = { inputTokens: 272001, cachedInputTokens: 100000, outputTokens: 1000 };
  const at = new Date("2026-10-20T04:00:00Z");
  assert.deepEqual(priceModelCall(historical, gptRate.provider, gptRate.model, usage, at), { upstreamRmb: "6.825035000000", chargedRmb: "8.190042000000" });
  assert.deepEqual(priceModelCall(policy, gptRate.provider, gptRate.model, usage, at), { upstreamRmb: "13.597570000000", chargedRmb: "16.317084000000" });
  assert.equal(JSON.stringify(historical), serialized);

  for (const longContext of [null, { ...gptLongContext, inputTokenThreshold: 272001 },
    { ...gptLongContext, input: "" }, { ...gptLongContext, input: "0" }, { ...gptLongContext, cachedInput: "-1" },
    { ...gptLongContext, output: "0" }, { ...gptLongContext, peak: { input: "20", cachedInput: "4", output: "45" } },
    { inputTokenThreshold: 272000, inputMultiplier: "2", cachedInputMultiplier: "2", outputMultiplier: "1.5" },
  ]) assert.throws(() => parseRatePolicy({ ...policy, models: [...policy.models.slice(0, 2), { ...gptRate, longContext }] }));
  const textModel = structuredClone(policy); textModel.models[0].longContext = structuredClone(gptLongContext);
  assert.throws(() => parseRatePolicy(textModel), /GPT long-context/);
  const missingPeak = structuredClone(policy); missingPeak.models[2].peak = { input: "8", cachedInput: "10", output: "20" };
  assert.throws(() => parseRatePolicy(missingPeak), /GPT long-context/);
  missingPeak.models[2].longContext!.peak = { input: "16", cachedInput: "20", output: "30" };
  assert.deepEqual(parseRatePolicy(missingPeak), missingPeak);
});

test("strict total-input threshold switches every input, cache and output token for one call", () => {
  const policy = twoRoutePolicy(); policy.models = policy.models.slice(0, 2); policy.models.push({ ...gptRate, longContext: structuredClone(gptLongContext) });
  const at = new Date("2026-10-20T04:00:00Z");
  const price = (inputTokens: number, cachedInputTokens: number, outputTokens: number) => priceModelCall(policy, gptRate.provider, gptRate.model, { inputTokens, cachedInputTokens, outputTokens }, at);
  assert.deepEqual(price(272000, 100000, 1000), { upstreamRmb: "6.825000000000", chargedRmb: "8.190000000000" });
  assert.deepEqual(price(272001, 100000, 1000), { upstreamRmb: "13.597570000000", chargedRmb: "16.317084000000" });
  assert.equal(price(272001, 0, 0).upstreamRmb, "19.040070000000");
  assert.equal(price(272001, 272001, 0).upstreamRmb, "3.808014000000");
  // The total of separate shorter calls does not change either call's tier.
  assert.equal(tokenPoints(policy, [price(200000, 0, 0).chargedRmb, price(200000, 0, 0).chargedRmb]), 168);
  assert.equal(tokenPoints(policy, [price(400000, 0, 0).chargedRmb]), 336);
});

test("published long-context prices apply with matching peak prices, FX, markup and image subsets", () => {
  const policy = twoRoutePolicy();
  policy.models = policy.models.slice(0, 2); policy.models.push({ ...gptRate, peak: { input: "8", cachedInput: "10", output: "20" },
    longContext: { ...gptLongContext, peak: { input: "16", cachedInput: "20", output: "30" } } });
  const usage = { inputTokens: 272001, cachedInputTokens: 100000, outputTokens: 1000, imageTokens: 170000, reasoningTokens: 800 };
  assert.deepEqual(priceModelCall(policy, gptRate.provider, gptRate.model, usage, new Date("2026-10-20T01:00:00Z")), { upstreamRmb: "33.474112000000", chargedRmb: "40.168934400000" });
  assert.deepEqual(priceModelCall(policy, gptRate.provider, gptRate.model, usage, new Date("2026-10-20T04:00:00Z")), { upstreamRmb: "13.597570000000", chargedRmb: "16.317084000000" });
  // Editable tier prices are used directly, not inferred again from ordinary prices.
  policy.models[2].longContext!.input = "11";
  policy.models[2].longContext!.cachedInput = "3";
  policy.models[2].longContext!.output = "24";
  assert.equal(priceModelCall(policy, gptRate.provider, gptRate.model, usage, new Date("2026-10-20T04:00:00Z")).upstreamRmb, "15.512077000000");
});

test("reservations cover both long-context tiers and retain the selected input bound", () => {
  const policy = twoRoutePolicy();
  policy.models = policy.models.slice(0, 2); policy.models.push({ ...gptRate, peak: { input: "8", cachedInput: "10", output: "20" },
    longContext: { ...gptLongContext, peak: { input: "16", cachedInput: "20", output: "30" } } });
  assert.equal(budgetPoints(policy, 272000 - 8192, 1000), 230.16);
  assert.equal(budgetPoints(policy, 272001 - 8192, 1000), 459.4817);
  const reserved = budgetPoints(policy, 400000 - 8192, 1000);
  for (const inputTokens of [272000, 272001, 400000]) for (const cachedInputTokens of [0, inputTokens]) {
    for (const at of [new Date("2026-10-20T01:00:00Z"), new Date("2026-10-20T04:00:00Z")]) {
      const actual = priceModelCall(policy, gptRate.provider, gptRate.model, { inputTokens, cachedInputTokens, outputTokens: 1000 }, at);
      assert.ok(reserved >= tokenPoints(policy, [actual.chargedRmb]));
    }
  }
  const selected = { provider: gptRate.provider, model: gptRate.model, inputTokens: 262144, maxOutputTokens: 2048 };
  const historical = structuredClone(policy); delete historical.models[2].longContext;
  assert.equal(budgetPoints(policy, selected), budgetPoints(historical, selected));
  for (const inputTokens of [262145, 272000, 272001, 400000]) {
    const selectedReserved = budgetPoints(policy, { ...selected, inputTokens });
    assert.equal(selectedReserved, budgetPoints(policy, inputTokens - 8192, selected.maxOutputTokens));
  }

  // A cheaper published long tier must not under-reserve a shorter, ordinary-tier result.
  policy.models[2].longContext = { inputTokenThreshold: 272000, input: "0.1", cachedInput: "0.01", output: "0.1", peak: { input: "0.2", cachedInput: "0.02", output: "0.2" } };
  assert.equal(budgetPoints(policy, 272001 - 8192, 1000), 230.16);
});


test("all four routes accept disabled peak prices without mutating historical payloads", () => {
  const historical = defaultRatePolicy("1.25"); historical.models.push(structuredClone(gptRate));
  historical.models[2].offPeakDates = ["2027-02-05"];
  for (const rate of historical.models) Object.assign(rate, { peak: null });
  historical.models[3].longContext = { ...gptLongContext, peak: null } as unknown as LongContextRate;
  const before = structuredClone(historical);
  const parsed = parseRatePolicy(historical);
  assert.deepEqual(historical, before);
  assert.ok(parsed.models.every(rate => !("peak" in rate)));
  assert.equal("peak" in parsed.models[3].longContext!, false);
  assert.deepEqual(parsed.models[2].offPeakDates, before.models[2].offPeakDates);
  for (const rate of parsed.models) {
    const usage = { inputTokens: 1000, cachedInputTokens: 100, outputTokens: 10 };
    assert.deepEqual(priceModelCall(parsed, rate.provider, rate.model, usage, new Date("2026-11-16T01:00:00Z")),
      priceModelCall(parsed, rate.provider, rate.model, usage, new Date("2026-11-16T04:00:00Z")));
  }
});

test("route-group reservations cover every allowed fallback but exclude unrelated GPT prices", () => {
  const policy = defaultRatePolicy("1.2");
  policy.models[1].input = "9"; policy.models[2].output = "70";
  policy.models.push({ ...gptRate, input: "9000", output: "9000" });
  const routes = policy.models.slice(0, 3).map(({ provider, model }) => ({ provider, model }));
  const request = { ...routes[0], routes, inputTokens: 10000, maxOutputTokens: 1000 };
  const actual = budgetPoints(policy, request);
  const singles = routes.map(route => budgetPoints(policy, { ...route, inputTokens: request.inputTokens, maxOutputTokens: request.maxOutputTokens }));
  assert.equal(actual, Math.max(...singles));
  assert.ok(actual < budgetPoints(policy, { ...gptRate, inputTokens: request.inputTokens, maxOutputTokens: request.maxOutputTokens }));
  assert.deepEqual(modelBudgetRoutes({ ...request, routes: undefined }), [routes[0]]);
  for (const invalid of [[], [routes[1]], [routes[0], routes[0]], [...routes, { provider: "unknown", model: "unknown" }]]) {
    assert.throws(() => budgetPoints(policy, { ...request, routes: invalid }));
  }
});

test("cache-write prices are explicit and consistent across every configured tier", () => {
  const policy = twoRoutePolicy();
  policy.models.push({ ...gptRate, cacheWrite: "6.25", peak: { input: "8", cachedInput: "2", cacheWrite: "10", output: "20" },
    longContext: { ...gptLongContext, cacheWrite: "12.5", peak: { input: "16", cachedInput: "4", cacheWrite: "20", output: "30" } } });
  const before = structuredClone(policy);
  assert.deepEqual(parseRatePolicy(policy), before);
  for (const select of [(rate: ModelRate) => rate, (rate: ModelRate) => rate.peak!,
    (rate: ModelRate) => rate.longContext!, (rate: ModelRate) => rate.longContext!.peak!]) {
    for (const value of [undefined, "", "-1", "NaN", null, 0]) {
      const invalid = structuredClone(policy);
      Object.assign(select(invalid.models[2]), { cacheWrite: value });
      assert.throws(() => parseRatePolicy(invalid));
    }
    const free = structuredClone(policy); select(free.models[2]).cacheWrite = "0";
    assert.deepEqual(parseRatePolicy(free), free, "zero is an explicitly configured price");
  }
  const disabled = structuredClone(policy); delete disabled.models[2].cacheWrite;
  assert.throws(() => parseRatePolicy(disabled), /cache-write/);
  assert.deepEqual(policy, before, "validation never changes published prices");
});

test("cache writes partition total input once and historical prices retain their formula", () => {
  const policy = twoRoutePolicy();
  policy.models.push({ ...gptRate, currency: "RMB", exchangeRate: "1", input: "1", cachedInput: "0.1", cacheWrite: "1.25", output: "2" });
  const at = new Date("2026-11-16T04:00:00Z");
  const cost = (usage: Parameters<typeof priceModelCall>[3]) => priceModelCall(policy, gptRate.provider, gptRate.model, usage, at);
  assert.deepEqual(cost({ inputTokens: 12000, cachedInputTokens: 0, cacheWriteTokens: 12000, outputTokens: 0 }),
    { upstreamRmb: "0.015000000000", chargedRmb: "0.018000000000" });
  assert.deepEqual(cost({ inputTokens: 15000, cachedInputTokens: 12000, cacheWriteTokens: 3000, outputTokens: 0 }),
    { upstreamRmb: "0.004950000000", chargedRmb: "0.005940000000" });
  const mixed = { inputTokens: 1000, cachedInputTokens: 200, cacheWriteTokens: 300, outputTokens: 100 };
  assert.equal(cost(mixed).upstreamRmb, "0.001095000000");
  assert.throws(() => cost({ ...mixed, cacheWriteTokens: undefined }), /Unmeasured cache-write/);
  assert.equal(cost({ ...mixed, cacheWriteTokens: 0 }).upstreamRmb, "0.001020000000");
  policy.models[2].cacheWrite = "0";
  assert.equal(cost(mixed).upstreamRmb, "0.000720000000");
  delete policy.models[2].cacheWrite;
  assert.equal(cost(mixed).upstreamRmb, "0.001020000000", "legacy snapshots bill writes as ordinary input");
  assert.deepEqual(cost(mixed), cost({ ...mixed, cacheWriteTokens: undefined }));
  for (const cacheWriteTokens of [-1, 1.5, NaN, Infinity, 801, 2_147_483_648, null]) {
    assert.throws(() => cost({ ...mixed, cacheWriteTokens } as Parameters<typeof cost>[0]), /cache-write/);
  }
});

test("write-aware reservations cover cache partitions, peak prices and both context tiers", () => {
  const policy = twoRoutePolicy();
  policy.models.push({ ...gptRate, cacheWrite: "12.5", peak: { input: "8", cachedInput: "10", cacheWrite: "20", output: "20" },
    longContext: { ...gptLongContext, cacheWrite: "25", peak: { input: "16", cachedInput: "20", cacheWrite: "40", output: "30" } } });
  const offPeak = new Date("2026-10-20T04:00:00Z"); const peak = new Date("2026-10-20T01:00:00Z");
  const cost = (inputTokens: number, at = offPeak) => priceModelCall(policy, gptRate.provider, gptRate.model,
    { inputTokens, cachedInputTokens: 0, cacheWriteTokens: inputTokens, outputTokens: 0 }, at);
  assert.equal(cost(272000).upstreamRmb, "23.800000000000");
  assert.equal(cost(272001).upstreamRmb, "47.600175000000");
  assert.equal(cost(272001, peak).upstreamRmb, "76.160280000000");
  const reserved = budgetPoints(policy, 400000 - 8192, 1000);
  for (const inputTokens of [262144, 272000, 272001, 400000]) {
    for (const [cachedInputTokens, cacheWriteTokens] of [[0, 0], [inputTokens, 0], [0, inputTokens], [100000, inputTokens - 100000]]) {
      for (const at of [offPeak, peak]) {
        const actual = priceModelCall(policy, gptRate.provider, gptRate.model, { inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens: 1000 }, at);
        assert.ok(reserved >= tokenPoints(policy, [actual.chargedRmb]));
      }
    }
  }
  const selected = { provider: gptRate.provider, model: gptRate.model, inputTokens: 262144, maxOutputTokens: 1000 };
  assert.equal(budgetPoints(policy, selected), 442.082);
  const cheaperLong = structuredClone(policy);
  Object.assign(cheaperLong.models[2].longContext!, { input: "0.1", cachedInput: "0.01", cacheWrite: "0.125", output: "0.1",
    peak: { input: "0.2", cachedInput: "0.02", cacheWrite: "0.25", output: "0.2" } });
  assert.equal(budgetPoints(cheaperLong, 272001 - 8192, 1000), 458.64, "ordinary tier remains covered when the long tier is cheaper");
});
