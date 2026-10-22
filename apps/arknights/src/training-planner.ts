import { trainingCost } from "./inventory-estimates.ts";
import { manualLevelFor, maxEliteForRarity } from "@riic/arknights-domain/manual-operbox";

export type TrainingCostItem = { id: string; count: number };
export type TrainingPlannerRecipe = {
  facility: "WORKSHOP" | "MANUFACTURE";
  level: number;
  output: number;
  lmd: number;
  inputs: TrainingCostItem[];
  stages: string[];
};
export type TrainingPlannerItem = {
  name: string;
  icon: string;
  rarity: number;
  drops: string[];
  recipes: TrainingPlannerRecipe[];
};
export type TrainingPlannerOperator = {
  phases: TrainingCostItem[][];
  skillLevels: TrainingCostItem[][];
  skills: Array<{ id: string; masteries: TrainingCostItem[][] }>;
  modules: Array<{
    id: string;
    name: string;
    unlockLevel: number;
    costs: Record<string, TrainingCostItem[]>;
  }>;
};
export type TrainingGoal = {
  operatorId: string;
  currentElite: number;
  currentLevel: number;
  targetElite: number;
  targetLevel: number;
  currentSkillLevel: number;
  targetSkillLevel: number;
  currentMasteries: Record<string, number>;
  targetMasteries: Record<string, number>;
  currentModules: Record<string, number>;
  targetModules: Record<string, number>;
};
export type TrainingPlannerData = {
  source: { repository: string; commit: string };
  operators: Record<string, TrainingPlannerOperator>;
  items: Record<string, TrainingPlannerItem>;
};

type TrainingCompletionStatus = {
  elite?: number;
  level?: number;
  mainSkillLevel?: number;
  skills?: readonly { index: number; specializeLevel: number }[];
  modules?: readonly { id: string; level: number; locked: boolean }[];
};

export function isTrainingFullyComplete(
  rarity: number,
  status: TrainingCompletionStatus | undefined,
  operator: TrainingPlannerOperator | undefined,
): boolean {
  if (!status || !operator) return false;

  const maxElite = maxEliteForRarity(rarity);
  if ((status.elite ?? -1) < maxElite || (status.level ?? 0) < manualLevelFor(rarity, maxElite)) return false;
  if (operator.skillLevels.length && (status.mainSkillLevel ?? 0) < operator.skillLevels.length + 1) return false;

  for (const [index, skill] of operator.skills.entries()) {
    if (!skill.masteries.length) continue;
    const current = status.skills?.find((entry) => entry.index === index + 1)?.specializeLevel ?? 0;
    if (current < skill.masteries.length) return false;
  }

  for (const module of operator.modules) {
    const maxLevel = Math.max(0, ...Object.keys(module.costs).map(Number).filter(Number.isFinite));
    if (!maxLevel) continue;
    const current = status.modules?.find((entry) => entry.id === module.id);
    if (!current || current.locked || current.level < maxLevel) return false;
  }

  return true;
}

export type TrainingPlannerResult = {
  goals: number;
  lmd: number;
  lmdStock: number;
  lmdStockWithGoldBars: number;
  lmdMissing: number;
  experience: number;
  experienceStock: number;
  experienceMissing: number;
  experienceBooksEquivalent: number;
  requirements: Record<string, number>;
  consumedStock: Record<string, number>;
  shortages: Array<{
    id: string;
    name: string;
    icon: string;
    rarity: number;
    need: number;
    stock: number;
    missing: number;
    drops: string[];
  }>;
  crafts: Array<{
    id: string;
    name: string;
    icon: string;
    count: number;
    facility: TrainingPlannerRecipe["facility"];
    level: number;
    lmd: number;
    inputs: TrainingCostItem[];
  }>;
};

const BOOK_EXPERIENCE: Record<string, number> = {
  "2001": 200,
  "2002": 400,
  "2003": 1_000,
  "2004": 2_000,
};

function addCost(target: Record<string, number>, entries: readonly TrainingCostItem[] = []) {
  for (const item of entries) target[item.id] = (target[item.id] ?? 0) + item.count;
}

