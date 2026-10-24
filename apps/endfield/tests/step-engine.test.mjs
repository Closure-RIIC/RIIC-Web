import assert from "node:assert/strict";
import test from "node:test";
import { StepSimulation, formatClock, formatDuration } from "../src/step/step-engine.ts";

const RATES = { work: 0.072, rest: 0.12, head: 0.40, assist: 0.30 };
const NO_EFFECTS = () => ({ reduce: 0, restore: 0, effMap: {} });

function config(overrides = {}) {
  return {
    rooms: [{
      key: "会客室", label: "会客室", kind: "guest", slots: 1, hour: 12, single: true,
      products: ["线索"], enabled: true, crewA: ["A"], crewB: [null],
    }],
    moods: {},
    work: {},
    boost: { dailyCount: 0, currentDay: 0, days: [{ list: [] }] },
    ...overrides,
  };
}

const run = (value, resolver = NO_EFFECTS, options = {}) => {
  const simulation = new StepSimulation(value, resolver, RATES, { startHour: 0, maxHours: 24, sampleSec: 60, ...options });
  simulation.runToEnd();
  return simulation;
};

test("playback advances by elapsed time independently of chart sampling", () => {
  for (const sampleSec of [10, 60, 900]) {
    const simulation = new StepSimulation(config(), NO_EFFECTS, RATES, { startHour: 0, maxHours: 24, sampleSec });
    for (let tick = 0; tick < 10; tick++) simulation.advanceBy(0.1);
    assert.ok(Math.abs(simulation.view.tSec - 1) < 1e-6);
    simulation.advanceBy(3600 - simulation.view.tSec);
    assert.ok(Math.abs(simulation.view.ops[0].mood - 92.8) < 1e-6);
    simulation.advanceBy(86400);
    assert.equal(simulation.view.ended, true);
    assert.ok(Math.abs(simulation.view.output["会客室"] - run(config(), NO_EFFECTS, { sampleSec }).view.output["会客室"]) < 1e-6);
  }
});

test("timeline seeking replays shifts and assistance deterministically in both directions", () => {
  const value = config({
    moods: { A: 20 },
    boost: { dailyCount: 1, currentDay: 0, days: [{ list: [{ hour: 6, minute: 0, target: "A" }] }] },
  });
  value.rooms[0] = { ...value.rooms[0], single: false, crewB: ["B"] };
  const options = { startHour: 0, maxHours: 24, sampleSec: 60 };
  const replay = new StepSimulation(value, NO_EFFECTS, RATES, options);
  replay.runToEnd();
  for (const seconds of [7 * 3600, 3 * 3600, 13 * 3600, 0, 24 * 3600]) {
    replay.seekTo(seconds);
    const expected = new StepSimulation(value, NO_EFFECTS, RATES, options);
    expected.advanceBy(seconds);
    assert.deepEqual(replay.snapshot(), expected.snapshot());
  }
  replay.seekTo(-10);
  assert.equal(replay.view.tSec, 0);
  replay.seekTo(Infinity);
  assert.equal(replay.view.tSec, 0);
  replay.seekTo(1e9);
  assert.equal(replay.view.tSec, 86400);
});

test("display snapshots stay stable as the engine advances and clears its log", () => {
  const simulation = new StepSimulation(config(), NO_EFFECTS, RATES, { startHour: 0, maxHours: 24, sampleSec: 60 });
  const snapshot = simulation.snapshot();
  const saved = structuredClone(snapshot);
  simulation.runToEnd();
  simulation.clearLog();
  assert.deepEqual(snapshot, saved);
  assert.equal(simulation.snapshot().ended, true);
});

test("a 100% mood operator drains to zero in 100 / 7.2 hours", () => {
  const simulation = run(config());
  const zero = simulation.view.log.find(entry => entry.type === "mood-zero");
  assert.ok(zero, "must log the mood-zero event");
  assert.ok(Math.abs(zero.tSec - 50_000) <= 2, `expected 50000s, got ${zero.tSec}`);
  assert.equal(simulation.view.ended, true);
});

test("morale consumption reduction stretches the working window", () => {
  const resolver = () => ({ reduce: 50, restore: 0, effMap: {} });
  const simulation = run(config(), resolver, { maxHours: 48 });
  const zero = simulation.view.log.find(entry => entry.type === "mood-zero");
  assert.ok(zero, "must log the mood-zero event");
  assert.ok(Math.abs(zero.tSec - 100_000) <= 2, `expected 100000s, got ${zero.tSec}`);
});

test("two-shift rooms switch crews at the configured hour", () => {
  const simulation = run(config({
    rooms: [{
      key: "制造舱1", label: "制造舱 Ⅰ", kind: "mfg", slots: 2, hour: 12, single: false,
      products: ["干员经验"], enabled: true, crewA: ["A", "B"], crewB: ["C", "D"],
    }],
  }), name => ({ reduce: 0, restore: 0, effMap: { 干员经验: name === "A" || name === "B" ? 30 : 20 } }));
  const room = simulation.view.rooms["制造舱1"];
  assert.equal(room.shiftEnabled, true);
  const switching = simulation.view.log.filter(entry => entry.type === "switch");
  assert.ok(switching.length >= 1);
  assert.ok(Math.abs(switching[0].tSec - 43_200) <= 2);
  const sample = simulation.view.history.find(item => item.tSec >= 43_200);
  assert.equal(sample.activeRounds["制造舱1"], "round2", "the B shift must be active after the changeover");
  const during = simulation.view.history.find(item => item.tSec >= 43_200 && item.tSec < 86_400);
  assert.equal(during.workings.C, true, "shift B joins at the changeover");
  assert.ok(simulation.view.output["制造舱1"] > 0, "shift A produced before the switch");
});

