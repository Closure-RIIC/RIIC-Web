import assert from "node:assert/strict";
import test from "node:test";
import { extractAccountHealthInput } from "./account-health-input.ts";
import { trainingCost } from "./inventory-estimates.ts";

const operator = (id: string, rarity: number, elite: number, level: number, modules: Array<{ id: string; level: number; locked: boolean; name: string; isDefault: boolean }> = []) =>
  ({ id, rarity, elite, level, modules });

test("inventory keeps gold, experience and regular pulls in distinct units", () => {
  const result = extractAccountHealthInput({ inventory: { fetchedAt: "2026-09-24T00:00:00Z", items: [
    { id: "4001", count: 1_200_000 }, { id: "3003", count: 500 },
    { id: "2001", count: 1 }, { id: "2002", count: 2 },
    { id: "2003", count: 3 }, { id: "2004", count: 4 },
    { id: "4003", count: 1_100 }, { id: "4002", count: 1 },
    { id: "7003", count: 2 }, { id: "7004", count: 1 },
    { id: "4004", count: 258 }, { id: "classic_gacha", count: 3 },
  ], overrides: { "3003": 600, "4001": -1 } } });
  assert.equal(result.inventory?.experience, 12_000);
  assert.equal(result.inventory?.lmdToExperience, 100);
  assert.equal(result.inventory?.goldUnits, 600);
  assert.deepEqual(result.inventory?.manuallyOverriddenIds, ["3003"]);
  assert.equal(result.inventory?.fetchedAt, "2026-09-24T00:00:00Z");
  assert.equal(result.inventory?.directPulls, 52);
  assert.equal(result.inventory?.yellowCertificatePulls, 38);
  assert.equal(result.inventory?.remainingOrundum, 80);
  assert.equal(result.inventory?.yellowCertificates, 258);
  assert.equal(result.inventory?.classicTickets, 3);
  assert.deepEqual(result.missing, ["operators", "report", "demand"]);
});

test("regular pulls follow the inventory-page estimate ladder for yellow certificates", () => {
  const result = extractAccountHealthInput({ inventory: { items: [
    { id: "4004", count: 257 },
  ] } });
  assert.equal(result.inventory?.yellowCertificatePulls, 18);
  assert.equal(result.inventory?.directPulls, 18);
});

test("training ratio sums every promoted operator including E2 level ones", () => {
  const items = [
    operator("a", 6, 2, 60, [
      { id: "x", level: 3, locked: false, name: "X", isDefault: true },
      { id: "x2", level: 2, locked: false, name: "X2", isDefault: false },
    ]),
    operator("b", 6, 2, 80, [{ id: "y", level: 1, locked: false, name: "Y", isDefault: true }]),
    operator("c", 6, 2, 90, [{ id: "z", level: 3, locked: true, name: "Z", isDefault: false }]),
    operator("d", 6, 0, 1), operator("e", 6, 0, 1),
    operator("h", 6, 2, 1),
    operator("f", 5, 2, 50), operator("g", 5, 0, 1),
  ];
  const result = extractAccountHealthInput({ operators: { source: "skland", items } });
  const six = result.training?.byRarity.find((row) => row.rarity === 6);
  const five = result.training?.byRarity.find((row) => row.rarity === 5);
  assert.equal(result.training?.style, "mixed-e2");
  assert.equal(six?.promotedE2, 4);
  assert.equal(six?.e2AtLevelOne, 1);
  assert.equal(six?.developedE2, 3);
  assert.equal(six?.developedLevelMedian, 80);
  assert.equal(six?.modulesOpened, 3);
  assert.equal(six?.modulesMaxed, 1);
  assert.equal(six?.moduleDataCoverage, 4);
  assert.equal(six?.moduleLmd, 560_000);
  assert.equal(five?.promotedE2, 1);
  const costs = [[6, 60], [6, 80], [6, 90], [6, 1], [5, 50]].map(([rarity, level]) => trainingCost(rarity!, 2, level!));
  const lmd = costs.reduce((total, cost) => total + cost.lmd, 0);
  const exp = costs.reduce((total, cost) => total + cost.exp, 0);
  assert.equal(six?.levelCost.lmd, costs.slice(0, 4).reduce((total, cost) => total + cost.lmd, 0));
  assert.equal(result.training?.levelOnlyLmdToExperience, lmd / exp);
  assert.equal(result.training?.representativeLmdToExperience, (lmd + 560_000) / exp);
});

