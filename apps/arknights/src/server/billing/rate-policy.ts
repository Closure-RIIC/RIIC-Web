import { Decimal } from "decimal.js";
import { POINT_DECIMAL_PLACES, MIN_POINT_AMOUNT } from "../../billing-points.ts";
import { POINT_VALUE_RMB, SOLVE_TOOL_POINTS } from "./config.ts";
import { roundPoints } from "./points.ts";

export type LongContextRate = {
  inputTokenThreshold: 272000; input: string; cachedInput: string; cacheWrite?: string; output: string;
  peak?: { input: string; cachedInput: string; cacheWrite?: string; output: string };
};
export type ModelRate = {
  provider: string; model: string; currency: "RMB" | "USD"; exchangeRate: string;
  input: string; cachedInput: string; cacheWrite?: string; output: string;
  peak?: { input: string; cachedInput: string; cacheWrite?: string; output: string };
  offPeakDates?: string[];
  // Explicitly versioned: missing rules retain the historical pricing behavior.
  longContext?: LongContextRate;
};
export type RatePolicy = { markup: string; pointValueRmb: string; toolPoints: number; models: ModelRate[] };
export type MeasuredUsage = {
  inputTokens: number; outputTokens: number; cachedInputTokens: number; cacheWriteTokens?: number;
  // These are subsets of the totals, never additional billable buckets.
  reasoningTokens?: number; imageTokens?: number;
};
export type ModelRoute = { provider: string; model: string };
export type ModelCallBudget = ModelRoute & { inputTokens: number; maxOutputTokens: number; routes?: ModelRoute[] };
export const SUPPLEMENTAL_MODEL_PROVIDER = "riic-deepseek-official";
export const SUPPLEMENTAL_MODEL_ID = "deepseek-flash";

// DeepSeek's RMB list price, checked 2026-11-16:
// https://api-docs.deepseek.com/zh-cn/quick_start/pricing
// Off-peak dates are entered and published through billing administration.
export function supplementalModelRate(): ModelRate {
  return {
    provider: SUPPLEMENTAL_MODEL_PROVIDER, model: SUPPLEMENTAL_MODEL_ID,
    currency: "RMB", exchangeRate: "1", input: "1", cachedInput: "0.02", output: "4",
    peak: { input: "2", cachedInput: "0.04", output: "8" },
  };
}

