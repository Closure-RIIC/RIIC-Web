import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_OPTIONS, validateOptions } from "@riic/endfield-solver/model.mjs";
import { completeMissingFacilities, movePriority, withFacilityLevels } from "../src/scheduling-options.ts";

test("facility completion fills missing rooms without upgrading owned rooms or altering production choices", () => {
  const options = { ...structuredClone(DEFAULT_OPTIONS), mfg: "2武器", levels: { center: 2, mfg1: 1, mfg2: 0, grow: 0, guest: 0 } };
  const before = structuredClone(options);
  const completed = completeMissingFacilities(options);
  assert.deepEqual(completed.levels, { center: 2, mfg1: 1, mfg2: 3, grow: 3, guest: 3 });
  assert.equal(completed.mfg, options.mfg);
  assert.deepEqual(completed.grow, options.grow);
  assert.deepEqual(options, before);
  assert.equal(completeMissingFacilities(completed), completed);
});

test("facility sync preserves production choices and budgets while respecting new capacity", () => {
  const options = { ...structuredClone(DEFAULT_OPTIONS), mfg: "2武器", grow: { 晶植: 2, 菌类: 4, 矿物: 3 }, time: 15000 };
  const before = structuredClone(options);
  const levels = { center: 3, mfg1: 2, mfg2: 1, grow: 1, guest: 1 };
  const synced = withFacilityLevels(options, levels);
  assert.deepEqual(synced.levels, levels);
  assert.deepEqual(synced.grow, { 晶植: 2, 菌类: 1, 矿物: 0 });
  assert.equal(synced.mfg, "2武器");
  assert.equal(synced.time, 15000);
  assert.deepEqual(synced.priority, options.priority);
  assert.deepEqual(options, before);
  assert.doesNotThrow(() => validateOptions(synced));
});

test("facility sync neither invents production for new capacity nor changes an identical setup", () => {
  const options = { ...structuredClone(DEFAULT_OPTIONS), grow: { 晶植: 1, 菌类: 0, 矿物: 0 } };
  assert.equal(withFacilityLevels(options, { ...options.levels }), options);
  const smaller = withFacilityLevels(options, { center: 1, mfg1: 1, mfg2: 1, grow: 0, guest: 0 });
  assert.deepEqual(smaller.grow, { 晶植: 0, 菌类: 0, 矿物: 0 });
  const larger = withFacilityLevels(smaller, options.levels);
  assert.deepEqual(larger.grow, smaller.grow);
  assert.doesNotThrow(() => validateOptions(larger));
});

test("priority reordering moves to either end without duplicating or mutating categories", () => {
  const priority = [...DEFAULT_OPTIONS.priority];
  const first = movePriority(priority, priority[3], priority[0]);
  assert.deepEqual(first, [priority[3], ...priority.slice(0, 3)]);
  assert.deepEqual(movePriority(first, priority[3], priority[2]), priority);
  assert.deepEqual(priority, DEFAULT_OPTIONS.priority);
  assert.equal(movePriority(priority, "unknown", priority[0]), priority);
  assert.equal(movePriority(priority, priority[0], priority[0]), priority);
});
