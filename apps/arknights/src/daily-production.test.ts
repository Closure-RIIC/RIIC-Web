import assert from "node:assert/strict";
import test from "node:test";

import { estimateDailyProduction } from "./daily-production.ts";
import type { BaseBlueprint, MaaJson, RotationJson, RotationRoomLine } from "./types.ts";

function fixture({
  tradeLevels = [1, 2, 3],
  tradeProducts = ["LMD", "LMD", "LMD"],
  factoryProducts = ["Gold", "Battle Record", "Originium Shard"],
  durations = [12, 12],
  lines,
  drones,
}: {
  tradeLevels?: number[];
  tradeProducts?: string[];
  factoryProducts?: string[];
  durations?: number[];
  lines: RotationRoomLine[][];
  drones?: MaaJson["plans"][number]["drones"][];
}): { layout: BaseBlueprint; maa: MaaJson; rotation: RotationJson } {
  const layout: BaseBlueprint = {
    template: "test",
    drone_cap: 200,
    scenario: {},
    rooms: [
      ...tradeLevels.map((level, index) => ({ id: `trade_${index + 1}`, kind: "trade_post" as const, level, product: { trade: { order: "gold" as const } } })),
      ...factoryProducts.map((product, index) => ({
        id: `manu_${index + 1}`,
        kind: "factory" as const,
        level: 3,
        product: { factory: { recipe: product === "Battle Record" ? "battle_record" as const : product === "Originium Shard" ? "originium" as const : "gold" as const } },
      })),
      { id: "power_1", kind: "power_plant", level: 3 },
      { id: "power_2", kind: "power_plant", level: 3 },
    ],
  };
  const maa: MaaJson = {
    title: "test",
    plans: durations.map((_, index) => ({
      name: `shift ${index + 1}`,
      rooms: {
        trading: tradeProducts.map((product) => ({ product, operators: [] })),
        manufacture: factoryProducts.map((product) => ({ product, operators: [] })),
      },
      ...(drones?.[index] ? { drones: drones[index] } : {}),
    })),
  };
  const rotation: RotationJson = {
    profile: "main_backup_12_12",
    shifts: durations.map((duration, index) => ({
      index,
      duration_hours: duration,
      active_teams: [],
      resting_team: "",
      scores: { trade_score: 0, manu_prod_sum: 0, power_charge_sum: 0, room_lines: lines[index] ?? [] },
      weighted_trade: 0,
      weighted_manu: 0,
      weighted_power: 0,
    })),
    daily: { trade: null, manufacture: null, power: null },
  };
  return { layout, maa, rotation };
}

const completeLines = (trade = [1, 1, 1], manufacture = [2, 2, 2]): RotationRoomLine[] => [
  ...trade.map((score, index) => ({ room_id: `trade_${index + 1}`, final_efficiency: score, trade_score: score, trade_pct: (score - 1) * 100 })),
  ...manufacture.map((score, index) => ({ room_id: `manu_${index + 1}`, final_efficiency: score, manu_score: score * 100 })),
  { room_id: "power_1", final_efficiency: 1.2, power_charge_speed_pct: 20 },
  { room_id: "power_2", final_efficiency: 1.1, power_charge_speed_pct: 10 },
];

test("weights natural room final efficiencies, recipes, and shifts at full precision", () => {
  const input = fixture({
    durations: [8, 16],
    lines: [completeLines([1, 1.5, 2], [1.8, 2, 2.2]), completeLines([2, 1, 0.5], [2.2, 1.5, 2])],
  });
  const result = estimateDailyProduction(input);

  const expectedLmd = (10_000 * 1 + 10_141 * 1.5 + 10_265 * 2) / 3
    + (10_000 * 2 + 10_141 * 1 + 10_265 * 0.5) * 2 / 3;
  assert.ok(Math.abs(result.lmdOrders.value! - expectedLmd) < 0.000_001);
  assert.equal(result.gold.value, 10_000 * 1.8 / 3 + 10_000 * 2.2 * 2 / 3);
  assert.equal(result.experience.value, 8_000 * 2 / 3 + 8_000 * 1.5 * 2 / 3);
  assert.equal(result.shards.value, 24 * 2.2 / 3 + 24 * 2 * 2 / 3);
  assert.equal(result.orundum.manufactureCapacity, result.shards.value! * 10);
  assert.equal(result.orundum.tradeCapacity, 0);
  assert.equal(result.orundum.value, 0);
  assert.equal(result.orundum.bottleneck, "trade");
});

test("uses final efficiency for natural trade output", () => {
  const lines = completeLines([3, 1, 1]);
  lines[0] = { room_id: "trade_1", final_efficiency: 3, trade_score: 99, trade_pct: 100, trade_gold_pct: 50 };
  const result = estimateDailyProduction(fixture({ durations: [24], lines: [lines] }));

  assert.equal(result.lmdOrders.natural, 10_000 * 3 + 10_141 + 10_265);
  assert.equal(result.lmdOrders.droneTrade, 0);
});

