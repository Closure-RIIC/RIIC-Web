import assert from "node:assert/strict";
import test from "node:test";

import { dailyProductionGroups } from "./daily-production-presentation.ts";
import { withOriginiumLmdCost } from "./originium-lmd-cost.ts";
import type { DailyProductionEstimate } from "./daily-production.ts";

test("daily LMD deducts manufacturing cost even when no shards can be traded", () => {
  const source = dailyProductionGroups(null, {
    lmd: 0, pure_gold: 0, battle_records: 0, originium_shards: 24, orundum: 0,
  });
  const actual = withOriginiumLmdCost(source, "orirock", false);
  const lmd = actual.find((group) => group.id === "lmd")!.primary;
  assert.equal(lmd.amount.value, -38_400);
  assert.equal(lmd.rows.at(-1)?.[1], -38_400);
  assert.equal(source.find((group) => group.id === "lmd")!.primary.amount.value, 0);
});

test("both recipes include drone order income and preserve fractional and negative net income", () => {
  const groups = dailyProductionGroups(null, {
    lmd: 34_254.5, pure_gold: 0, battle_records: 0, originium_shards: 24.5, orundum: 10,
  }, { lmd: 500, pure_gold: 0, battle_records: 0 });
  assert.equal(withOriginiumLmdCost(groups, "orirock", false)[1].primary.amount.value, -4_445.5);
  const device = withOriginiumLmdCost(groups, "device", true)[1].primary;
  assert.equal(device.amount.value, 10_254.5);
  assert.equal(device.label, "Net LMD");
  assert.equal(device.rows.at(-2)?.[1], -24_500);
  assert.equal(device.rows.at(-1)?.[1], device.amount.value);
  assert.equal(groups[1].primary.amount.value, 34_754.5);
});

test("legacy estimates charge manufactured shards rather than bottleneck-limited Orundum", () => {
  const amount = (value: number) => ({ value, natural: value, drones: 0 });
  const estimate: DailyProductionEstimate = {
    lmdOrders: { ...amount(10_000), droneTrade: 0 },
    gold: amount(0), experience: amount(0), shards: amount(24),
    orundum: { ...amount(0), manufactureCapacity: 240, tradeCapacity: 0, manufactureDrones: 0, tradeDrones: 0, bottleneck: "trade" },
  };
  const groups = dailyProductionGroups(estimate, null);
  assert.equal(withOriginiumLmdCost(groups, "orirock", false)[1].primary.amount.value, -28_400);
  const missing = { value: null, natural: null, drones: null, unavailableReason: "missing-room-data" as const };
  const unavailable = dailyProductionGroups({ ...estimate, shards: missing }, null);
  const net = withOriginiumLmdCost(unavailable, "orirock", false)[1].primary;
  assert.equal(net.amount.value, null);
  assert.equal(net.amount.unavailableReason, "missing-room-data");
  assert.equal(net.rows.at(-2)?.[1], null);
});

test("no shard manufacturing preserves existing production presentation", () => {
  const groups = dailyProductionGroups(null, {
    lmd: 10_000, pure_gold: 0, battle_records: 0, originium_shards: 0, orundum: 240,
  });
  assert.equal(withOriginiumLmdCost(groups, "orirock", false), groups);
  assert.deepEqual(withOriginiumLmdCost([], "device", false), []);
});
