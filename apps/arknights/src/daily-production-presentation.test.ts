import assert from "node:assert/strict";
import test from "node:test";

import { dailyProductionGroups, dailyProductionValueBreakdown } from "./daily-production-presentation.ts";
import "./i18n/test-setup.ts";
import { createAgentDailyProduction, readAgentDailyProduction } from "./agent-plan-production.ts";
import { createCalculatorProductionPresentation } from "./production-summary-adapters.ts";
import { withOriginiumLmdCost } from "./originium-lmd-cost.ts";
import type { BaseBlueprint, MaaJson, RotationJson } from "@riic/arknights-domain/types";

test("solver daily production drives the same summary amount and detail row", () => {
  const groups = dailyProductionGroups(null, {
    lmd: 34_254,
    pure_gold: 52_999,
    battle_records: 22_400,
    originium_shards: 48,
    orundum: 360,
  });
  assert.equal(groups.every((group) => group.source === "solver"), true);
  assert.equal(groups[0].primary.amount.value, 22_400);
  assert.deepEqual(groups[0].primary.rows, [["估算自然制造", 22_400, "经验"], ["估算无人机", 0, "经验"], ["总产出", 22_400, "经验"]]);
  assert.equal(groups[1].primary.amount.value, 34_254);
  assert.deepEqual(groups[1].primary.rows, [["估算自然订单", 34_254, "龙门币"], ["估算无人机订单", 0, "龙门币"], ["总产出", 34_254, "龙门币"]]);
  assert.equal(groups[2].primary.amount.value, 360);
  assert.deepEqual(groups[2].primary.rows, [["求解器日产量", 360, "合成玉"]]);
  for (const group of groups) {
    for (const product of [group.primary, group.supporting].filter((value) => value !== undefined)) {
      assert.equal(product.rows.at(-1)?.[1], product.amount.value, `${product.id} detail must match its summary`);
    }
  }
});

test("pure gold keeps full precision until the shared display rounding step", () => {
  const groups = dailyProductionGroups(null, {
    lmd: 0,
    pure_gold: 999,
    battle_records: 0,
    originium_shards: 0,
    orundum: 0,
  });
  assert.equal(groups[1].supporting?.amount.value, 11);
  assert.deepEqual(groups[1].supporting?.rows, [["估算自然制造", 1, "枚"], ["估算等效赤金", 0, "枚"], ["估算无人机制造", 0, "枚"], ["日常获取", 10, "枚"], ["总产出", 11, "枚"]]);
});

test("equivalent gold is included in the total gold amount and remains a separate detail row", () => {
  const groups = dailyProductionGroups(null, {
    lmd: 0,
    pure_gold: 500,
    equivalent_gold: 999,
    battle_records: 0,
    originium_shards: 0,
    orundum: 0,
  });
  assert.equal(groups[1].supporting?.amount.value, 12);
  assert.deepEqual(groups[1].supporting?.rows, [
    ["估算自然制造", 1, "枚"],
    ["估算等效赤金", 1, "枚"],
    ["估算无人机制造", 0, "枚"],
    ["日常获取", 10, "枚"],
    ["总产出", 12, "枚"],
  ]);
});

test("solver totals stay authoritative while estimate rows split natural and drone production", () => {
  const groups = dailyProductionGroups({
    experience: { value: 21_000, natural: 15_000, drones: 6_000 },
    lmdOrders: { value: 31_000, natural: 20_000, drones: 11_000, droneTrade: 11_000 },
    gold: { value: 82, natural: 60, drones: 22 },
    shards: { value: 44, natural: 32, drones: 12 },
    orundum: {
      value: 300,
      natural: 240,
      drones: 60,
      manufactureCapacity: 360,
      tradeCapacity: 300,
      manufactureDrones: 120,
      tradeDrones: 60,
      bottleneck: "trade",
    },
  }, {
    lmd: 34_254,
    pure_gold: 52_999,
    battle_records: 22_400,
    originium_shards: 48,
    orundum: 360,
  }, { lmd: 11_000, pure_gold: 22_000, battle_records: 6_000 });

  assert.equal(groups.every((group) => group.source === "solver"), true);
  assert.equal(groups[0].primary.amount.value, 28_400);
  assert.deepEqual(groups[0].primary.rows, [["估算自然制造", 22_400, "经验"], ["估算无人机", 6_000, "经验"], ["总产出", 28_400, "经验"]]);
  assert.equal(groups[0].primary.note, undefined);
  assert.equal(groups[1].primary.amount.value, 45_254);
  assert.equal(groups[1].supporting?.amount.value, Math.floor((52_999 + 22_000 + 5_000) / 500));
  assert.equal(groups[2].primary.amount.value, 360);
  assert.equal(groups[2].primary.note, "限制环节：合成玉订单");
  assert.equal(groups[2].supporting?.amount.value, 48);
});