test("uses only final_efficiency for natural output when legacy fields conflict", () => {
  const lines = completeLines([2, 1, 1], [1.5, 2, 2]);
  Object.assign(lines[0], { trade_score: 99, trade_pct: 9_800, trade_gold_pct: 400 });
  Object.assign(lines[3], { manu_score: 999, manu_prod_total: 899 });
  Object.assign(lines[6], { power_score: 999, power_charge_speed_pct: 899 });
  const result = estimateDailyProduction(fixture({ durations: [24], lines: [lines] }));

  assert.equal(result.lmdOrders.natural, 10_000 * 2 + 10_141 + 10_265);
  assert.equal(result.lmdOrders.droneTrade, 0);
  assert.equal(result.gold.natural, 10_000 * 1.5);
});

test("does not attribute selected drone targets to daily estimates", () => {
  const baseLines = completeLines();
  const drone = (room: "trading" | "manufacture", index: number) => ({ enable: true, room, index, order: "pre" as const });
  const result = estimateDailyProduction(fixture({
    tradeProducts: ["Orundum", "LMD", "LMD"],
    durations: [6, 6, 6, 6],
    lines: [baseLines, baseLines, baseLines, baseLines],
    drones: [drone("manufacture", 1), drone("manufacture", 2), drone("manufacture", 3), drone("trading", 1)],
  }));

  assert.equal(result.lmdOrders.droneTrade, 0);
  assert.equal(result.gold.drones, 0);
  assert.equal(result.experience.drones, 0);
  assert.equal(result.shards.drones, 0);
  assert.equal(result.orundum.manufactureDrones, 0);
  assert.equal(result.orundum.tradeDrones, 0);
});

test("uses the smaller originium stage and handles zero production lines", () => {
  const input = fixture({
    tradeLevels: [3],
    tradeProducts: ["Orundum"],
    factoryProducts: ["Originium Shard"],
    durations: [24],
    lines: [[
      { room_id: "trade_1", final_efficiency: 2 },
      { room_id: "manu_1", final_efficiency: 1.5 },
      { room_id: "power_1", final_efficiency: 1 },
      { room_id: "power_2", final_efficiency: 1 },
    ]],
  });
  const result = estimateDailyProduction(input);
  assert.equal(result.shards.value, 36);
  assert.equal(result.orundum.manufactureCapacity, 360);
  assert.equal(result.orundum.tradeCapacity, 480);
  assert.equal(result.orundum.value, 360);
  assert.equal(result.orundum.bottleneck, "manufacture");
  assert.equal(result.lmdOrders.value, 0);
  assert.equal(result.gold.value, 0);
  assert.equal(result.experience.value, 0);
});

test("marks only affected products unavailable for missing room data and recipe all", () => {
  const missing = fixture({ durations: [24], lines: [[
    { room_id: "trade_1", final_efficiency: 1 },
    { room_id: "trade_2", final_efficiency: 1 },
    { room_id: "trade_3", final_efficiency: 1 },
    { room_id: "manu_1", final_efficiency: 2 },
    { room_id: "manu_3", final_efficiency: 2 },
  ]] });
  assert.equal(estimateDailyProduction(missing).experience.unavailableReason, "missing-room-data");

  const ambiguous = fixture({ durations: [24], lines: [completeLines()] });
  ambiguous.maa.plans[0].rooms.manufacture![1].product = "all";
  const result = estimateDailyProduction(ambiguous);
  assert.equal(result.experience.value, null);
  assert.equal(result.experience.unavailableReason, "ambiguous-recipe");
  assert.equal(result.gold.value, null);
  assert.equal(result.orundum.value, null);
});

test("does not require power data for natural production estimates", () => {
  const lines = completeLines();
  lines.splice(lines.findIndex((line) => line.room_id === "power_2"), 1);
  const result = estimateDailyProduction(fixture({ durations: [24], lines: [lines] }));
  assert.equal(result.experience.unavailableReason, undefined);
  assert.equal(result.experience.value, 16_000);
  assert.equal(result.lmdOrders.value !== null, true);
});

test("normalizes 36-hour rotation cycles back to daily production", () => {
  const lines: RotationRoomLine[] = [
    { room_id: "trade_1", final_efficiency: 1 },
    { room_id: "manu_1", final_efficiency: 1 },
    { room_id: "power_1", final_efficiency: 1 },
    { room_id: "power_2", final_efficiency: 1 },
  ];
  const input = fixture({
    tradeLevels: [3],
    tradeProducts: ["LMD"],
    factoryProducts: ["Gold"],
    durations: [12, 12, 12],
    lines: [lines, lines, lines],
  });
  const result = estimateDailyProduction(input);
  // 36h 周期（3×12h）折算 24h 每日产量：满效率下应等于基础每日值（10,265 / 10,000），而不是 1.5 倍。
  assert.ok(Math.abs(result.lmdOrders.value! - 10_265) < 1e-6);
  assert.ok(Math.abs(result.gold.value! - 10_000) < 1e-6);
});
