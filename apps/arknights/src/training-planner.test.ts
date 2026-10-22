import assert from "node:assert/strict";
import test from "node:test";
import { calculateTrainingPlan, defaultTrainingGoal, isTrainingFullyComplete, mergeTrainingGoalCurrent, type TrainingPlannerData, type TrainingGoal } from "./training-planner.ts";
import { trainingCost } from "./inventory-estimates.ts";

const goal = (operatorId: string, overrides: Partial<TrainingGoal> = {}): TrainingGoal => ({
  operatorId,
  currentElite: 0,
  currentLevel: 1,
  targetElite: 0,
  targetLevel: 1,
  currentSkillLevel: 1,
  targetSkillLevel: 1,
  currentMasteries: {},
  targetMasteries: {},
  currentModules: {},
  targetModules: {},
  ...overrides,
});

const data: TrainingPlannerData = {
  source: { repository: "test", commit: "test" },
  operators: {
    char_100_a: {
      phases: [[], [{ id: "30012", count: 2 }], [{ id: "30014", count: 1 }]],
      skillLevels: [[{ id: "3301", count: 1 }], [{ id: "30012", count: 1 }]],
      skills: [{ id: "skill_a", masteries: [[{ id: "30013", count: 2 }], [{ id: "30135", count: 1 }], []] }],
      modules: [{
        id: "module_a",
        name: "Module A",
        unlockLevel: 60,
        costs: { "1": [{ id: "mod_unlock_token", count: 1 }, { id: "4001", count: 1_000 }], "2": [{ id: "30013", count: 3 }] },
      }],
    },
    char_101_b: {
      phases: [[], [{ id: "30012", count: 2 }]],
      skillLevels: [], skills: [], modules: [],
    },
  },
  items: {
    "30012": { name: "Solid Rock", icon: "rock.png", rarity: 2, drops: [], recipes: [{ facility: "WORKSHOP", level: 1, output: 1, lmd: 100, inputs: [{ id: "30011", count: 3 }], stages: [] }] },
    "30011": { name: "Orirock", icon: "orirock.png", rarity: 1, drops: ["1-7"], recipes: [] },
    "30013": { name: "Orirock Cluster", icon: "cluster.png", rarity: 3, drops: [], recipes: [{ facility: "WORKSHOP", level: 2, output: 1, lmd: 200, inputs: [{ id: "30012", count: 5 }], stages: [] }] },
    "30014": { name: "Orirock Concentration", icon: "concentration.png", rarity: 4, drops: [], recipes: [{ facility: "WORKSHOP", level: 3, output: 1, lmd: 300, inputs: [{ id: "30013", count: 4 }], stages: [] }] },
    "30135": { name: "D32 Steel", icon: "steel.png", rarity: 5, drops: [], recipes: [] },
    "3301": { name: "Skill Summary 1", icon: "book.png", rarity: 1, drops: [], recipes: [] },
    mod_unlock_token: { name: "Module Data Block", icon: "module.png", rarity: 5, drops: [], recipes: [] },
  },
};

test("merges shared promotion materials before subtracting the inventory", () => {
  const result = calculateTrainingPlan({
    goals: [goal("char_100_a", { targetElite: 1 }), goal("char_101_b", { targetElite: 1 })],
    operators: [{ id: "char_100_a", rarity: 6 }, { id: "char_101_b", rarity: 6 }],
    data,
    inventory: { "30012": 3 },
  });
  assert.equal(result.requirements["30012"], 4);
  assert.equal(result.shortages.find((item) => item.id === "30011")?.missing, 3);
  assert.equal(result.crafts.find((item) => item.id === "30012")?.count, 1);
});

test("unpacks high-rarity requirements through recipes and includes crafting fees", () => {
  const result = calculateTrainingPlan({
    goals: [goal("char_100_a", { targetElite: 2 })],
    operators: [{ id: "char_100_a", rarity: 6 }],
    data,
    inventory: { "30014": 0, "30013": 0, "30012": 0, "30011": 0, "4001": 0 },
  });
  assert.deepEqual(result.crafts.map((craft) => [craft.id, craft.count]), [["30014", 1], ["30013", 4], ["30012", 22]]);
  assert.equal(result.shortages.find((item) => item.id === "30011")?.need, 66);
  assert.equal(result.lmd, trainingCost(6, 2, 1).lmd + 3_300);
});