test("production presentation stays empty only when neither source is available", () => {
  assert.deepEqual(dailyProductionGroups(null, null), []);
});

test("poster values reconcile with the shared summary without adding gold equivalents to orders twice", () => {
  const production = { lmd: 34_254.5, pure_gold: 52_999.25, equivalent_gold: 2_328.77, battle_records: 22_400, originium_shards: 48, orundum: 360 };
  const drones = { lmd: 5_525.86, pure_gold: 1_010.1, battle_records: 800 };
  const values = dailyProductionValueBreakdown(production, drones);
  const groups = dailyProductionGroups(null, production, drones);
  assert.equal(values.lmd.total, 39_780.36);
  assert.equal(values.experience.total, 23_200);
  assert.equal(values.gold.external, 5_000);
  assert.ok(Math.abs(values.gold.total - 61_338.12) < .000001);
  assert.equal(values.gold.total, values.gold.natural + values.gold.equivalent + values.gold.external + values.gold.drones);
  assert.equal(groups[1].primary.amount.value, values.lmd.total);
  assert.equal(groups[1].supporting?.amount.value, Math.floor(values.gold.total / 500));
  assert.equal(groups[0].primary.amount.value, values.experience.total);
  assert.equal(groups[2].primary.amount.value, values.orundum.total);
});

test("missing drone fields mean zero increment and preserve the site's external gold allowance", () => {
  const values = dailyProductionValueBreakdown({ lmd: 10_000, pure_gold: 500, battle_records: 8_000, originium_shards: 0, orundum: 0 });
  assert.equal(values.lmd.total, 10_000);
  assert.equal(values.gold.total, 5_500);
  assert.equal(values.gold.drones, 0);
  assert.equal(values.gold.equivalent, 0);
});

function agentFixture(template: "153" | "252", goldFactories: number) {
  const factoryRecipes = Array.from({ length: 5 }, (_, index) => index < goldFactories ? "gold" as const : "battle_record" as const);
  const layout: BaseBlueprint = {
    template, drone_cap: 200, scenario: {},
    rooms: [
      ...Array.from({ length: Number(template[0]) }, (_, index) => ({ id: `trade_${index}`, kind: "trade_post" as const, level: 3, product: { trade: { order: "gold" as const } } })),
      ...factoryRecipes.map((recipe, index) => ({ id: `factory_${index}`, kind: "factory" as const, level: 3, product: { factory: { recipe } } })),
    ],
  };
  const maa: MaaJson = {
    title: template,
    plans: [0, 1, 2].map(index => ({
      name: `shift ${index + 1}`, duration: 12,
      rooms: {
        trading: Array.from({ length: Number(template[0]) }, () => ({ operators: [], product: "LMD" })),
        manufacture: factoryRecipes.map(recipe => ({ operators: [], product: recipe === "gold" ? "Gold" : "Battle Record" })),
      },
      drones: { enable: true, room: "manufacture", index: goldFactories + 1, order: "pre" },
    })),
  };
  const rotation: RotationJson = {
    profile: "abc_12_12_12",
    shifts: [0, 1, 2].map(index => ({
      index, duration_hours: 12, active_teams: [], resting_team: "",
      scores: { trade_score: 2.46, manu_prod_sum: 11.05, power_charge_sum: 1.63,
        room_lines: layout.rooms.map(room => ({ room_id: room.id, final_efficiency: 2 })) },
      weighted_trade: 0, weighted_manu: 0, weighted_power: 0,
    })),
    daily: { trade: 2.46, manufacture: 11.05, power: 1.63 },
  };
  return { layout, maa, rotation };
}

test("Agent final products match calculator display, including drones, equivalents and gold rounding", () => {
  const input = agentFixture("153", 1);
  input.rotation.daily.production = { lmd: 25_288.4, pure_gold: 25_499.2, equivalent_gold: 50.2, battle_records: 60_000, originium_shards: 0, orundum: 0 };
  input.rotation.daily.drone_production = { lmd: 0, pure_gold: 0, battle_records: 16_924.6 };
  const before = structuredClone(input);
  const actual = createAgentDailyProduction(input);
  const webpage = withOriginiumLmdCost(createCalculatorProductionPresentation(input).groups, "orirock", "zh-CN")
    .flatMap(group => [group.primary, ...(group.supporting ? [group.supporting] : [])]);
  for (const product of actual.products) {
    const shown = webpage.find(item => item.id === product.id)!;
    assert.equal(product.value, shown.amount.value === null ? null : Math.round(shown.amount.value), product.id);
  }
  assert.deepEqual(actual.products.map(product => product.value), [76_925, 25_288, 61, 0, 0]);
  assert.equal(actual.basis, "daily_24h");
  assert.equal(actual.includesDrones, true);
  assert.equal(actual.droneAllocations.length, 3);
  assert.deepEqual(actual.droneAllocations[0], { shift: 1, durationHours: 12, room: "manufacture", index: 2 });
  assert.deepEqual(input, before, "projection cannot mutate natural production or the handoff result");
  assert.deepEqual(readAgentDailyProduction(JSON.parse(JSON.stringify(actual))), actual);
});