function addGoalCosts(
  goal: TrainingGoal,
  rarity: number,
  operator: TrainingPlannerOperator,
  requirements: Record<string, number>,
) {
  const levelCost = trainingCost(
    rarity, goal.targetElite, goal.targetLevel,
  );
  const currentCost = trainingCost(
    rarity, goal.currentElite, goal.currentLevel,
  );
  if (goal.targetElite > goal.currentElite || goal.targetLevel > goal.currentLevel) {
    const expDelta = Math.max(0, levelCost.exp - currentCost.exp);
    requirements.$experience = (requirements.$experience ?? 0) + expDelta;
    requirements.$lmd = (requirements.$lmd ?? 0) + Math.max(0, levelCost.lmd - currentCost.lmd);
  }

  for (let elite = goal.currentElite + 1; elite <= goal.targetElite; elite += 1) {
    addCost(requirements, operator.phases[elite] ?? []);
  }

  for (let level = goal.currentSkillLevel + 1; level <= goal.targetSkillLevel; level += 1) {
    addCost(requirements, operator.skillLevels[level - 2] ?? []);
  }

  for (const [skillId, target] of Object.entries(goal.targetMasteries)) {
    const skill = operator.skills.find((entry) => entry.id === skillId);
    const current = goal.currentMasteries[skillId] ?? 0;
    for (let level = current + 1; level <= target; level += 1) {
      addCost(requirements, skill?.masteries[level - 1] ?? []);
    }
  }

  for (const [moduleId, target] of Object.entries(goal.targetModules)) {
    const module = operator.modules.find((entry) => entry.id === moduleId);
    const current = goal.currentModules[moduleId] ?? 0;
    for (let level = current + 1; level <= target; level += 1) {
      for (const item of module?.costs[String(level)] ?? []) {
        if (item.id === "4001") requirements.$lmd = (requirements.$lmd ?? 0) + item.count;
        else addCost(requirements, [item]);
      }
    }
  }
}

export function calculateTrainingPlan(input: {
  goals: readonly TrainingGoal[];
  operators: readonly { id: string; rarity: number }[];
  data: TrainingPlannerData;
  inventory: Readonly<Record<string, number>>;
}): TrainingPlannerResult {
  const requirements: Record<string, number> = {};
  const rarityById = new Map(input.operators.map((operator) => [operator.id, operator.rarity]));
  for (const goal of input.goals) {
    const operator = input.data.operators[goal.operatorId];
    if (!operator) continue;
    const rarity = rarityById.get(goal.operatorId);
    if (!rarity) continue;
    addGoalCosts(goal, rarity, operator, requirements);
  }

  const experience = requirements.$experience ?? 0;
  let lmd = requirements.$lmd ?? 0;
  delete requirements.$experience;
  delete requirements.$lmd;

  const experienceStock = Object.entries(BOOK_EXPERIENCE)
    .reduce((sum, [id, value]) => sum + (input.inventory[id] ?? 0) * value, 0);
  const lmdStock = input.inventory["4001"] ?? 0;
  const lmdStockWithGoldBars = lmdStock + (input.inventory["3003"] ?? 0) * 500;
  const remaining = { ...requirements };
  const consumedStock: Record<string, number> = {};
  const crafts: TrainingPlannerResult["crafts"] = [];
  const demand = { ...remaining };
  const unresolved: Record<string, number> = {};
  const processOrder = Object.keys(input.data.items).sort((left, right) => (
    (input.data.items[right]?.rarity ?? 0) - (input.data.items[left]?.rarity ?? 0)
    || left.localeCompare(right)
  ));

  for (const id of processOrder) {
    const need = remaining[id] ?? 0;
    if (need <= 0) continue;
    const stock = Math.max(0, Math.floor(input.inventory[id] ?? 0));
    const used = Math.min(stock, need);
    if (used) consumedStock[id] = used;
    const missing = need - used;
    if (!missing) {
      remaining[id] = 0;
      continue;
    }
    const item = input.data.items[id];
    const recipe = item?.recipes.find((entry) => entry.inputs.length > 0);
    if (!recipe || (item?.rarity ?? 0) < 2) {
      unresolved[id] = missing;
      continue;
    }
    const batches = Math.ceil(missing / Math.max(1, recipe.output));
    remaining[id] = 0;
    lmd += batches * recipe.lmd;
    crafts.push({
      id,
      name: item.name,
      icon: item.icon,
      count: batches,
      facility: recipe.facility,
      level: recipe.level,
      lmd: batches * recipe.lmd,
      inputs: recipe.inputs.map((ingredient) => ({ ...ingredient, count: ingredient.count * batches })),
    });
    for (const ingredient of recipe.inputs) {
      remaining[ingredient.id] = (remaining[ingredient.id] ?? 0) + ingredient.count * batches;
      demand[ingredient.id] = (demand[ingredient.id] ?? 0) + ingredient.count * batches;
    }
  }

  const shortages = Object.entries(unresolved)
    .map(([id, missing]) => {
      const item = input.data.items[id];
      const stock = Math.max(0, Math.floor(input.inventory[id] ?? 0));
      return {
        id,
        name: item?.name ?? id,
        icon: item?.icon ?? "",
        rarity: item?.rarity ?? 0,
        need: demand[id] ?? 0,
        stock,
        missing,
        drops: item?.drops ?? [],
      };
    })
    .filter((item) => item.missing > 0)
    .sort((left, right) => right.rarity - left.rarity || left.name.localeCompare(right.name, "zh-CN"));

  return {
    goals: input.goals.length,
    lmd,
    lmdStock,
    lmdStockWithGoldBars,
    lmdMissing: Math.max(0, lmd - lmdStockWithGoldBars),
    experience,
    experienceStock,
    experienceMissing: Math.max(0, experience - experienceStock),
    experienceBooksEquivalent: Math.ceil(Math.max(0, experience - experienceStock) / 2_000),
    requirements,
    consumedStock,
    shortages,
    crafts,
  };
}

