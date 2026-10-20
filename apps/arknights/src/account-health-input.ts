import { trainingCost } from "./inventory-estimates.ts";
import { estimateHeadhuntPulls } from "./headhunt-estimate.ts";
import { manualLevelFor } from "./manual-operbox.ts";
import { HEALTH_DEMAND_FIELDS, normalizeHealthDemand, type HealthDemand, type HealthDemandField } from "./account-health-demand.ts";
import type { SklandInventoryItem, SklandOperatorStatus } from "./types.ts";

export type TrainingOperator = Pick<SklandOperatorStatus, "id" | "rarity" | "elite" | "level"> &
  Partial<Pick<SklandOperatorStatus, "modules">> & { own?: boolean };

export interface HealthDailyReport {
  lmd?: number;
  goldValue?: number;
  experience?: number;
  orundum?: number;
  orderCount?: number;
  /** Extra LMD from orders that do not consume corresponding gold. */
  equivalentGoldValue?: number;
}

export interface AccountHealthRawInput {
  inventory?: { items: SklandInventoryItem[]; fetchedAt?: string; overrides?: Record<string, number> };
  operators?: { items: TrainingOperator[]; source: "skland" | "maa" | "sample" };
  /** Real in-game daily report values. Solver estimates must be identified separately. */
  report?: { days: HealthDailyReport[]; source: "game-report" | "solver-estimate" };
  demand?: HealthDemand;
}

export type ResourceStock = {
  fetchedAt: string | null;
  manuallyOverriddenIds: string[];
  lmd: number;
  goldUnits: number;
  experience: number;
  experienceCards: Record<"2001" | "2002" | "2003" | "2004", number>;
  orundum: number;
  originium: number;
  regularTickets: number;
  tenPullTickets: number;
  directPulls: number;
  yellowCertificatePulls: number;
  remainingOrundum: number;
  yellowCertificates: number;
  classicTickets: number;
  classicCurrency: number;
  lmdToExperience: number | null;
};

export interface RarityTrainingPattern {
  rarity: number;
  owned: number;
  promotedE2: number;
  e2AtLevelOne: number;
  developedE2: number;
  e2Share: number;
  developedLevelMedian: number | null;
  modulesOpened: number;
  modulesMaxed: number;
  operatorsWithModules: number;
  moduleDataCoverage: number;
  levelCost: { lmd: number; experience: number };
  moduleLmd: number | null;
}

export interface AccountHealthInput {
  inventory: ResourceStock | null;
  training: {
    source: "skland" | "maa" | "sample";
    usableForPersonalAssessment: boolean;
    byRarity: RarityTrainingPattern[];
    moduleDataComplete: boolean;
    style: "broad-e2" | "selective-e2" | "mixed-e2" | "early-stage" | "insufficient-data";
    levelOnlyLmdToExperience: number | null;
    representativeLmdToExperience: number | null;
  } | null;
  production: {
    source: "game-report" | "solver-estimate";
    reportDays: number;
    sampleDays: Record<"lmd" | "goldValue" | "experience" | "orundum" | "orderCount", number>;
    daily: { lmd: number | null; goldValue: number | null; experience: number | null; orundum: number | null; orderCount: number | null; equivalentGoldValue: number | null };
    capacityIndex: number | null;
    capacityIndexIncludesEquivalentGold: boolean;
    lmdExperienceSum: number | null;
    baseLmdToExperience: number | null;
    combinedLmdToExperience: number | null;
    goldBalance: {
      dailyGoldUnits: number;
      maximumConsumedUnits: number;
      minimumNetUnits: number;
      estimatedNetUnits: number | null;
      stockCoverDays: number | null;
    } | null;
  } | null;
  demand: HealthDemand | null;
  unansweredDemandFields: HealthDemandField[];
  missing: Array<"inventory" | "operators" | "report" | "demand">;
}

const EXP_PER_CARD = { "2001": 200, "2002": 400, "2003": 1_000, "2004": 2_000 } as const;
/** 各稀有度模组逐级解锁的龙门币费用（知识库《干员升级与模组消耗》）。 */
export const MODULE_LMD: Record<number, number[]> = {
  4: [20_000, 20_000, 30_000],
  5: [40_000, 50_000, 60_000],
  6: [80_000, 100_000, 120_000],
};

function validAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor((ordered.length - 1) / 2)]!;
}

function moduleCost(rarity: number, level: number): number {
  return (MODULE_LMD[rarity] ?? []).slice(0, Math.min(3, Math.max(0, Math.floor(level))))
    .reduce((total, value) => total + value, 0);
}

