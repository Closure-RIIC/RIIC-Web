import type { AgentModelId } from "./agent-models.ts";

export type ModelPricingTier = "base" | "long-context" | null;
export type BillingModelStats = {
  modelId: AgentModelId | null; label: string | null; provider: string | null; model: string | null;
  calls: number; inputTokens: string | null; cachedInputTokens: string | null; cacheWriteTokens: string | null; outputTokens: string | null;
  knownUpstreamRmb: string | null; knownChargedRmb: string | null;
  longContextCalls: number; unknownUsageCalls: number; unknownCostCalls: number; pendingReviewCalls: number;
};
/** One completion shared by related gateway attempts; never an allocated attempt charge. */
export type RelatedModelCall = {
  id: string; status: string; provider: string | null; model: string | null;
  inputTokens: number | null; cachedInputTokens: number | null; cacheWriteTokens: number | null; outputTokens: number | null;
  upstreamRmb: string | null; chargedRmb: string | null; pricingTier: ModelPricingTier;
};