export function defaultTrainingGoal(
  operator: { id: string; rarity: number },
  current: { elite?: number; level?: number; own?: boolean } | undefined,
  status?: {
    mainSkillLevel?: number;
    skills?: Array<{ index: number; specializeLevel: number }>;
    modules?: Array<{ id: string; level: number; locked: boolean }>;
  },
  skills: TrainingPlannerOperator["skills"] = [],
  modules: TrainingPlannerOperator["modules"] = [],
): TrainingGoal {
  const elite = Math.max(0, Math.min(current?.own === false ? 0 : current?.elite ?? 0, 2));
  const level = Math.max(1, Math.min(current?.own === false ? 1 : current?.level ?? 1, manualLevelFor(operator.rarity, elite)));
  const maxElite = operator.rarity >= 4 ? 2 : operator.rarity === 3 ? 1 : 0;
  const currentMasteries = Object.fromEntries((status?.skills ?? []).flatMap((skill) => {
    const id = skills[skill.index - 1]?.id;
    return id ? [[id, Math.max(0, Math.min(skill.specializeLevel, 3))]] : [];
  }));
  const moduleIds = new Set(modules.map((module) => module.id));
  const currentModules = Object.fromEntries((status?.modules ?? [])
    .filter((module) => !module.locked && moduleIds.has(module.id))
    .map((module) => [module.id, Math.max(0, Math.min(module.level, 3))]));
  return {
    operatorId: operator.id,
    currentElite: elite,
    currentLevel: level,
    targetElite: maxElite,
    targetLevel: level,
    currentSkillLevel: Math.max(1, Math.min(status?.mainSkillLevel ?? 1, 7)),
    targetSkillLevel: Math.max(1, Math.min(status?.mainSkillLevel ?? 1, 7)),
    currentMasteries,
    targetMasteries: {},
    currentModules,
    targetModules: {},
  };
}

export function mergeTrainingGoalCurrent(goal: TrainingGoal, current: TrainingGoal): TrainingGoal {
  const targetElite = Math.max(goal.targetElite, current.currentElite);
  const targetLevel = goal.targetElite < current.currentElite
    ? current.currentLevel
    : goal.targetElite === current.currentElite
      ? Math.max(goal.targetLevel, current.currentLevel)
      : goal.targetLevel;
  const targetMasteries = { ...goal.targetMasteries };
  for (const [skillId, level] of Object.entries(current.currentMasteries)) {
    targetMasteries[skillId] = Math.max(targetMasteries[skillId] ?? goal.currentMasteries[skillId] ?? 0, level);
  }
  const targetModules = { ...goal.targetModules };
  for (const [moduleId, level] of Object.entries(current.currentModules)) {
    targetModules[moduleId] = Math.max(targetModules[moduleId] ?? goal.currentModules[moduleId] ?? 0, level);
  }

  return {
    ...goal,
    currentElite: current.currentElite,
    currentLevel: current.currentLevel,
    targetElite,
    targetLevel,
    currentSkillLevel: current.currentSkillLevel,
    targetSkillLevel: Math.max(goal.targetSkillLevel, current.currentSkillLevel),
    currentMasteries: current.currentMasteries,
    targetMasteries,
    currentModules: current.currentModules,
    targetModules,
  };
}
