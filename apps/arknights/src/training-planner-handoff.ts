import { manualLevelFor, maxEliteForRarity } from "./manual-operbox.ts";
import type { TrainingPlannerHandoff } from "./training-planner-store.ts";
import type { TrainingAdviceTarget } from "./types.ts";

export function trainingPlannerTargetFromAdvice(
  operator: { id: string; rarity: number } | undefined,
  target: TrainingAdviceTarget,
): TrainingPlannerHandoff[number] | null {
  if (!operator || target.kind !== "explicit" || !Number.isInteger(target.elite)) return null;
  const elite = target.elite!;
  // Elite-only advice means promotion into that stage without extra leveling.
  const level = target.level ?? 1;
  if (!Number.isInteger(level)) return null;
  if (elite < 0 || elite > maxEliteForRarity(operator.rarity)) return null;
  if (level < 1 || level > manualLevelFor(operator.rarity, elite)) return null;
  return { operatorId: operator.id, targetElite: elite, targetLevel: level };
}
