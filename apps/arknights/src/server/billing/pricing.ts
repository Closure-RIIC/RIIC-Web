import { Decimal } from "decimal.js";
import { findModelRate, priceModelCall, tokenPoints, type RatePolicy } from "./rate-policy.ts";

export type AgentTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
};

/** A partial SDK aggregate must not turn an unmeasured step into a known total. */
export function sumAgentCacheWriteTokens(steps: Array<{ inputTokens?: number; inputTokenDetails?: { cacheWriteTokens?: number; cacheReadTokens?: number }; raw?: unknown }>): number | undefined {
  let total = 0;
  let missing = steps.length === 0;
  for (const step of steps) {
    const sdkCount = step.inputTokenDetails?.cacheWriteTokens;
    let count = sdkCount;
    if (step.raw !== undefined && step.raw !== null) {
      if (typeof step.raw !== "object" || Array.isArray(step.raw)) throw new Error("Invalid cache-write usage");
      const raw = step.raw as Record<string, unknown>;
      const details = raw.prompt_tokens_details;
      if (details != null && (typeof details !== "object" || Array.isArray(details))) throw new Error("Invalid cache-write usage");
      // Anthropic synthesizes an SDK zero when its raw creation field is absent;
      // OpenAI-compatible preserves raw details but leaves the SDK write field unset.
      const anthropic = raw.cache_creation_input_tokens;
      const compatible = (details as Record<string, unknown> | undefined)?.cache_write_tokens;
      const rawCount = anthropic ?? compatible;
      if (rawCount === undefined) { missing = true; continue; }
      if (typeof rawCount !== "number" || (anthropic !== undefined && compatible !== undefined && anthropic !== compatible)
        || (sdkCount !== undefined && sdkCount !== rawCount)) throw new Error("Invalid cache-write usage");
      count = rawCount;
    }
    if (count === undefined) { missing = true; continue; }
    if (!Number.isSafeInteger(count) || count < 0 || count > 2_147_483_647
      || (step.inputTokens !== undefined && count > step.inputTokens - (step.inputTokenDetails?.cacheReadTokens ?? 0))) throw new Error("Invalid cache-write usage");
    total += count;
  }
  if (!Number.isSafeInteger(total) || total > 2_147_483_647) throw new Error("Invalid cache-write usage");
  return missing ? undefined : total;
}

export function calculateAgentTokenCost(policy: RatePolicy, provider: string, model: string, usage: AgentTokenUsage, at = new Date()) {
  if (usage.inputTokens === undefined || usage.outputTokens === undefined) throw new Error("Unmeasured token usage");
  const measured = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cachedInputTokens: usage.cachedInputTokens ?? 0, cacheWriteTokens: usage.cacheWriteTokens };
  const rate = findModelRate(policy, provider, model);
  const cost = priceModelCall(policy, provider, model, measured, at);
  return {
    provider,
    model,
    source: `${provider}/${model}`,
    sourceCurrency: rate.currency,
    ...measured,
    uncachedInputTokens: measured.inputTokens - measured.cachedInputTokens - (rate.cacheWrite === undefined ? 0 : measured.cacheWriteTokens!),
    cacheHitRate: measured.inputTokens > 0 ? measured.cachedInputTokens / measured.inputTokens : 0,
    providerCostRmbFen: new Decimal(cost.upstreamRmb).mul(100).toDecimalPlaces(10).toNumber(),
    chargedCostRmbFen: new Decimal(cost.chargedRmb).mul(100).toDecimalPlaces(10).toNumber(),
    chargedPoints: tokenPoints(policy, [cost.chargedRmb]),
  };
}