export function createRatePolicyDraft(): RatePolicy {
  return { markup: "", pointValueRmb: String(POINT_VALUE_RMB), toolPoints: SOLVE_TOOL_POINTS, models: [
    { provider: "riic-deepseek", model: "deepseek-v4.1-flash", currency: "RMB", exchangeRate: "1", input: "1", cachedInput: "0.02", output: "4", peak: { input: "2", cachedInput: "0.04", output: "8" } },
    { provider: "riic-glm", model: "glm-5.3-flash", currency: "RMB", exchangeRate: "1", input: process.env.AGENT_GLM_INPUT_RMB_PER_MILLION ?? "1.08", cachedInput: process.env.AGENT_GLM_CACHED_INPUT_RMB_PER_MILLION ?? "0.216", output: process.env.AGENT_GLM_OUTPUT_RMB_PER_MILLION ?? "3.6" },
    supplementalModelRate(),
  ] };
}
export function defaultRatePolicy(markup: string): RatePolicy {
  return parseRatePolicy({ ...createRatePolicyDraft(), markup });
}
function price(value: unknown, positive = false) {
  if (typeof value !== "string" || !/^\d{1,7}(\.\d{1,8})?$/.test(value) || (positive && new Decimal(value).lte(0))) throw new Error("Invalid decimal rate");
}
export function parseRatePolicy(value: unknown): RatePolicy {
  if (!value || typeof value !== "object") throw new Error("Invalid rate policy");
  const p = structuredClone(value) as RatePolicy;
  price(p.markup, true); price(p.pointValueRmb, true);
  if (p.pointValueRmb !== "0.1" || !Number.isInteger(p.toolPoints) || p.toolPoints !== 1 || !Array.isArray(p.models) || p.models.length < 2 || p.models.length > 4) throw new Error("Existing point and tool entitlements must be preserved");
  const allowedProviders = new Set(["riic-deepseek", "riic-glm", SUPPLEMENTAL_MODEL_PROVIDER, "riic-gpt"]);
  const providers = new Set<string>();
  for (const rate of p.models) {
    if (!rate || !allowedProviders.has(rate.provider) || providers.has(rate.provider)
      || typeof rate.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(rate.model)
      || !["RMB", "USD"].includes(rate.currency)) throw new Error("Unexpected or duplicate model");
    providers.add(rate.provider);
    price(rate.exchangeRate, true);
    // Historical policies used null to mean that peak prices were disabled.
    // Normalize only the parsed snapshot; never rewrite stored versions.
    if (rate.peak === null) delete rate.peak;
    if (rate.offPeakDates !== undefined && (!Array.isArray(rate.offPeakDates) || rate.offPeakDates.length > 3660 ||
      rate.offPeakDates.some(day => typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) ||
      new Set(rate.offPeakDates).size !== rate.offPeakDates.length)) throw new Error("Invalid off-peak calendar");
    for (const row of [rate, ...(rate.peak ? [rate.peak] : [])]) {
      price(row.input, rate.provider === "riic-gpt"); price(row.cachedInput); price(row.output, rate.provider === "riic-gpt");
      if ((row.cacheWrite !== undefined) !== (rate.cacheWrite !== undefined)) throw new Error("Inconsistent cache-write rate rule");
      if (row.cacheWrite !== undefined) price(row.cacheWrite);
    }
    if (rate.longContext !== undefined) {
      const rule = rate.longContext;
      if (rule?.peak === null) delete rule.peak;
      if (rate.provider !== "riic-gpt" || !rule || rule.inputTokenThreshold !== 272000
        || !!rate.peak !== !!rule.peak) throw new Error("Invalid GPT long-context rate rule");
      for (const row of [rule, ...(rule.peak ? [rule.peak] : [])]) {
        price(row.input, true); price(row.cachedInput); price(row.output, true);
        if ((row.cacheWrite !== undefined) !== (rate.cacheWrite !== undefined)) throw new Error("Inconsistent cache-write rate rule");
        if (row.cacheWrite !== undefined) price(row.cacheWrite);
      }
    }
  }
  if (!providers.has("riic-deepseek") || !providers.has("riic-glm")) throw new Error("Existing model rates must be preserved");
  return structuredClone(p);
}
function peakTime(date: Date, offPeakDates: string[] = []) {
  const bj = new Date(date.getTime() + 8 * 3600_000); const d = bj.getUTCDay(); const h = bj.getUTCHours();
  return !offPeakDates.includes(bj.toISOString().slice(0, 10)) && d >= 1 && d <= 5 && ((h >= 9 && h < 12) || (h >= 14 && h < 18));
}
export function findModelRate(policy: RatePolicy, provider: string, model: string) {
  const rate = policy.models.find(row => row.provider === provider && row.model === model);
  if (!rate) throw new Error("Unknown actual model rate");
  return rate;
}
export function validateMeasuredUsage(usage: MeasuredUsage) {
  // Token counters are stored in PostgreSQL integer columns. Untrusted upstream
  // counters must not turn an accounting exception into a failed SQL transaction.
  for (const value of [usage.inputTokens, usage.outputTokens, usage.cachedInputTokens]) if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) throw new Error("Unmeasured token usage");
  if (usage.cachedInputTokens > usage.inputTokens) throw new Error("Invalid cache usage");
  if (usage.cacheWriteTokens !== undefined && (!Number.isSafeInteger(usage.cacheWriteTokens) || usage.cacheWriteTokens < 0
    || usage.cacheWriteTokens > usage.inputTokens - usage.cachedInputTokens)) throw new Error("Invalid cache-write usage");
  for (const [value, total] of [[usage.reasoningTokens, usage.outputTokens], [usage.imageTokens, usage.inputTokens]] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > total)) throw new Error("Invalid token detail usage");
  }
}
function modelRateTier(rate: ModelRate, inputTokens: number) {
  // Total input already includes cached and image tokens. Crossing the threshold
  // changes the rates for the whole call, never just the excess token count.
  return rate.longContext && inputTokens > rate.longContext.inputTokenThreshold ? rate.longContext : rate;
}
export function priceModelCall(policy: RatePolicy, provider: string, model: string, usage: MeasuredUsage, at: Date) {
  const rate = findModelRate(policy, provider, model);
  validateMeasuredUsage(usage);
  const tier = modelRateTier(rate, usage.inputTokens);
  const row = tier.peak && peakTime(at, rate.offPeakDates) ? tier.peak : tier;
  // Historical rate snapshots keep their original formula even when newer usage has write details.
  const cacheWriteEnabled = rate.cacheWrite !== undefined;
  if (cacheWriteEnabled && (usage.cacheWriteTokens === undefined || row.cacheWrite === undefined)) throw new Error("Unmeasured cache-write usage");
  const cacheWriteTokens = cacheWriteEnabled ? usage.cacheWriteTokens! : 0;
  const upstream = new Decimal(usage.inputTokens - usage.cachedInputTokens - cacheWriteTokens).mul(row.input)
    .add(new Decimal(usage.cachedInputTokens).mul(row.cachedInput)).add(new Decimal(cacheWriteTokens).mul(cacheWriteEnabled ? row.cacheWrite! : "0"))
    .add(new Decimal(usage.outputTokens).mul(row.output))
    .div(1_000_000).mul(rate.exchangeRate);
  return { upstreamRmb: upstream.toFixed(12), chargedRmb: upstream.mul(policy.markup).toFixed(12) };
}
export function tokenPoints(policy: RatePolicy, amounts: string[]) {
  return roundPoints(amounts.reduce((sum, amount) => sum.add(amount), new Decimal(0)).div(policy.pointValueRmb));
}
export function modelBudgetRoutes(budget: ModelCallBudget): ModelRoute[] {
  const routes = budget.routes ?? [{ provider: budget.provider, model: budget.model }];
  if (!Array.isArray(routes) || routes.length < 1 || routes.length > 4
    || routes.some(route => !route || typeof route.provider !== "string" || typeof route.model !== "string")
    || new Set(routes.map(route => `${route.provider}/${route.model}`)).size !== routes.length
    || !routes.some(route => route.provider === budget.provider && route.model === budget.model)) throw new Error("Invalid model budget routes");
  return routes;
}
export function budgetPoints(policy: RatePolicy, budget: ModelCallBudget): number;
export function budgetPoints(policy: RatePolicy, serializedBytes: number, maxOutputTokens: number): number;
export function budgetPoints(policy: RatePolicy, request: number | ModelCallBudget, legacyMaxOutputTokens?: number) {
  const legacy = typeof request === "number";
  if (legacy && (!Number.isSafeInteger(request) || request < 0 || request > 512_000)) throw new Error("Model request exceeds budget limits");
  // Legacy calls retain their byte bound. Selected calls provide a token bound
  // covering text, protocol framing and image tokens, independently of encoding.
  const input = legacy ? request + 8192 : request.inputTokens;
  const maxOutputTokens = legacy ? legacyMaxOutputTokens : request.maxOutputTokens;
  if (!Number.isSafeInteger(input) || input < 0 || (legacy && input > 520_192)
    || typeof maxOutputTokens !== "number" || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 4096) throw new Error("Model request exceeds budget limits");
  const rates = legacy ? policy.models : modelBudgetRoutes(request).map(route => findModelRate(policy, route.provider, route.model));
  const worst = rates.map(rate => {
    // A published cached-input price may exceed the ordinary price. Reserve
    // enough for either partition and either peak/off-peak rate.
    // Explicit tier prices need not increase. A bound above the threshold must
    // also cover an actual shorter request priced at the ordinary tier.
    const tiers = [{ tier: rate, bound: Math.min(input, rate.longContext?.inputTokenThreshold ?? input) },
      ...(rate.longContext && input > rate.longContext.inputTokenThreshold ? [{ tier: rate.longContext, bound: input }] : [])];
    return Decimal.max(...tiers.map(({ tier, bound }) => {
      const rows = [tier, ...(tier.peak ? [tier.peak] : [])];
      const inputRate = Decimal.max(...rows.flatMap(row => [row.input, row.cachedInput, ...(rate.cacheWrite !== undefined ? [row.cacheWrite!] : [])]));
      const outputRate = Decimal.max(...rows.map(row => row.output));
      return inputRate.mul(bound).add(outputRate.mul(maxOutputTokens)).div(1_000_000).mul(rate.exchangeRate).mul(policy.markup);
    }));
  });
  return Math.max(MIN_POINT_AMOUNT, Decimal.max(...worst).div(policy.pointValueRmb).toDecimalPlaces(POINT_DECIMAL_PLACES, Decimal.ROUND_CEIL).toNumber());
}