test("sample pool and small training sample do not imply a personal demand ratio", () => {
  const items = [operator("a", 6, 2, 90), operator("b", 6, 2, 90)];
  const sample = extractAccountHealthInput({ operators: { source: "sample", items } });
  const small = extractAccountHealthInput({ operators: { source: "maa", items } });
  assert.equal(sample.training?.usableForPersonalAssessment, false);
  assert.equal(sample.training?.levelOnlyLmdToExperience, null);
  assert.equal(sample.training?.representativeLmdToExperience, null);
  assert.equal(small.training?.representativeLmdToExperience, null);
});

test("MAA unowned entries do not inflate training coverage", () => {
  const result = extractAccountHealthInput({ operators: { source: "maa", items: [
    { ...operator("a", 6, 2, 60), own: true },
    { ...operator("b", 6, 2, 90), own: false },
  ] } });
  assert.equal(result.training?.byRarity[0]?.owned, 1);
  assert.equal(result.training?.byRarity[0]?.developedLevelMedian, 60);
});

test("unknown MAA module data cannot be mistaken for no modules", () => {
  const result = extractAccountHealthInput({ operators: { source: "maa", items: [
    { id: "a", rarity: 6, elite: 2, level: 60 },
    { id: "b", rarity: 6, elite: 2, level: 60 },
    { id: "c", rarity: 6, elite: 2, level: 60 },
    { id: "d", rarity: 6, elite: 0, level: 1 },
    { id: "e", rarity: 6, elite: 0, level: 1 },
  ] } });
  assert.equal(result.training?.moduleDataComplete, false);
  assert.equal(result.training?.byRarity[0]?.moduleLmd, null);
  assert.equal(result.training?.levelOnlyLmdToExperience, trainingCost(6, 2, 60).lmd / trainingCost(6, 2, 60).exp);
  assert.equal(result.training?.representativeLmdToExperience, null);
});

test("partial account preferences remain explicit and expose unanswered fields", () => {
  const result = extractAccountHealthInput({ demand: {
    orundumPlan: "planned", outputPriority: "low-maintenance", twoPowerPlants: "avoid",
  } });
  assert.deepEqual(result.demand, {
    orundumPlan: "planned", outputPriority: "low-maintenance", twoPowerPlants: "avoid",
  });
  assert.equal(result.unansweredDemandFields.includes("loginCadence"), true);
  assert.equal(result.unansweredDemandFields.includes("orundumPlan"), false);
  assert.equal(result.missing.includes("demand"), false);
});

test("three-day report exposes capacity and gold bounds without inventing special-order savings", () => {
  const result = extractAccountHealthInput({
    inventory: { items: [{ id: "3003", count: 400 }] },
    report: { source: "game-report", days: Array.from({ length: 3 }, () => ({
      lmd: 40_000, goldValue: 50_000, experience: 32_000, orderCount: 39, orundum: 0,
    })) },
  });
  assert.equal(result.production?.daily.orderCount, 39);
  assert.equal(result.production?.capacityIndex, 96_000);
  assert.equal(result.production?.baseLmdToExperience, 1.25);
  assert.equal(result.production?.combinedLmdToExperience, 70 / 62);
  assert.equal(result.production?.goldBalance?.minimumNetUnits, 30);
  assert.equal(result.production?.goldBalance?.estimatedNetUnits, null);
  assert.equal(result.production?.goldBalance?.stockCoverDays, null);
});

test("partial report does not mix different day sets into a capacity or gold balance", () => {
  const result = extractAccountHealthInput({ report: { source: "game-report", days: [
    { lmd: 40_000, goldValue: 40_000, experience: 30_000 },
    { lmd: 50_000, experience: 30_000 },
  ] } });
  assert.equal(result.production?.capacityIndex, null);
  assert.equal(result.production?.goldBalance, null);
  assert.equal(result.production?.sampleDays.goldValue, 1);
  assert.equal(result.production?.lmdExperienceSum, 75_000);
});

test("known special-order value adjusts gold consumption and capacity", () => {
  const result = extractAccountHealthInput({
    inventory: { items: [{ id: "3003", count: 300 }] },
    report: { source: "game-report", days: Array.from({ length: 3 }, () => ({
      lmd: 50_000, goldValue: 40_000, experience: 30_000, equivalentGoldValue: 5_000,
    })) },
  });
  assert.equal(result.production?.capacityIndex, 95_000);
  assert.equal(result.production?.capacityIndexIncludesEquivalentGold, true);
  assert.equal(result.production?.goldBalance?.estimatedNetUnits, 0);
  assert.equal(result.production?.goldBalance?.stockCoverDays, 300 / 90);
});
