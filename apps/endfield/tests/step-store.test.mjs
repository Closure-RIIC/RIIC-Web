import assert from "node:assert/strict";
import test from "node:test";
import { applyStored, DEFAULT_STEP_CONTROLS, loadStepConfig, saveStepConfig, toStored } from "../src/step/step-store.ts";

const config = () => ({
  rooms: [{ key: "中枢", enabled: true, hour: 12, crewA: ["A"], crewB: ["B"], single: false }],
  moods: {}, work: {}, boost: { dailyCount: 0, currentDay: 0, days: [{ list: [] }] },
});
const load = value => loadStepConfig({ getItem: () => JSON.stringify(value) });

test("legacy settings retain morale and assistance without overriding the manual schedule", () => {
  const stored = load({ version: 1, rooms: { 中枢: { enabled: false, hour: 22, crewA: ["old"] } },
    moods: { A: 75 }, work: { A: false },
    boost: { dailyCount: 1, currentDay: 0, days: [{ list: [{ hour: 13, minute: 30, target: "A" }] }] },
  });
  const manual = config();
  const result = applyStored(manual, stored);
  assert.deepEqual(result.rooms, manual.rooms);
  assert.equal(result.moods.A, 75);
  assert.equal(result.work.A, false);
  assert.equal(result.boost.days[0].list[0].target, "A");
  assert.equal(stored.version, 2);
  assert.deepEqual(stored.controls, DEFAULT_STEP_CONTROLS);
  assert.equal("rooms" in stored, false);
  assert.deepEqual(manual.moods, {}, "restoring preferences does not mutate the source");
});

test("v2 round-trips simulation parameters and never persists schedule fields", () => {
  const controls = { startHour: 3, maxHours: 72, sampleSec: 30, speed: 1000 };
  const value = toStored({ ...config(), moods: { A: 50 }, work: { B: false } }, controls);
  let raw;
  saveStepConfig(value, { setItem: (_key, next) => { raw = next; } });
  const saved = loadStepConfig({ getItem: () => raw });
  assert.deepEqual(saved, value);
  assert.deepEqual(saved.controls, controls);
  assert.equal("rooms" in saved, false);
  const changed = config();
  changed.rooms[0] = { ...changed.rooms[0], hour: 17, crewA: ["C"] };
  assert.deepEqual(applyStored(changed, saved).rooms, changed.rooms);
});

test("invalid persisted controls and morale are bounded or replaced with defaults", () => {
  const saved = load({ version: 2, controls: { startHour: 99, maxHours: 100000, sampleSec: 0, speed: -1 },
    moods: { A: -10, B: 400, invalid: "50" }, work: { A: false, invalid: 1 } });
  assert.deepEqual(saved.controls, { ...DEFAULT_STEP_CONTROLS, startHour: 23 });
  assert.deepEqual(saved.moods, { A: 0, B: 100 });
  assert.deepEqual(saved.work, { A: false });
  assert.equal(load({ version: 2, controls: { startHour: -5 } }).controls.startHour, 0);
  assert.equal(load({ version: 2, controls: { startHour: "2" } }).controls.startHour, 0);
  assert.equal(load({ version: 99 }), null);
  assert.equal(loadStepConfig({ getItem: () => "broken json" }), null);
  assert.equal(loadStepConfig({ getItem: () => { throw new Error("blocked"); } }), null);
});
