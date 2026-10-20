import { createHash } from "node:crypto";

import { resolvePlanPresentationLayout } from "../plan-presentation.ts";
import type { PublicPlanData, SavedPlanCalculationContext } from "../types.ts";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function publicPlanSha256(result: PublicPlanData): string {
  return createHash("sha256").update(canonical(result)).digest("hex");
}

export function resolveSavedPlanCalculationContext(
  solverContext: SavedPlanCalculationContext,
  result: PublicPlanData,
): SavedPlanCalculationContext {
  return {
    ...solverContext,
    layout: resolvePlanPresentationLayout(structuredClone(solverContext.layout), result),
  };
}
