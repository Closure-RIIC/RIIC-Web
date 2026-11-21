import solver from "javascript-lp-solver";
import { availableFarmingDrops, planFarming } from "./training-farming";
import type { TrainingPlannerItem } from "./training-planner";

type Request = Parameters<typeof planFarming>;
type Craft = { id: string; batches: number; count: number; level: number; lmd: number };

export function planFarmingWithCrafts([needs, drops, now, includeScheduledChips]: Request, items: Readonly<Record<string, TrainingPlannerItem>>) {
  const direct = planFarming(needs, drops, now, includeScheduledChips);
  const fallback = { ...direct, crafts: [] as Craft[] };
  const required = new Map(needs.filter(({ missing }) => missing > 0).map(({ id, missing }) => [id, missing]));
  const relevant = new Set(required.keys());
  const recipes: Array<{ id: string; recipe: TrainingPlannerItem["recipes"][number] }> = [];
  for (const id of relevant) {
    for (const recipe of items[id]?.recipes ?? []) {
      if (recipe.facility !== "WORKSHOP" || recipe.output <= 0 || !recipe.inputs.length) continue;
      recipes.push({ id, recipe });
      for (const input of recipe.inputs) relevant.add(input.id);
    }
  }
  if (!recipes.length) return fallback;

  const stages = new Map<string, { stageId: string; code: string; sanity: number; yields: Record<string, number> }>();
  const obtainable = new Set<string>();
  for (const id of relevant) {
    for (const drop of availableFarmingDrops(drops[id] ?? [], now, includeScheduledChips)) {
      const stage = stages.get(drop.stageId) ?? { stageId: drop.stageId, code: drop.code, sanity: drop.sanity, yields: {} };
      stage.yields[id] = drop.quantity / drop.times;
      stages.set(drop.stageId, stage);
      obtainable.add(id);
    }
  }
  let previousSize = -1;
  while (previousSize !== obtainable.size) {
    previousSize = obtainable.size;
    for (const { id, recipe } of recipes) {
      if (recipe.inputs.every((input) => obtainable.has(input.id))) obtainable.add(id);
    }
  }

  const constraints = Object.fromEntries([...obtainable].map((id) => [`item_${id}`, { min: required.get(id) ?? 0 }]));
  const actions = [
    ...[...stages.values()].map((stage) => ({ stage, coefficients: stage.yields, sanity: stage.sanity })),
    ...recipes.filter(({ id, recipe }) => obtainable.has(id) && recipe.inputs.every((input) => obtainable.has(input.id)))
      .map(({ id, recipe }) => {
        const coefficients: Record<string, number> = { [id]: recipe.output };
        for (const input of recipe.inputs) coefficients[input.id] = (coefficients[input.id] ?? 0) - input.count;
        return { id, recipe, coefficients, sanity: 0 };
      }),
  ];
  if (!actions.some((action) => "recipe" in action)) return fallback;
  const variables = Object.fromEntries(actions.map(({ sanity, coefficients }, index) => [
    `action${index}`, { sanity, ...Object.fromEntries(Object.entries(coefficients).map(([id, yieldValue]) => [`item_${id}`, yieldValue])) },
  ]));
  let solution: Record<string, unknown>;
  try {
    solution = solver.Solve({
      optimize: "sanity", opType: "min", constraints, variables,
      ints: Object.fromEntries(Object.keys(variables).map((key) => [key, 1 as const])),
      timeout: 750,
    }) as Record<string, unknown>;
  } catch {
    return fallback;
  }
  if (!solution?.feasible || solution.bounded === false) return fallback;

  const balances: Record<string, number> = {};
  const resultStages: typeof direct.stages = [];
  const crafts: Craft[] = [];
  for (const [index, action] of actions.entries()) {
    const value = solution[`action${index}`] ?? 0;
    if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value - Math.round(value)) > 1e-6) return fallback;
    const runs = Math.round(value);
    if (runs < 0 || !Number.isSafeInteger(runs)) return fallback;
    if (!runs) continue;
    for (const [id, quantity] of Object.entries(action.coefficients)) balances[id] = (balances[id] ?? 0) + quantity * runs;
    if ("stage" in action) {
      const { stageId, code, sanity, yields } = action.stage;
      resultStages.push({ stageId, code, runs, totalSanity: sanity * runs,
        expectedDrops: Object.fromEntries(Object.entries(yields).map(([id, quantity]) => [id, quantity * runs])) });
    } else {
      const { id, recipe } = action;
      crafts.push({ id, batches: runs, count: recipe.output * runs, level: recipe.level, lmd: recipe.lmd * runs });
    }
  }
  if ([...obtainable].some((id) => (balances[id] ?? 0) + 1e-7 < (required.get(id) ?? 0))) return fallback;
  const uncovered = [...required.keys()].filter((id) => !obtainable.has(id));
  const totalSanity = resultStages.reduce((sum, stage) => sum + stage.totalSanity, 0);
  if (!crafts.length || (uncovered.length >= direct.uncovered.length && totalSanity >= direct.totalSanity)) return fallback;
  return { stages: resultStages, uncovered, totalSanity, separateSanity: direct.separateSanity, crafts };
}