test("adds skill, mastery and module costs from the remaining level onward", () => {
  const result = calculateTrainingPlan({
    goals: [goal("char_100_a", {
      targetSkillLevel: 3,
      targetMasteries: { skill_a: 2 },
      targetModules: { module_a: 2 },
    })],
    operators: [{ id: "char_100_a", rarity: 6 }],
    data,
    inventory: { "30012": 0, "30013": 0, "30135": 0, "3301": 0, mod_unlock_token: 0, "4001": 0 },
  });
  assert.equal(result.requirements["3301"], 1);
  assert.equal(result.requirements["30012"], 1);
  assert.equal(result.requirements["30013"], 5);
  assert.equal(result.requirements["30135"], 1);
  assert.equal(result.requirements.mod_unlock_token, 1);
  assert.equal(result.lmd, 4_600);
});

test("calculates level experience and LMD deltas and values red gold as an optional reserve", () => {
  const result = calculateTrainingPlan({
    goals: [goal("char_100_a", { currentElite: 0, currentLevel: 40, targetElite: 0, targetLevel: 45 })],
    operators: [{ id: "char_100_a", rarity: 6 }],
    data,
    inventory: { "4001": 100, "3003": 2, "2001": 5 },
  });
  assert.equal(result.experience, trainingCost(6, 0, 45).exp - trainingCost(6, 0, 40).exp);
  assert.equal(result.experienceMissing, result.experience - 1_000);
  assert.equal(result.lmdStockWithGoldBars, 1_100);
  assert.equal(result.experienceStock, 1_000);
});

test("includes low-rarity operators that have no promotion stages", () => {
  const result = calculateTrainingPlan({
    goals: [goal("char_102_c", { targetLevel: 30 })],
    operators: [{ id: "char_102_c", rarity: 2 }],
    data: { ...data, operators: { ...data.operators, char_102_c: { phases: [[]], skillLevels: [], skills: [], modules: [] } } },
    inventory: {},
  });
  assert.equal(result.lmd, trainingCost(2, 0, 30).lmd);
  assert.equal(result.experience, trainingCost(2, 0, 30).exp);
});

test("restores current skill and only unlocked modules known to the planner data", () => {
  const operator = data.operators.char_100_a!;
  const restored = defaultTrainingGoal(
    { id: "char_100_a", rarity: 6 },
    { elite: 2, level: 90, own: true },
    {
      mainSkillLevel: 7,
      skills: [{ index: 1, specializeLevel: 2 }],
      modules: [
        { id: "module_a", level: 2, locked: false },
        { id: "module_locked", level: 3, locked: true },
        { id: "unknown_module", level: 3, locked: false },
      ],
    },
    operator.skills,
    operator.modules,
  );
  assert.equal(restored.currentMasteries.skill_a, 2);
  assert.deepEqual(restored.currentModules, { module_a: 2 });
});

test("recognizes fully trained operators but keeps candidates with any remaining upgrade", () => {
  const operator = data.operators.char_100_a!;
  const status = {
    elite: 2,
    level: 90,
    mainSkillLevel: 3,
    skills: [{ index: 1, specializeLevel: 3 }],
    modules: [{ id: "module_a", level: 2, locked: false }],
  };

  assert.equal(isTrainingFullyComplete(6, status, operator), true);
  assert.equal(isTrainingFullyComplete(6, { ...status, modules: [{ id: "module_a", level: 1, locked: false }] }, operator), false);
  assert.equal(isTrainingFullyComplete(6, { ...status, skills: [{ index: 1, specializeLevel: 2 }] }, operator), false);
  assert.equal(isTrainingFullyComplete(6, undefined, operator), false);
});

test("refreshes saved goal current training from Skland while preserving forward targets", () => {
  const saved = goal("char_100_a", {
    currentElite: 1,
    currentLevel: 60,
    targetElite: 2,
    targetLevel: 80,
    currentSkillLevel: 7,
    targetSkillLevel: 7,
    currentMasteries: { skill_a: 1 },
    targetMasteries: { skill_a: 3 },
    currentModules: { module_a: 1 },
    targetModules: { module_a: 2 },
  });
  const latest = defaultTrainingGoal(
    { id: "char_100_a", rarity: 6 },
    { elite: 2, level: 85, own: true },
    {
      mainSkillLevel: 7,
      skills: [{ index: 1, specializeLevel: 2 }],
      modules: [{ id: "module_a", level: 2, locked: false }],
    },
    data.operators.char_100_a!.skills,
    data.operators.char_100_a!.modules,
  );

  const merged = mergeTrainingGoalCurrent(saved, latest);
  assert.equal(merged.currentElite, 2);
  assert.equal(merged.currentLevel, 85);
  assert.equal(merged.targetElite, 2);
  assert.equal(merged.targetLevel, 85);
  assert.equal(merged.currentMasteries.skill_a, 2);
  assert.equal(merged.targetMasteries.skill_a, 3);
  assert.equal(merged.currentModules.module_a, 2);
  assert.equal(merged.targetModules.module_a, 2);
});
