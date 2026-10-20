import type { OperBoxEntry } from "./types.ts";

export type ManualOperboxStage = "none" | "e0" | "e0-low" | "e1" | "e2";

const MAX_LEVEL_BY_RARITY: Record<number, readonly [number, number?, number?]> = {
  1: [30],
  2: [30],
  3: [40, 55],
  4: [45, 60, 70],
  5: [50, 70, 80],
  6: [50, 80, 90],
};

export function maxEliteForRarity(rarity: number): 0 | 1 | 2 {
  if (rarity <= 2) return 0;
  if (rarity === 3) return 1;
  return 2;
}

export function manualStageForEntry(entry: OperBoxEntry | undefined): ManualOperboxStage {
  if (!entry?.own) return "none";
  if (entry.rarity <= 2 && entry.elite === 0 && entry.level < 30) return "e0-low";
  if (entry.elite >= 2) return "e2";
  if (entry.elite >= 1) return "e1";
  return "e0";
}

export function manualLevelFor(rarity: number, elite: number): number {
  const levels = MAX_LEVEL_BY_RARITY[rarity] ?? MAX_LEVEL_BY_RARITY[1];
  const supportedElite = Math.min(Math.max(Math.trunc(elite), 0), maxEliteForRarity(rarity));
  return levels[supportedElite] ?? levels[0];
}

export function buildManualOperbox(
  roster: readonly OperBoxEntry[],
  stages: Readonly<Record<string, ManualOperboxStage>>,
): OperBoxEntry[] {
  return roster.map((operator) => {
    const stage = stages[operator.id] ?? "none";
    const requestedElite = stage === "e2" ? 2 : stage === "e1" ? 1 : 0;
    const own = stage !== "none";
    const elite = Math.min(requestedElite, maxEliteForRarity(operator.rarity));
    return {
      id: operator.id,
      name: operator.name,
      own,
      elite,
      level: own ? (stage === "e0-low" ? 1 : manualLevelFor(operator.rarity, elite)) : 1,
      potential: 1,
      rarity: operator.rarity,
    };
  });
}
