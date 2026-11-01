import assert from "node:assert/strict";
import test from "node:test";

import type { BaseBlueprint, OperBoxEntry } from "@riic/arknights-domain/types";
import { stablePlanCacheHmac, type StablePlanCacheKeyInput } from "./plan-cache-key.ts";
import { normalizeSolverOperbox } from "./plan-solver-input.ts";
import catalog from "@riic/arknights-domain/generated/arkntools/operator-catalog.json" with { type: "json" };

const key = Buffer.alloc(32, 3);
const layout = {
  template: "243",
  drone_cap: 0,
  scenario: {},
  rooms: [{ id: "room_1", kind: "control_center", level: 5 }],
} as BaseBlueprint;
const operbox = [{ id: "char_1", name: "能天使", own: true, elite: 2, level: 90, potential: 1, rarity: 6 }] as OperBoxEntry[];
const base: StablePlanCacheKeyInput = {
  layout,
  operbox,
  sourceType: "maa",
  sourceName: "box.json",
  rotation: "abc_12_6_6",
  fiammettaEnable: false,
  solverExecutableSha256: "a".repeat(64),
  protocolVersion: 1,
  planSchemaVersion: 3,
};

test("plan cache key is canonical and stable across object key order", () => {
  const reordered = { ...base, layout: { rooms: layout.rooms, scenario: {}, drone_cap: 0, template: "243" } as BaseBlueprint };
  assert.equal(stablePlanCacheHmac(key, base), stablePlanCacheHmac(key, reordered));
});

test("every solver or planning input dimension invalidates the shared cache key", () => {
  const original = stablePlanCacheHmac(key, base);
  const variants: StablePlanCacheKeyInput[] = [
    { ...base, layout: { ...layout, drone_cap: 1 } },
    { ...base, operbox: [{ ...operbox[0], level: 89 }] },
    { ...base, sourceName: "other.json" },
    { ...base, sourceType: "skland" },
    { ...base, rotation: "abc_12_12_12" },
    { ...base, fiammettaEnable: true },
    { ...base, solverExecutableSha256: "b".repeat(64) },
    { ...base, protocolVersion: 2 },
    { ...base, planSchemaVersion: 4 },
  ];
  for (const variant of variants) assert.notEqual(stablePlanCacheHmac(key, variant), original);
});

test("solver-effective input removes unowned, duplicate, and unsupported Amiya variants deterministically", () => {
  const entries = [
    ...operbox,
    { ...operbox[0], id: "duplicate" },
    { ...operbox[0], id: "unowned", name: "银灰", own: false },
    { ...operbox[0], id: "amiya", name: "阿米娅（近卫）" },
  ] as OperBoxEntry[];
  assert.deepEqual(normalizeSolverOperbox(entries), operbox);
});

test("new web operators remain owned in the roster but are omitted from solver input and cache identity", () => {
  const names = ["镜匠", "行铃", "冻河", "奥尔佳", "国度", "塔露拉"];
  const added = names.map((name) => {
    const operator = catalog.find((entry) => entry.name === name);
    assert.ok(operator, name);
    return { ...operbox[0]!, id: operator.id, name };
  });
  const entries = [...operbox, ...added];
  const before = structuredClone(entries);
  const normalized = normalizeSolverOperbox(entries);
  assert.deepEqual(normalized, operbox);
  assert.deepEqual(entries, before);
  assert.ok(added.every((entry) => entry.own));
  assert.equal(stablePlanCacheHmac(key, { ...base, operbox: normalized }), stablePlanCacheHmac(key, base));
  assert.deepEqual(normalizeSolverOperbox(added.map((entry) => ({ ...entry, name: "localized name" }))), []);
  assert.deepEqual(normalizeSolverOperbox(added.map((entry) => ({ ...entry, id: entry.id.replace(/^char_/, ""), name: "localized name" }))), []);
  assert.deepEqual(normalizeSolverOperbox(added.map((entry) => ({ ...entry, id: "legacy-id", name: ` ${entry.name} ` }))), []);
});
