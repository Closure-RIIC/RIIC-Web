import solver from "javascript-lp-solver";

export type FarmingDrop = {
  stageId: string;
  code: string;
  sanity: number;
  times: number;
  quantity: number;
  opensAt?: number;
  closesAt?: number;
};

export type FarmingSnapshot = {
  fetchedAt: number;
  drops: Record<string, FarmingDrop[]>;
  baselines: Record<string, FarmingDrop>;
};

export function cnGameWeekday(now: number) {
  return new Date(now + 4 * 60 * 60 * 1000).getUTCDay();
}

export const CHIP_STAGE_DAYS: Readonly<Partial<Record<string, readonly number[]>>> = {
  pro_a_2: [1, 4, 5, 0],
  pro_b_2: [1, 2, 5, 6],
  pro_c_2: [3, 4, 6, 0],
  pro_d_2: [2, 3, 6, 0],
};

export const CHIP_STAGE_BY_ITEM: Readonly<Partial<Record<string, string>>> = {
  "3212": "pro_c_2", "3222": "pro_d_2", "3232": "pro_a_2", "3242": "pro_b_2",
  "3252": "pro_b_2", "3262": "pro_a_2", "3272": "pro_c_2", "3282": "pro_d_2",
};

export function availableFarmingDrops(drops: readonly FarmingDrop[], now: number, includeScheduledChips = false) {
  return drops.filter((drop) =>
    (includeScheduledChips || (CHIP_STAGE_DAYS[drop.stageId]?.includes(cnGameWeekday(now)) ?? true)) &&
    (drop.opensAt === undefined || drop.opensAt <= now) &&
    (drop.closesAt === undefined || now < drop.closesAt));
}

function yieldPerSanity(drop: FarmingDrop) {
  return drop.quantity / drop.times / drop.sanity;
}

export function recommendFarming(drops: readonly FarmingDrop[], missing: number, baseline?: FarmingDrop) {
  if (!Number.isSafeInteger(missing) || missing <= 0) return [];
  return drops.map((drop) => {
    const runs = Math.ceil(missing * drop.times / drop.quantity);
    const relative = baseline ? Math.round(100 * yieldPerSanity(drop) / yieldPerSanity(baseline)) : undefined;
    return { ...drop, runs, totalSanity: runs * drop.sanity, relative };
  }).sort((a, b) => a.totalSanity - b.totalSanity || a.runs - b.runs || b.times - a.times || a.code.localeCompare(b.code)).slice(0, 3);
}

type Candidate = { drop: FarmingDrop; yields: Map<string, number> };
type Need = { id: string; missing: number };
type PlanStage = { stageId: string; code: string; runs: number; totalSanity: number; expectedDrops: Record<string, number> };

export const CHIP_CATALYST = "32001";
export const PURCHASE_CERTIFICATE = "4006";
const certificatesPerCatalyst = 90;
const ap5Sanity = 30;
const ap5Min = 20;
const ap5Average = 21;
const ap5Max = 22;

export function planCatalystExchange(catalysts: number, now: number, ownedCertificates = 0) {
  const certificates = Math.max(0, catalysts * certificatesPerCatalyst - ownedCertificates);
  // CN resets at 04:00 UTC+8, so shift the UTC weekday by four hours.
  const weekday = cnGameWeekday(now);
  const runs = Math.ceil(certificates / ap5Average);
  return {
    certificates, runs, sanity: runs * ap5Sanity,
    minRuns: Math.ceil(certificates / ap5Max),
    conservativeRuns: Math.ceil(certificates / ap5Min),
    open: [0, 1, 4, 6].includes(weekday),
  };
}