function stockFromItems(input: NonNullable<AccountHealthRawInput["inventory"]>): ResourceStock {
  const counts = new Map<string, number>();
  for (const item of input.items) {
    if (validAmount(item.count)) counts.set(item.id, item.count);
  }
  const manuallyOverriddenIds: string[] = [];
  for (const [id, amount] of Object.entries(input.overrides ?? {})) {
    if (validAmount(amount) && Number.isInteger(amount)) {
      counts.set(id, amount);
      manuallyOverriddenIds.push(id);
    }
  }
  const count = (id: string) => counts.get(id) ?? 0;
  const experienceCards = {
    "2001": count("2001"), "2002": count("2002"), "2003": count("2003"), "2004": count("2004"),
  };
  const experience = (Object.entries(experienceCards) as Array<[keyof typeof EXP_PER_CARD, number]>)
    .reduce((total, [id, amount]) => total + amount * EXP_PER_CARD[id], 0);
  const lmd = count("4001");
  const pulls = estimateHeadhuntPulls({
    originium: count("4002"), orundum: count("4003"),
    singleTickets: count("7003"), tenPullTickets: count("7004"),
    yellowCertificates: count("4004"),
  });
  return {
    fetchedAt: input.fetchedAt ?? null, manuallyOverriddenIds,
    lmd, goldUnits: count("3003"), experience, experienceCards,
    orundum: count("4003"), originium: count("4002"),
    regularTickets: count("7003"), tenPullTickets: count("7004"),
    directPulls: pulls.totalPulls,
    yellowCertificatePulls: pulls.exchangePulls,
    remainingOrundum: pulls.remainingOrundum,
    yellowCertificates: count("4004"),
    classicTickets: count("classic_gacha"), classicCurrency: count("classic_normal_ticket"),
    lmdToExperience: experience > 0 ? lmd / experience : null,
  };
}

function trainingFromOperators(input: NonNullable<AccountHealthRawInput["operators"]>): AccountHealthInput["training"] {
  const byRarity: RarityTrainingPattern[] = [];
  const held = input.items.filter((operator) => operator.own !== false);
  for (const rarity of [6, 5, 4, 3, 2, 1]) {
    const owned = held.filter((operator) => operator.rarity === rarity);
    const e2 = owned.filter((operator) => rarity >= 4 && operator.elite === 2
      && Number.isInteger(operator.level) && operator.level >= 1
      && operator.level <= manualLevelFor(rarity, 2));
    const developed = e2.filter((operator) => operator.level >= 40);
    const moduleCosts = e2.map((operator) => (operator.modules ?? [])
      .filter((module) => !module.locked && module.level >= 1)
      .reduce((total, module) => total + moduleCost(rarity, module.level), 0));
    // 钱书需求比向全部精二干员学习（含精二 1 级）；developedE2 仅保留为概览统计。
    const levelCost = e2.reduce((total, operator) => {
      const cost = trainingCost(rarity, 2, operator.level);
      return { lmd: total.lmd + cost.lmd, experience: total.experience + cost.exp };
    }, { lmd: 0, experience: 0 });
    const moduleDataCoverage = e2.filter((operator) => Array.isArray(operator.modules)).length;
    const moduleLmd = moduleDataCoverage === e2.length
      ? e2.reduce((total, operator) => total + (operator.modules ?? [])
        .filter((module) => !module.locked && module.level >= 1)
        .reduce((sum, module) => sum + moduleCost(rarity, module.level), 0), 0)
      : null;
    byRarity.push({
      rarity, owned: owned.length, promotedE2: e2.length,
      e2AtLevelOne: e2.filter((operator) => operator.level === 1).length,
      developedE2: developed.length,
      e2Share: owned.length ? e2.length / owned.length : 0,
      developedLevelMedian: median(developed.map((operator) => operator.level)),
      modulesOpened: e2.reduce((total, operator) => total + (operator.modules ?? []).filter((module) => !module.locked && module.level >= 1).length, 0),
      modulesMaxed: e2.reduce((total, operator) => total + (operator.modules ?? []).filter((module) => !module.locked && module.level >= 3).length, 0),
      operatorsWithModules: moduleCosts.filter((cost) => cost > 0).length,
      moduleDataCoverage, levelCost, moduleLmd,
    });
  }
  const totalE2 = byRarity.reduce((total, row) => total + row.promotedE2, 0);
  const totalLmd = byRarity.reduce((total, row) => total + row.levelCost.lmd, 0);
  const totalExperience = byRarity.reduce((total, row) => total + row.levelCost.experience, 0);
  const totalModuleLmd = byRarity.reduce((total, row) => total + (row.moduleLmd ?? 0), 0);
  const highRarity = byRarity.filter((row) => row.rarity >= 5);
  const highOwned = highRarity.reduce((total, row) => total + row.owned, 0);
  const highE2 = highRarity.reduce((total, row) => total + row.promotedE2, 0);
  const share = highOwned ? highE2 / highOwned : 0;
  const moduleDataComplete = byRarity.every((row) => row.moduleDataCoverage === row.promotedE2);
  const style = totalE2 < 3 || highOwned < 5 ? (held.length < 5 ? "insufficient-data" : "early-stage")
    : share >= 0.75 ? "broad-e2" : share <= 0.4 ? "selective-e2" : "mixed-e2";
  return {
    source: input.source, usableForPersonalAssessment: input.source !== "sample",
    byRarity, style, moduleDataComplete,
    levelOnlyLmdToExperience: input.source !== "sample" && totalE2 >= 3 && totalExperience > 0
      ? totalLmd / totalExperience : null,
    representativeLmdToExperience: input.source !== "sample" && moduleDataComplete
      && totalE2 >= 3 && totalExperience > 0
      ? (totalLmd + totalModuleLmd) / totalExperience : null,
  };
}

