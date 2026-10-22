import assert from "node:assert/strict";
import test from "node:test";
import { buildHealthAdvice, holdsDurinGroup } from "./account-health-advice.ts";
import { extractAccountHealthInput } from "./account-health-input.ts";
import { trainingCost } from "./inventory-estimates.ts";
import { MODULE_LMD } from "./account-health-input.ts";

const operator = (id: string, rarity: number, elite: number, level: number, modules: Array<{ id: string; level: number; locked: boolean; name: string; isDefault: boolean }> = []) =>
  ({ id, name: id, rarity, elite, level, modules });
const mod = (id: string, level: number) => ({ id, level, locked: false, name: id, isDefault: true });

const trainedPool = { source: "skland" as const, items: [
  operator("a", 6, 2, 90, [mod("x", 3)]),
  operator("b", 6, 2, 90, [mod("y", 1)]),
  operator("c", 6, 2, 90, []),
] };

const threeDayReport = (day: Partial<{ lmd: number; goldValue: number; experience: number; orundum: number; equivalentGoldValue: number }>) =>
  ({ source: "game-report" as const, days: Array.from({ length: 3 }, () => ({ ...day })) });

test("durin group detection requires all three real operators", () => {
  const group = [
    { id: "char_4055_bgsnow", name: "鸿雪" },
    { id: "char_478_kirara", name: "绮良" },
    { id: "char_402_tuye", name: "图耶" },
  ];
  assert.equal(holdsDurinGroup(group, "skland"), true);
  assert.equal(holdsDurinGroup(group.slice(0, 2), "skland"), false);
  assert.equal(holdsDurinGroup(group, "sample"), false);
  assert.equal(holdsDurinGroup([...group.slice(0, 2), { id: "other", name: "他" }], "skland"), false);
  assert.equal(holdsDurinGroup([{ id: "x", name: "鸿雪" }, { id: "y", name: "绮良" }, { id: "z", name: "图耶" }], "maa"), true);
});

test("severe LMD shortage recommends 342 with the durin group, 333 without", () => {
  const base = {
    inventory: { items: [{ id: "4001", count: 2_000_000 }, { id: "2004", count: 4_000 }] },
    operators: trainedPool,
  };
  const withGroup = buildHealthAdvice(extractAccountHealthInput(base), true, "zh");
  const withoutGroup = buildHealthAdvice(extractAccountHealthInput(base), false, "zh");
  assert.equal(withGroup.recommendation?.layout, "342");
  assert.match(withGroup.recommendation?.headline ?? "", /纯钱表/);
  assert.match(withGroup.recommendation?.lines.join(" ") ?? "", /鸿雪杜林组/);
  assert.equal(withoutGroup.recommendation?.layout, "333");
  assert.match(withoutGroup.recommendation?.lines.join(" ") ?? "", /342 纯钱表/);
  assert.ok((withGroup.stock?.lmdShort ?? 0) >= 1_000_000);
  assert.match(withGroup.summary, /推测钱书需求比/);
  assert.match(withGroup.summary, /缺龙门币/);
  assert.match(withGroup.summary, /342/);
});

test("severe EXP shortage recommends 153", () => {
  const result = buildHealthAdvice(extractAccountHealthInput({
    inventory: { items: [{ id: "4001", count: 50_000_000 }, { id: "2004", count: 100 }] },
    operators: trainedPool,
  }), true, "zh");
  assert.equal(result.recommendation?.layout, "153");
  assert.ok((result.stock?.expShort ?? 0) >= 1_000_000);
  assert.match(result.summary, /缺经验/);
});

test("manageable gap recommends 252+342, or 243 when avoiding two power plants", () => {
  const base = {
    inventory: { items: [{ id: "4001", count: 10_000_000 }, { id: "2004", count: 3_500 }] },
    operators: trainedPool,
  };
  assert.equal(buildHealthAdvice(extractAccountHealthInput(base), true, "zh").recommendation?.layout, "252＋342 切换");
  assert.equal(buildHealthAdvice(extractAccountHealthInput({ ...base, demand: { twoPowerPlants: "avoid" } }), true, "zh").recommendation?.layout, "243");
});

