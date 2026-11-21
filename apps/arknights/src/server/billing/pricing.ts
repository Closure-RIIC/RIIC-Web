import { Decimal } from "decimal.js";
import { findModelRate, priceModelCall, tokenPoints, type RatePolicy } from "./rate-policy.ts";

export type AgentTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
};

export function calculateAgentTokenCost(policy: RatePolicy, provider: string, model: string, usage: AgentTokenUsage, at = new Date()) {
  if (usage.inputTokens === undefined || usage.outputTokens === undefined) throw new Error("Unmeasured token usage");
  const measured = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cachedInputTokens: usage.cachedInputTokens ?? 0 };
  const rate = findModelRate(policy, provider, model);
  const cost = priceModelCall(policy, provider, model, measured, at);
  return {
    provider,
    model,
    source: `${provider}/${model}`,
    sourceCurrency: rate.currency,
    ...measured,
    uncachedInputTokens: measured.inputTokens - measured.cachedInputTokens,
    cacheHitRate: measured.inputTokens > 0 ? measured.cachedInputTokens / measured.inputTokens : 0,
    providerCostRmbFen: new Decimal(cost.upstreamRmb).mul(100).toDecimalPlaces(10).toNumber(),
    chargedCostRmbFen: new Decimal(cost.chargedRmb).mul(100).toDecimalPlaces(10).toNumber(),
    chargedPoints: tokenPoints(policy, [cost.chargedRmb]),
  };
}