test("an empty manual B shift still ends A at the configured hour", () => {
  const value = config();
  value.rooms[0].single = false;
  const simulation = new StepSimulation(value, NO_EFFECTS, RATES, { startHour: 8, maxHours: 24, sampleSec: 60 });
  simulation.advanceBy(5 * 3600);
  assert.equal(simulation.view.rooms["会客室"].activeRound, "round2");
  assert.equal(simulation.view.ops[0].working, false);
  assert.ok(simulation.view.log.some(entry => entry.type === "switch" && entry.tSec === 4 * 3600));
  const afterChangeover = new StepSimulation(value, NO_EFFECTS, RATES, { startHour: 14, maxHours: 24, sampleSec: 60 });
  assert.equal(afterChangeover.view.ops[0].working, false, "an empty B shift is also respected at the start");
  afterChangeover.advanceBy(10 * 3600);
  assert.equal(afterChangeover.view.ops[0].working, true, "A resumes at midnight");
});

test("a boost adds 30 percentage points and is capped at 100", () => {
  const simulation = run(config({
    moods: { A: 50 },
    boost: { dailyCount: 1, currentDay: 0, days: [{ list: [{ hour: 6, minute: 0, target: "A" }] }] },
  }));
  const boost = simulation.view.log.find(entry => entry.type === "boost");
  assert.ok(boost, "boost event must fire");
  assert.ok(Math.abs(boost.tSec - 21_600) <= 2);
  assert.ok(boost.text.includes("+30"));
  const sample = simulation.view.history.reduce((best, item) => Math.abs(item.tSec - 21_600) < Math.abs(best.tSec - 21_600) ? item : best);
  assert.ok(Math.abs(sample.moods.A - (50 - 43.2 + 30)) < 0.5, `mood after boost was ${sample.moods.A}`);
});

test("single-shift rooms cycle work, rest and resume", () => {
  const simulation = run(config(), NO_EFFECTS, { maxHours: 48 });
  const zeroes = simulation.view.log.filter(entry => entry.type === "mood-zero");
  assert.ok(zeroes.length >= 2, `expected a second drain after recovery, got ${zeroes.length}`);
  const resumed = simulation.view.log.filter(entry => entry.type === "mood-full");
  assert.ok(resumed.length >= 1);
});

test("production accumulates at the solver rate for the worked time", () => {
  const simulation = run(config());
  const output = simulation.view.output["会客室"];
  const worked = simulation.view.workTimeSec["会客室"] / 3600;
  assert.ok(worked > 15 && worked < 16, `single-shift crew should work about 15.7h, got ${worked}`);
  assert.ok(Math.abs(output - 1.4 * worked) < 0.01, `expected ${1.4 * worked}, got ${output}`);
});

test("history samples on the requested cadence", () => {
  const simulation = run(config(), NO_EFFECTS, { maxHours: 1, sampleSec: 60 });
  assert.ok(simulation.view.history.length >= 60, `got ${simulation.view.history.length} samples`);
  assert.ok(simulation.view.history[0].tSec === 0);
});

test("starting inside the B shift switches at midnight, not a day later", () => {
  const simulation = run(config({
    rooms: [{
      key: "制造舱1", label: "制造舱 Ⅰ", kind: "mfg", slots: 1, hour: 13, single: false,
      products: ["干员经验"], enabled: true, crewA: ["A"], crewB: ["B"],
    }],
  }), NO_EFFECTS, { startHour: 20, maxHours: 8 });
  assert.equal(simulation.view.history[0].activeRounds["制造舱1"], "round2", "20:00 is inside the B shift");
  const switching = simulation.view.log.filter(entry => entry.type === "switch");
  assert.ok(switching.length >= 1);
  assert.ok(Math.abs(switching[0].tSec - 4 * 3600) <= 2, `expected the 24:00 switch, got ${switching[0].tSec}`);
});

test("ninety-six hours finish and stay deterministic", () => {
  const first = run(config(), NO_EFFECTS, { maxHours: 96, sampleSec: 300 });
  const second = run(config(), NO_EFFECTS, { maxHours: 96, sampleSec: 300 });
  assert.equal(first.view.ended, true);
  assert.equal(first.view.tSec, 96 * 3600);
  assert.deepEqual(first.view.output, second.view.output);
  assert.equal(first.view.log.length, second.view.log.length);
});

test("the longest supported replay keeps its beginning at the finest sampling interval", () => {
  const simulation = run(config(), NO_EFFECTS, { maxHours: 96, sampleSec: 10 });
  assert.equal(simulation.view.history[0].tSec, 0);
  assert.equal(simulation.view.history.at(-1).tSec, 96 * 3600);
  assert.ok(simulation.view.history.length >= 96 * 360);
});

test("clock and duration formatting stay stable", () => {
  assert.equal(formatClock(0, 8), "08:00:00");
  assert.equal(formatClock(16 * 3600, 8), "00:00:00 (+1d)");
  assert.equal(formatDuration(3600), "1h");
  assert.equal(formatDuration(5400), "1h30m");
  assert.equal(formatDuration(45), "45s");
});