test("Agent recipe comparison changes gold and experience despite identical aggregate efficiencies and a 36h cycle", () => {
  const twoGold = agentFixture("252", 2);
  const threeGold = agentFixture("252", 3);
  const values = (input: ReturnType<typeof agentFixture>) => Object.fromEntries(createAgentDailyProduction(input).products.map(product => [product.id, product.value]));
  assert.deepEqual(twoGold.rotation.daily, threeGold.rotation.daily);
  assert.deepEqual(values(twoGold), { experience: 48_000, "lmd-orders": 41_060, gold: 80, orundum: 0, shards: 0 });
  assert.deepEqual(values(threeGold), { experience: 32_000, "lmd-orders": 41_060, gold: 120, orundum: 0, shards: 0 });
  twoGold.rotation.daily.drone_production = { lmd: 500, pure_gold: 999, battle_records: 800 };
  assert.deepEqual(values(twoGold), { experience: 48_800, "lmd-orders": 41_560, gold: 81, orundum: 0, shards: 0 });
});

test("Agent Orundum output uses the same recipe costs and negative net LMD as the calculator", () => {
  const input = agentFixture("252", 2);
  input.rotation.daily.production = { lmd: 34_254.5, pure_gold: 999, equivalent_gold: 501, battle_records: 0, originium_shards: 24.5, orundum: 120 };
  input.rotation.daily.drone_production = { lmd: 500, pure_gold: 0, battle_records: 0 };
  for (const shardRecipe of ["orirock", "device"] as const) {
    const actual = createAgentDailyProduction({ ...input, shardRecipe });
    const webpage = withOriginiumLmdCost(createCalculatorProductionPresentation(input).groups, shardRecipe, "zh-CN");
    const lmd = actual.products.find(product => product.id === "lmd-orders")!;
    assert.equal(lmd.net, true);
    assert.equal(lmd.value, Math.round(webpage[1].primary.amount.value!));
    assert.equal(lmd.value, shardRecipe === "orirock" ? -4_445 : 10_255);
    assert.equal(actual.products.find(product => product.id === "orundum")?.value, 120);
    assert.equal(actual.products.find(product => product.id === "shards")?.value, 25);
  }
});

test("Agent unknown products and historical efficiency payloads are never reported as zero production", () => {
  const input = agentFixture("153", 1);
  input.rotation.shifts.forEach(shift => { shift.scores.room_lines = []; });
  const actual = createAgentDailyProduction(input);
  assert.equal(actual.products.find(product => product.id === "experience")?.value, null);
  assert.equal(actual.products.find(product => product.id === "lmd-orders")?.value, null);
  assert.equal(actual.products.find(product => product.id === "gold")?.value, null);
  assert.equal(actual.products.find(product => product.id === "orundum")?.value, 0);
  for (const legacy of [undefined, null, {}, { daily_trade_efficiency: 2.46, daily_manufacture_efficiency: 11.05 }, { ...actual, schemaVersion: 2 }]) {
    assert.equal(readAgentDailyProduction(legacy), null);
  }
  const invalid = structuredClone(actual);
  invalid.products[0].value = Number.NaN;
  assert.equal(readAgentDailyProduction(invalid), null);
  invalid.products[0].value = null;
  invalid.products[1].id = invalid.products[0].id;
  assert.equal(readAgentDailyProduction(invalid), null);
});

test("Agent drone targets follow MAA pre-actions stored in the next plan", () => {
  const input = agentFixture("252", 2);
  input.maa.plans[0].drones = { enable: true, room: "trading", index: 2, order: "pre" };
  input.maa.plans[1].drones = { enable: true, room: "manufacture", index: 1, order: "pre" };
  input.maa.plans[2].drones = { enable: true, room: "trading", index: 1, order: "pre" };
  assert.deepEqual(createAgentDailyProduction(input).droneAllocations, [
    { shift: 1, durationHours: 12, room: "manufacture", index: 1 },
    { shift: 2, durationHours: 12, room: "trading", index: 1 },
    { shift: 3, durationHours: 12, room: "trading", index: 2 },
  ]);
});
