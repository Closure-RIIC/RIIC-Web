import assert from "node:assert/strict";
import test from "node:test";

import { deriveSklandBuildingMetrics, sklandTradingOrderRewardLabel } from "./skland-status-metrics.ts";
import type { SklandStatusSnapshot, SklandTradingOrder } from "./types.ts";

function snapshot(): SklandStatusSnapshot {
  const now = Date.parse("2026-08-02T00:00:00+08:00") / 1000;
  return {
    player: {
      uid: "1",
      nickname: "博士",
      level: 120,
      channelName: "官服",
      avatarUrl: null,
      registerTs: null,
      mainStageProgress: null,
      resume: null,
      subscriptionEnd: null,
      storeTs: now,
      lastOnlineTs: now,
      sanity: null,
      secretary: null,
      counts: { operators: 1, furniture: 1, skins: 1 },
    },
    roles: [],
    operbox: [],
    infrastructure: {
      currentTs: now,
      storeTs: now,
      layoutLabel: null,
      layoutSuggestion: null,
      layoutWarning: null,
      rooms: [
        {
          key: "trade",
          group: "trading",
          index: 0,
          level: 3,
          operators: [],
          product: "gold",
          production: { stock: 2, capacity: 20, unitCapacity: null, completed: null, remaining: null, completeWorkTime: null },
          orders: [],
          lastUpdateTime: now,
        },
        {
          key: "factory",
          group: "manufacture",
          index: 0,
          level: 3,
          operators: [],
          product: "gold",
          production: { stock: 4, capacity: 24, unitCapacity: 12, completed: 3, remaining: 99, completeWorkTime: null },
          speed: 1,
          lastUpdateTime: now,
        },
        {
          key: "dorm",
          group: "dormitory",
          index: 0,
          level: 5,
          comfort: 5_000,
          operators: [
            { id: "a", name: "甲", morale: 24, workTime: 0, lastMoraleUpdateTs: now },
            { id: "b", name: "乙", morale: 20, workTime: 0, lastMoraleUpdateTs: now },
          ],
        },
        {
          key: "meeting",
          group: "meeting",
          index: 0,
          level: 3,
          operators: [],
          clue: { board: ["1", "2"], own: 0, received: 0, dailyReward: false, needReceive: 0, sharing: true, shareCompleteTime: now + 600 },
          completeWorkTime: now + 600,
          lastUpdateTime: now,
        },
      ],
      tiredOperators: [],
      labor: { value: 100, maxValue: 200, remainSecs: 300, lastUpdateTime: now },
      furnitureTotal: 1,
      training: null,
    },
    operators: [],
    skins: [],
    progress: {
      recruit: null,
      routine: null,
      campaign: null,
      tower: null,
      rogue: null,
      activities: null,
      bossRush: null,
    },
    sourceName: "森空岛同步",
    warnings: [],
  };
}

test("derives only the four requested base metrics", () => {
  const value = snapshot();
  const metrics = deriveSklandBuildingMetrics(value, value.infrastructure.currentTs);
  assert.deepEqual(metrics.map((metric) => metric.id), ["rest", "trading", "manufacture", "clue"]);
  assert.deepEqual(metrics.map((metric) => [metric.value, metric.total]), [
    ["1", "2"],
    ["2", "20"],
    ["3", "12"],
    ["交流中", null],
  ]);
});

test("preserves missing manufacture formula capacity", () => {
  const value = snapshot();
  const manufacture = value.infrastructure.rooms.find((room) => room.group === "manufacture");
  if (!manufacture || manufacture.group !== "manufacture") assert.fail("manufacture fixture missing");
  manufacture.production.unitCapacity = null;
  const metrics = deriveSklandBuildingMetrics(value, value.infrastructure.currentTs);
  assert.equal(metrics.find((metric) => metric.id === "manufacture")?.total, "—");
});

test("labels originium-shard orders as orundum even when a cached reward type is stale", () => {
  const shardOrder: SklandTradingOrder = {
    delivery: [{ type: "originium_shard", count: 2 }],
    reward: { type: "lmd", count: 20 },
  };
  const lmdOrder: SklandTradingOrder = {
    delivery: [{ type: "material", count: 3 }],
    reward: { type: "lmd", count: 1_500 },
  };
  assert.equal(sklandTradingOrderRewardLabel(shardOrder), "合成玉");
  assert.equal(sklandTradingOrderRewardLabel(shardOrder, true), "Orundum");
  assert.equal(sklandTradingOrderRewardLabel(lmdOrder), "龙门币");
  assert.equal(sklandTradingOrderRewardLabel(lmdOrder, true), "LMD");
});

test("renders Skland building metrics in English", () => {
  const value = snapshot();
  const metrics = deriveSklandBuildingMetrics(value, value.infrastructure.currentTs, true);
  assert.deepEqual(metrics.map((metric) => metric.label), [
    "Rest progress",
    "Order progress",
    "Manufacturing progress",
    "Clue collection",
  ]);
  assert.equal(metrics.find((metric) => metric.id === "clue")?.value, "Sharing");
  assert.match(metrics.find((metric) => metric.id === "clue")?.hint ?? "", /^Sharing ends in /);
});