test("orundum plans branch on layout preference and effort", () => {
  const base = { operators: trainedPool };
  const keep = buildHealthAdvice(extractAccountHealthInput({ ...base, demand: { orundumPlan: "planned", layoutChange: "keep" } }), true, "zh");
  assert.match(keep.recommendation?.headline ?? "", /现有布局/);
  assert.match(keep.recommendation?.lines.join(" ") ?? "", /开采协力/);
  const relaxed = buildHealthAdvice(extractAccountHealthInput({ ...base, demand: { orundumPlan: "planned", outputPriority: "low-maintenance" } }), true, "zh");
  assert.equal(relaxed.recommendation?.layout, "333");
  assert.match(relaxed.recommendation?.shifts.join(" ") ?? "", /搓玉期/);
  const output = buildHealthAdvice(extractAccountHealthInput({ ...base, demand: { orundumPlan: "planned", twoPowerPlants: "accept" } }), true, "zh");
  assert.equal(output.recommendation?.layout, "342");
  assert.match(output.recommendation?.lines.join(" ") ?? "", /源石碎片/);
});

test("production grading, net gain direction and gold balance follow skill-8 bands", () => {
  const health = extractAccountHealthInput({
    inventory: { items: [{ id: "4001", count: 2_000_000 }, { id: "2004", count: 4_000 }, { id: "3003", count: 240 }] },
    operators: trainedPool,
    report: threeDayReport({ lmd: 40_000, goldValue: 50_000, experience: 32_000 }),
  });
  const result = buildHealthAdvice(health, true, "zh");
  assert.equal(result.production?.capacityIndex, 96_000);
  assert.equal(result.production?.grade, "pass");
  assert.equal(result.production?.degraded, false);
  assert.equal(result.production?.dailyLmdIn, 70_000);
  assert.equal(result.production?.dailyExpIn, 62_000);
  assert.equal(result.production?.netGain?.resource, "lmd");
  assert.ok((result.production?.netGain?.amount ?? 0) < 0);
  assert.equal(result.production?.coverDays, null);
  assert.equal(result.production?.goldNetUnits, 30);
  assert.equal(result.production?.goldTone, "surplus");
  assert.equal(result.production?.goldRunwayDays, null);
  assert.equal(result.production?.goldEstimated, false);
  assert.equal(result.stock?.goldSurplus, "clear");
  assert.match(result.summary, /存在赤金盈余/);
});

test("gold deficit projects stock runway; irregular shifts stay in-game", () => {
  const health = extractAccountHealthInput({
    inventory: { items: [{ id: "3003", count: 330 }] },
    operators: trainedPool,
    report: threeDayReport({ lmd: 80_000, goldValue: 20_000, experience: 20_000 }),
    demand: { loginCadence: "irregular" },
  });
  const result = buildHealthAdvice(health, false, "zh");
  assert.equal(result.production?.goldTone, "deficit");
  assert.ok(Math.abs((result.production?.goldRunwayDays ?? 0) - 3) < 0.01);
  assert.equal(result.stock?.goldSurplus, "clear");
  const shifts = result.recommendation?.shifts.join("") ?? "";
  assert.ok(!shifts.includes("Mower"));
  assert.match(shifts, /自动轮换/);
});

test("large gold surplus is described qualitatively without bar counts", () => {
  const health = extractAccountHealthInput({
    inventory: { items: [{ id: "3003", count: 1_200 }] },
    operators: trainedPool,
  });
  const result = buildHealthAdvice(health, false, "zh");
  assert.equal(result.stock?.goldSurplus, "large");
  assert.match(result.summary, /存在大量赤金盈余/);
  assert.ok(!result.summary.includes("1200"));
});

