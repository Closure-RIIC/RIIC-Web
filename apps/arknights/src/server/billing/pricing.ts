import { POINT_VALUE_RMB } from "./config.ts";
import { Decimal } from "decimal.js";
import { roundPoints } from "./points.ts";

export type AgentTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
};

type PriceRow = { input: number; cachedInput: number; output: number; source: string; currency: "RMB" | "USD" };

// All settlement values are stored and returned in RMB per million tokens. The
// GLM defaults are the current provider list price converted once into RMB;
// deployments can replace them when the provider publishes a new price.
const configuredGlmInputRmb = Number(process.env.AGENT_GLM_INPUT_RMB_PER_MILLION ?? 1.08);
const configuredGlmCachedInputRmb = Number(process.env.AGENT_GLM_CACHED_INPUT_RMB_PER_MILLION ?? 0.216);
const configuredGlmOutputRmb = Number(process.env.AGENT_GLM_OUTPUT_RMB_PER_MILLION ?? 3.6);
const GLM_INPUT_RMB = Number.isFinite(configuredGlmInputRmb) && configuredGlmInputRmb >= 0 ? configuredGlmInputRmb : 1.08;
const GLM_CACHED_INPUT_RMB = Number.isFinite(configuredGlmCachedInputRmb) && configuredGlmCachedInputRmb >= 0 ? configuredGlmCachedInputRmb : 0.216;
const GLM_OUTPUT_RMB = Number.isFinite(configuredGlmOutputRmb) && configuredGlmOutputRmb >= 0 ? configuredGlmOutputRmb : 3.6;

function deepSeekPrice(now: Date): PriceRow {
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const day = beijing.getUTCDay();
  const hour = beijing.getUTCHours() + beijing.getUTCMinutes() / 60;
  const peak = day >= 1 && day <= 5 && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18));
  return {
    input: peak ? 2 : 1,
    cachedInput: peak ? 0.04 : 0.02,
    output: peak ? 8 : 4,
    currency: "RMB",
    source: `DeepSeek V4.1 Flash ${peak ? "peak" : "off-peak"}`,
  };
}

function glmPrice(): PriceRow {
  return {
    input: GLM_INPUT_RMB,
    cachedInput: GLM_CACHED_INPUT_RMB,
    output: GLM_OUTPUT_RMB,
    currency: "RMB",
    source: "Z.AI GLM-5.3-Flash · RMB price",
  };
}

function priceForModel(model: string, now: Date): PriceRow | null {
  const normalized = model.toLowerCase();
  if (normalized.includes("deepseek") || normalized === "deepseek-flash") return deepSeekPrice(now);
  if (normalized.includes("glm-5.3-flash")) return glmPrice();
  return null;
}

export function calculateAgentTokenCost(model: string, usage: AgentTokenUsage, now = new Date()) {
  const price = priceForModel(model, now);
  if (!price) return null;
  const inputTokens = Math.max(0, Math.floor(usage.inputTokens ?? 0));
  const cachedInputTokens = Math.min(inputTokens, Math.max(0, Math.floor(usage.cachedInputTokens ?? 0)));
  const uncachedInputTokens = inputTokens - cachedInputTokens;
  const outputTokens = Math.max(0, Math.floor(usage.outputTokens ?? 0));
  const providerCostRmb = new Decimal(uncachedInputTokens).mul(price.input)
    .add(new Decimal(cachedInputTokens).mul(price.cachedInput))
    .add(new Decimal(outputTokens).mul(price.output)).div(1_000_000);
  const providerCostRmbFen = providerCostRmb.mul(100).toDecimalPlaces(10).toNumber();
  const chargedCostRmbFen = providerCostRmb.mul("1.2").mul(100).toDecimalPlaces(10).toNumber();
  return {
    model,
    source: price.source,
    sourceCurrency: price.currency,
    inputTokens,
    cachedInputTokens,
    uncachedInputTokens,
    outputTokens,
    cacheHitRate: inputTokens > 0 ? cachedInputTokens / inputTokens : 0,
    providerCostRmbFen,
    chargedCostRmbFen,
    chargedPoints: roundPoints(providerCostRmb.mul("1.2").div(POINT_VALUE_RMB)),
  };
}
