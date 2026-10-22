import assert from "node:assert/strict";
import test from "node:test";

import { dailyProductionGroups, dailyProductionValueBreakdown } from "./daily-production-presentation.ts";

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