test("surplus net gain projects cover days for the short side", () => {
  const health = extractAccountHealthInput({
    inventory: { items: [{ id: "4001", count: 2_000_000 }, { id: "2004", count: 4_000 }] },
    operators: trainedPool,
    report: threeDayReport({ lmd: 200_000, goldValue: 300_000, experience: 20_000, equivalentGoldValue: 100_000 }),
  });
  const result = buildHealthAdvice(health, true, "zh");
  assert.equal(result.production?.netGain?.resource, "lmd");
  assert.ok((result.production?.netGain?.amount ?? 0) > 0);
  assert.ok((result.production?.coverDays ?? 0) > 0);
});

test("degraded grading without gold data uses the LMD+EXP sum bands", () => {
  const health = extractAccountHealthInput({
    report: threeDayReport({ lmd: 40_000, experience: 32_000 }),
  });
  const result = buildHealthAdvice(health, false, "zh");
  assert.equal(result.production?.capacityIndex, null);
  assert.equal(result.production?.lmdExpSum, 72_000);
  assert.equal(result.production?.degraded, true);
  assert.equal(result.production?.grade, "pass");
  assert.match(result.summary, /钱书和/);
});

test("missing inputs surface notes instead of inventing conclusions", () => {
  const result = buildHealthAdvice(extractAccountHealthInput({}), false, "zh");
  assert.equal(result.stock, null);
  assert.equal(result.production, null);
  assert.ok(result.notes.length >= 3);
  assert.equal(result.recommendation === null, false);
  const en = buildHealthAdvice(extractAccountHealthInput({}), false, "en");
  assert.match(en.summary, /recommended/);
});

test("six-star training capacity takes the short side under both cost benchmarks", () => {
  const stockLmd = 400_000;
  const stockExp = 8_000_000;
  const health = extractAccountHealthInput({
    inventory: { items: [{ id: "4001", count: stockLmd }, { id: "2004", count: 4_000 }] },
    operators: trainedPool,
  });
  const capacity = buildHealthAdvice(health, false, "zh").stock?.sixStarCapacity;
  const six = extractAccountHealthInput({ operators: trainedPool }).training?.byRarity.find((row) => row.rarity === 6);
  assert.ok(six);
  const perLmd = (six.levelCost.lmd + (six.moduleLmd ?? 0)) / six.promotedE2;
  const perExp = six.levelCost.experience / six.promotedE2;
  const maxed = trainingCost(6, 2, 90);
  const maxedLmd = maxed.lmd + MODULE_LMD[6]!.reduce((sum, value) => sum + value, 0);
  assert.ok(capacity);
  assert.ok(Math.abs((capacity.byAverage ?? 0) - Math.min(stockLmd / perLmd, stockExp / perExp)) < 1e-9);
  assert.ok(Math.abs(capacity.byMaxed - Math.min(stockLmd / maxedLmd, stockExp / maxed.exp)) < 1e-9);
  assert.ok((capacity.byAverage ?? 0) >= 0 && (capacity.byAverage ?? 0) < 1);
  assert.ok(capacity.byMaxed < 1);
});

test("six-star capacity falls back to the maxed benchmark without a demand ratio", () => {
  const smallPool = { source: "skland" as const, items: [
    operator("a", 6, 2, 90, [mod("x", 3)]),
    operator("b", 6, 2, 90, []),
  ] };
  const health = extractAccountHealthInput({
    inventory: { items: [{ id: "4001", count: 100_000_000 }, { id: "2004", count: 25_000 }] },
    operators: smallPool,
  });
  const capacity = buildHealthAdvice(health, false, "zh").stock?.sixStarCapacity;
  const maxed = trainingCost(6, 2, 90);
  const maxedLmd = maxed.lmd + MODULE_LMD[6]!.reduce((sum, value) => sum + value, 0);
  assert.ok(capacity);
  assert.equal(capacity.byAverage, null);
  assert.ok(Math.abs(capacity.byMaxed - Math.min(100_000_000 / maxedLmd, 50_000_000 / maxed.exp)) < 1e-9);
  assert.ok(capacity.byMaxed >= 1);
});
