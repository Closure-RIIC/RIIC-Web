import { Decimal } from "decimal.js";

export type ModelRate = {
  provider: string; model: string; currency: "RMB" | "USD"; exchangeRate: string;
  input: string; cachedInput: string; output: string;
  peak?: { input: string; cachedInput: string; output: string };
};
export type RatePolicy = { markup: string; pointValueRmb: string; toolPoints: number; models: ModelRate[] };
export type MeasuredUsage = { inputTokens: number; outputTokens: number; cachedInputTokens: number };
export function defaultRatePolicy(): RatePolicy {
  return { markup: "1.2", pointValueRmb: "0.1", toolPoints: 1, models: [
    { provider: "riic-deepseek", model: "deepseek-v4.1-flash", currency: "RMB", exchangeRate: "1", input: "1", cachedInput: "0.02", output: "4", peak: { input: "2", cachedInput: "0.04", output: "8" } },
    { provider: "riic-glm", model: "glm-5.3-flash", currency: "RMB", exchangeRate: "1", input: process.env.AGENT_GLM_INPUT_RMB_PER_MILLION ?? "1.08", cachedInput: process.env.AGENT_GLM_CACHED_INPUT_RMB_PER_MILLION ?? "0.216", output: process.env.AGENT_GLM_OUTPUT_RMB_PER_MILLION ?? "3.6" },
  ] };
}
function price(value: unknown, positive = false) {
  if (typeof value !== "string" || !/^\d{1,7}(\.\d{1,8})?$/.test(value) || (positive && new Decimal(value).lte(0))) throw new Error("Invalid decimal rate");
}
export function parseRatePolicy(value: unknown): RatePolicy {
  if (!value || typeof value !== "object") throw new Error("Invalid rate policy");
  const p = value as RatePolicy;
  price(p.markup, true); price(p.pointValueRmb, true);
  if (p.pointValueRmb !== "0.1" || !Number.isInteger(p.toolPoints) || p.toolPoints !== 1 || !Array.isArray(p.models) || p.models.length !== 2) throw new Error("Existing point and tool entitlements must be preserved");
  const expected = new Set(["riic-deepseek/deepseek-v4.1-flash", "riic-glm/glm-5.3-flash"]);
  for (const rate of p.models) {
    if (!expected.delete(`${rate.provider}/${rate.model}`) || !["RMB", "USD"].includes(rate.currency)) throw new Error("Unexpected or duplicate model");
    price(rate.exchangeRate, true);
    for (const row of [rate, ...(rate.peak ? [rate.peak] : [])]) { price(row.input); price(row.cachedInput); price(row.output); }
  }
  return structuredClone(p);
}
function peakTime(date: Date) {
  const bj = new Date(date.getTime() + 8 * 3600_000); const d = bj.getUTCDay(); const h = bj.getUTCHours();
  return d >= 1 && d <= 5 && ((h >= 9 && h < 12) || (h >= 14 && h < 18));
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
  const row = rate.peak && peakTime(at) ? rate.peak : rate;
  const upstream = new Decimal(usage.inputTokens - usage.cachedInputTokens).mul(row.input)
    .add(new Decimal(usage.cachedInputTokens).mul(row.cachedInput)).add(new Decimal(usage.outputTokens).mul(row.output))
    .div(1_000_000).mul(rate.exchangeRate);
  return { upstreamRmb: upstream.toFixed(12), chargedRmb: upstream.mul(policy.markup).toFixed(12) };
}
export function tokenPoints(policy: RatePolicy, amounts: string[]) {
  return amounts.reduce((sum, amount) => sum.add(amount), new Decimal(0)).div(policy.pointValueRmb).ceil().toNumber();
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
  return Math.max(1, Decimal.max(...worst).div(policy.pointValueRmb).ceil().toNumber());
}