export function planFarming(needs: readonly Need[], drops: FarmingSnapshot["drops"], now: number, includeScheduledChips = false) {
  const candidates = new Map<string, Candidate>();
  const remaining = new Map<string, number>();
  const uncovered: string[] = [];
  for (const need of needs) {
    if (!Number.isSafeInteger(need.missing) || need.missing <= 0) continue;
    const available = availableFarmingDrops(drops[need.id] ?? [], now, includeScheduledChips);
    if (!available.length) {
      uncovered.push(need.id);
      continue;
    }
    remaining.set(need.id, need.missing);
    for (const drop of available) {
      let stage = candidates.get(drop.stageId);
      if (!stage) {
        stage = { drop, yields: new Map() };
        candidates.set(drop.stageId, stage);
      }
      stage.yields.set(need.id, drop.quantity / drop.times);
    }
  }

  const required = new Map(remaining);
  const separate = new Map<string, number>();
  const sanityPerItem = new Map<string, number>();
  let separateSanity = 0;
  for (const [id, missing] of remaining) {
    const best = recommendFarming(availableFarmingDrops(drops[id] ?? [], now, includeScheduledChips), missing)[0];
    separateSanity += best.totalSanity;
    sanityPerItem.set(id, best.totalSanity / missing);
    separate.set(best.stageId, Math.max(separate.get(best.stageId) ?? 0, best.runs));
  }

  function greedyPlan(excludedStageId?: string, weightBySanity = false) {
    const remaining = new Map(required);
    const plan = new Map<string, PlanStage>();
    // Pick a batch that fills at least one shortage, then re-score the remaining ones.
    while (remaining.size) {
      let best: { stage: Candidate; runs: number; score: number } | undefined;
      for (const stage of candidates.values()) {
        if (stage.drop.stageId === excludedStageId) continue;
        let runs = Infinity;
        for (const [id, rate] of stage.yields) {
          const missing = remaining.get(id);
          if (missing !== undefined) runs = Math.min(runs, Math.ceil(missing / rate));
        }
        if (!Number.isFinite(runs)) continue;
        let coverage = 0;
        for (const [id, rate] of stage.yields) {
          const missing = remaining.get(id);
          if (missing === undefined) continue;
          const covered = Math.min(missing, runs * rate);
          coverage += weightBySanity ? covered * sanityPerItem.get(id)! : covered / missing;
        }
        const score = coverage / (runs * stage.drop.sanity);
        if (!best || score > best.score ||
          (score === best.score && stage.drop.stageId < best.stage.drop.stageId)) {
          best = { stage, runs, score };
        }
      }
      if (!best) break;
      const { stage, runs } = best;
      const { stageId, code, sanity } = stage.drop;
      const entry = plan.get(stageId) ?? { stageId, code, runs: 0, totalSanity: 0, expectedDrops: {} };
      entry.runs += runs;
      entry.totalSanity += runs * sanity;
      for (const [id, rate] of stage.yields) {
        const expected = rate * runs;
        entry.expectedDrops[id] = (entry.expectedDrops[id] ?? 0) + expected;
        const missing = remaining.get(id);
        if (missing === undefined) continue;
        if (runs >= Math.ceil(missing / rate)) remaining.delete(id);
        else remaining.set(id, missing - expected);
      }
      plan.set(stageId, entry);
    }
    return remaining.size ? null : [...plan.values()];
  }

  const direct = [...separate].map(([stageId, runs]) => {
    const { drop, yields } = candidates.get(stageId)!;
    return {
      stageId, code: drop.code, runs, totalSanity: drop.sanity * runs,
      expectedDrops: Object.fromEntries([...yields].map(([id, rate]) => [id, rate * runs])),
    };
  });
  // Remove whole runs when the other stages already cover their drops.
  function trim(stages: PlanStage[]) {
    const totals = new Map<string, number>();
    for (const stage of stages) {
      for (const [id, quantity] of Object.entries(stage.expectedDrops)) {
        totals.set(id, (totals.get(id) ?? 0) + quantity);
      }
    }
    const reductions = new Map<string, PlanStage>();
    for (const stage of [...stages].sort((a, b) => b.totalSanity / b.runs - a.totalSanity / a.runs)) {
      const { drop, yields } = candidates.get(stage.stageId)!;
      let removable = stage.runs;
      for (const [id, rate] of yields) {
        const surplus = (totals.get(id) ?? 0) - required.get(id)!;
        removable = Math.min(removable, Math.max(0, Math.floor((surplus + 1e-9) / rate)));
      }
      const runs = stage.runs - removable;
      for (const [id, rate] of yields) totals.set(id, totals.get(id)! - removable * rate);
      reductions.set(stage.stageId, {
        ...stage, runs, totalSanity: drop.sanity * runs,
        expectedDrops: Object.fromEntries([...yields].map(([id, rate]) => [id, rate * runs])),
      });
    }
    return stages.map((stage) => reductions.get(stage.stageId)!).filter((stage) => stage.runs > 0);
  }

  const total = (stages: PlanStage[]) => stages.reduce((sum, stage) => sum + stage.totalSanity, 0);
  const directTrimmed = trim(direct);
  let stages = directTrimmed;
  function consider(candidate: PlanStage[] | null) {
    if (!candidate) return;
    const trimmed = trim(candidate);
    if (total(trimmed) < total(stages)) stages = trimmed;
  }

  function linearPlan(): PlanStage[] | null {
    if (!required.size) return [];
    const entries = [...candidates.values()];
    const constraints = Object.fromEntries([...required].map(([id, missing]) => [id, { min: missing }]));
    const variables = Object.fromEntries(entries.map(({ drop, yields }, index) => [
      `stage${index}`, { sanity: drop.sanity, ...Object.fromEntries(yields) },
    ]));
    const solution = solver.Solve({ optimize: "sanity", opType: "min", constraints, variables }) as
      { feasible: boolean; bounded?: boolean } & Record<string, unknown>;
    if (!solution.feasible || solution.bounded === false) return null;

    const totals = new Map<string, number>();
    const result: PlanStage[] = [];
    for (const [index, { drop, yields }] of entries.entries()) {
      const value = solution[`stage${index}`];
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
      const runs = Math.ceil(value);
      const expectedDrops: Record<string, number> = {};
      for (const [id, rate] of yields) {
        expectedDrops[id] = rate * runs;
        totals.set(id, (totals.get(id) ?? 0) + expectedDrops[id]);
      }
      result.push({ stageId: drop.stageId, code: drop.code, runs, totalSanity: runs * drop.sanity, expectedDrops });
    }
    return [...required].every(([id, missing]) => (totals.get(id) ?? 0) + 1e-9 >= missing) ? result : null;
  }

  consider(linearPlan());
  consider(greedyPlan());
  consider(greedyPlan(undefined, true));
  // Try alternatives to the most expensive commitments in the initial plan.
  const priorities = [...stages].sort((a, b) => b.totalSanity - a.totalSanity);
  for (const stage of priorities.slice(0, 6)) consider(greedyPlan(stage.stageId));
  return { stages, uncovered, totalSanity: total(stages), separateSanity };
}
