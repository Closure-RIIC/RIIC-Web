import { Decimal } from "decimal.js";
import { POINT_DECIMAL_PLACES, MIN_POINT_AMOUNT } from "../../billing-points.ts";
import { POINT_VALUE_RMB, SOLVE_TOOL_POINTS } from "./config.ts";
import { roundPoints } from "./points.ts";

export type ModelRate = {
  provider: string; model: string; currency: "RMB" | "USD"; exchangeRate: string;
  input: string; cachedInput: string; output: string;
  peak?: { input: string; cachedInput: string; output: string };
  offPeakDates?: string[];
};
export type RatePolicy = { markup: string; pointValueRmb: string; toolPoints: number; models: ModelRate[] };
export type MeasuredUsage = { inputTokens: number; outputTokens: number; cachedInputTokens: number };

export const SUPPLEMENTAL_MODEL_PROVIDER = "riic-deepseek-official";
export const SUPPLEMENTAL_MODEL_ID = "deepseek-flash";

// DeepSeek's RMB list price, checked 2026-11-16:
// https://api-docs.deepseek.com/zh-cn/quick_start/pricing
// Holiday schedules (weekends remain off-peak even on a make-up workday):
// https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm
// https://www.gov.cn/zhengce/zhengceku/202611/content_7085102.htm
export function supplementalModelRate(): ModelRate {
  return {
    provider: SUPPLEMENTAL_MODEL_PROVIDER, model: SUPPLEMENTAL_MODEL_ID,
    currency: "RMB", exchangeRate: "1", input: "1", cachedInput: "0.02", output: "4",
    peak: { input: "2", cachedInput: "0.04", output: "8" },
    offPeakDates: [
      "2026-01-01", "2026-01-02", "2026-01-03",
      "2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-21", "2026-02-22", "2026-02-23",
      "2026-04-04", "2026-04-05", "2026-04-06",
      "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05",
      "2026-06-19", "2026-06-20", "2026-06-21", "2026-09-25", "2026-09-26", "2026-09-27",
      "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07",
      "2027-01-01", "2027-01-02", "2027-01-03",
      "2027-02-05", "2027-02-06", "2027-02-07", "2027-02-08", "2027-02-09", "2027-02-10", "2027-02-11", "2027-02-12", "2027-02-13",
      "2027-04-03", "2027-04-04", "2027-04-05",
      "2027-05-01", "2027-05-02", "2027-05-03", "2027-05-04", "2027-05-05",
      "2027-06-09", "2027-09-15",
      "2027-10-01", "2027-10-02", "2027-10-03", "2027-10-04", "2027-10-05", "2027-10-06", "2027-10-07",
    ],
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
  const p = value as RatePolicy;
  price(p.markup, true); price(p.pointValueRmb, true);
  if (p.pointValueRmb !== "0.1" || !Number.isInteger(p.toolPoints) || p.toolPoints !== 1 || !Array.isArray(p.models) || ![2, 3].includes(p.models.length)) throw new Error("Existing point and tool entitlements must be preserved");
  const expected = new Set(["riic-deepseek/deepseek-v4.1-flash", "riic-glm/glm-5.3-flash"]);
  if (p.models.length === 3) expected.add(`${SUPPLEMENTAL_MODEL_PROVIDER}/${SUPPLEMENTAL_MODEL_ID}`);
  for (const rate of p.models) {
    if (!expected.delete(`${rate.provider}/${rate.model}`) || !["RMB", "USD"].includes(rate.currency)) throw new Error("Unexpected or duplicate model");
    price(rate.exchangeRate, true);
    for (const row of [rate, ...(rate.peak ? [rate.peak] : [])]) { price(row.input); price(row.cachedInput); price(row.output); }
    if (rate.offPeakDates !== undefined && (!Array.isArray(rate.offPeakDates) || rate.offPeakDates.length > 3660 ||
      rate.offPeakDates.some(day => typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) ||
      new Set(rate.offPeakDates).size !== rate.offPeakDates.length)) throw new Error("Invalid off-peak calendar");
  }
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
export function priceModelCall(policy: RatePolicy, provider: string, model: string, usage: MeasuredUsage, at: Date) {
  const rate = findModelRate(policy, provider, model);
  for (const value of Object.values(usage)) if (!Number.isSafeInteger(value) || value < 0) throw new Error("Unmeasured token usage");
  if (usage.cachedInputTokens > usage.inputTokens) throw new Error("Invalid cache usage");
  const row = rate.peak && peakTime(at, rate.offPeakDates) ? rate.peak : rate;
  const upstream = new Decimal(usage.inputTokens - usage.cachedInputTokens).mul(row.input)
    .add(new Decimal(usage.cachedInputTokens).mul(row.cachedInput)).add(new Decimal(usage.outputTokens).mul(row.output))
    .div(1_000_000).mul(rate.exchangeRate);
  return { upstreamRmb: upstream.toFixed(12), chargedRmb: upstream.mul(policy.markup).toFixed(12) };
}
export function tokenPoints(policy: RatePolicy, amounts: string[]) {
  return roundPoints(amounts.reduce((sum, amount) => sum.add(amount), new Decimal(0)).div(policy.pointValueRmb));
}
export function budgetPoints(policy: RatePolicy, serializedBytes: number, maxOutputTokens: number) {
  if (!Number.isSafeInteger(serializedBytes) || serializedBytes < 0 || serializedBytes > 512_000 || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 4096) throw new Error("Model request exceeds budget limits");
  // UTF-8 byte bound plus protocol framing; no gateway prompt rewriting is enabled.
  const input = serializedBytes + 8192;
  const worst = policy.models.map(rate => {
    const inputRate = Decimal.max(rate.input, rate.peak?.input ?? rate.input);
    const outputRate = Decimal.max(rate.output, rate.peak?.output ?? rate.output);
    return inputRate.mul(input).add(outputRate.mul(maxOutputTokens)).div(1_000_000).mul(rate.exchangeRate).mul(policy.markup);
  });
  return Math.max(MIN_POINT_AMOUNT, Decimal.max(...worst).div(policy.pointValueRmb).toDecimalPlaces(POINT_DECIMAL_PLACES, Decimal.ROUND_CEIL).toNumber());
}