function productionFromReport(input: NonNullable<AccountHealthRawInput["report"]>, goldStock: number | null): AccountHealthInput["production"] {
  const average = (key: keyof HealthDailyReport): { value: number | null; days: number } => {
    const values = input.days.map((day) => day[key]).filter(validAmount);
    return { value: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null, days: values.length };
  };
  const lmd = average("lmd");
  const gold = average("goldValue");
  const experience = average("experience");
  const orundum = average("orundum");
  const orderCount = average("orderCount");
  const equivalentGold = average("equivalentGoldValue");
  const complete = (days: number) => days === input.days.length;
  const baseRatio = lmd.value !== null && experience.value !== null && experience.value > 0
    && complete(lmd.days) && complete(experience.days)
    ? lmd.value / experience.value : null;
  const combinedRatio = lmd.value !== null && experience.value !== null
    && complete(lmd.days) && complete(experience.days)
    ? (lmd.value + 30_000) / (experience.value + 30_000) : null;
  let goldBalance: NonNullable<AccountHealthInput["production"]>["goldBalance"] = null;
  if (gold.value !== null && lmd.value !== null && complete(gold.days) && complete(lmd.days)) {
    const dailyGoldUnits = gold.value / 500;
    const maximumConsumedUnits = lmd.value / 500;
    const estimatedConsumedUnits = equivalentGold.value === null || !complete(equivalentGold.days) ? null
      : Math.max(0, (lmd.value - equivalentGold.value) / 500);
    goldBalance = {
      dailyGoldUnits, maximumConsumedUnits,
      minimumNetUnits: dailyGoldUnits + 10 - maximumConsumedUnits,
      estimatedNetUnits: estimatedConsumedUnits === null ? null : dailyGoldUnits + 10 - estimatedConsumedUnits,
      stockCoverDays: goldStock === null || estimatedConsumedUnits === null || estimatedConsumedUnits === 0
        ? null : goldStock / estimatedConsumedUnits,
    };
  }
  return {
    source: input.source, reportDays: input.days.length,
    sampleDays: { lmd: lmd.days, goldValue: gold.days, experience: experience.days, orundum: orundum.days, orderCount: orderCount.days },
    daily: { lmd: lmd.value, goldValue: gold.value, experience: experience.value,
      orundum: orundum.value, orderCount: orderCount.value, equivalentGoldValue: equivalentGold.value },
    capacityIndex: lmd.value !== null && gold.value !== null && experience.value !== null
      && complete(lmd.days) && complete(gold.days) && complete(experience.days)
      ? lmd.value * 0.5 + (gold.value + (complete(equivalentGold.days) ? equivalentGold.value ?? 0 : 0)) * 0.8
        + experience.value + (orundum.value ?? 0) * 66.67 + 4_000
      : null,
    capacityIndexIncludesEquivalentGold: equivalentGold.value !== null && complete(equivalentGold.days),
    lmdExperienceSum: lmd.value !== null && experience.value !== null
      && complete(lmd.days) && complete(experience.days) ? lmd.value + experience.value : null,
    baseLmdToExperience: baseRatio, combinedLmdToExperience: combinedRatio, goldBalance,
  };
}

export function extractAccountHealthInput(raw: AccountHealthRawInput): AccountHealthInput {
  const inventory = raw.inventory ? stockFromItems(raw.inventory) : null;
  const demand = normalizeHealthDemand(raw.demand);
  const missing: AccountHealthInput["missing"] = [];
  if (!raw.inventory) missing.push("inventory");
  if (!raw.operators) missing.push("operators");
  if (!raw.report?.days.length) missing.push("report");
  if (!demand) missing.push("demand");
  return {
    inventory,
    training: raw.operators ? trainingFromOperators(raw.operators) : null,
    production: raw.report?.days.length ? productionFromReport(raw.report, inventory?.goldUnits ?? null) : null,
    demand,
    unansweredDemandFields: HEALTH_DEMAND_FIELDS.filter((field) => demand?.[field] === undefined),
    missing,
  };
}
