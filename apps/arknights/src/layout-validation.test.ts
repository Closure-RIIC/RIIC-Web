import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizeProductForLevel } from "@riic/arknights-domain/factory-recipes";
import { validateLayoutJson } from "@riic/arknights-domain/layout-validation";
import { manualEditableRooms } from "./recycling-room.ts";
import type { BaseBlueprint } from "@riic/arknights-domain/types";

function validLayout() {
  return {
    template: "243",
    drone_cap: 235,
    scenario: {},
    rooms: [
      { id: "control", kind: "control_center", level: 5 },
      { id: "trade_1", kind: "trade_post", level: 3, product: { trade: { order: "gold" } } },
      { id: "manu_1", kind: "factory", level: 3, product: { factory: { recipe: "battle_record" } } },
      { id: "power_1", kind: "power_plant", level: 3 },
      { id: "dorm_1", kind: "dormitory", level: 5, dorm_beds: 5 },
      { id: "training_room", kind: "training_room", level: 3 },
    ],
  };
}

test("accepts level-five facilities and the training room", () => {
  assert.deepEqual(validateLayoutJson(validLayout()), []);
});

test("accepts the plan.compute all factory recipe", () => {
  const layout = validLayout();
  layout.rooms[2].product = { factory: { recipe: "all" } };

  assert.deepEqual(validateLayoutJson(layout), []);
});

test("rejects values that the core u32 and facility schema cannot consume", () => {
  const layout = validLayout();
  layout.drone_cap = 1.5;
  layout.rooms[5].level = 4;

  const errors = validateLayoutJson(layout);
  assert.ok(errors.some((message) => message.includes("drone_cap")));
  assert.ok(errors.some((message) => message.includes("rooms[5].level")));
});

test("rejects unknown kinds, duplicate IDs, and padded IDs", () => {
  const layout = validLayout();
  layout.rooms.push(
    { id: "power_1", kind: "unknown", level: 1 },
    { id: " padded ", kind: "office", level: 3 }
  );

  const errors = validateLayoutJson(layout);
  assert.ok(errors.some((message) => message.includes("房间 ID 重复")));
  assert.ok(errors.some((message) => message.includes("kind 不受支持")));
  assert.ok(errors.some((message) => message.includes("首尾空格")));
});

test("every preset stays solver-compatible and adds exactly one recycling editor", () => {
  for (const preset of ["153", "243", "252", "333", "342"]) {
    const layout: BaseBlueprint = JSON.parse(readFileSync(new URL(`../../../packages/arknights-domain/src/layouts/${preset}.json`, import.meta.url), "utf8"));
    assert.deepEqual(validateLayoutJson(layout), [], preset);
    const rooms = manualEditableRooms(layout);
    assert.equal(new Set(rooms.map(room => room.id)).size, rooms.length, preset);
    assert.deepEqual(rooms.filter(room => room.id === "recycling_station"), [{ id: "recycling_station", kind: "recycling", level: 3 }]);
  }
});

test("342 preset keeps the intended power-safe room levels", () => {
  const layout = JSON.parse(readFileSync(new URL("../../../packages/arknights-domain/src/layouts/342.json", import.meta.url), "utf8"));
  const levels = Object.fromEntries(layout.rooms.map((room: { id: string; level: number }) => [room.id, room.level]));

  assert.equal(levels.trade_2, 2);
  assert.equal(levels.dorm_1, 2);
  assert.deepEqual(validateLayoutJson(layout), []);
});

test("allows unlocked originium shard production in level-one and level-two factories", () => {
  for (const level of [1, 2]) {
    const layout = validLayout();
    layout.rooms[2].level = level;
    layout.rooms[2].product = { factory: { recipe: "originium" } };
    layout.rooms.push({ id: "manu_2", kind: "factory", level: 3, product: { factory: { recipe: "gold" } } });
    assert.deepEqual(validateLayoutJson(layout), []);
  }
});

test("requires one level-three factory to unlock originium shard production", () => {
  const layout = validLayout();
  layout.rooms[2].level = 2;
  layout.rooms[2].product = { factory: { recipe: "originium" } };
  assert.ok(validateLayoutJson(layout).some((message) => message.includes("需至少一个 3 级制造站解锁源石碎片配方")));
});

test("rejects originium orders in level-one and level-two trading posts", () => {
  for (const level of [1, 2]) {
    const layout = validLayout();
    layout.rooms[1].level = level;
    layout.rooms[1].product = { trade: { order: "originium" } };
    assert.ok(validateLayoutJson(layout).some((message) => message.includes("仅 3 级贸易站可使用开采协力")));
  }
});

test("allows mining cooperation only in level-three trading posts", () => {
  const layout = validLayout();
  layout.rooms[1].product = { trade: { order: "originium" } };
  assert.deepEqual(validateLayoutJson(layout), []);
  assert.equal(normalizeProductForLevel(2, "originium"), "gold");
  assert.equal(normalizeProductForLevel(3, "originium"), "originium");
});
