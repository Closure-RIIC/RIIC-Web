import assert from "node:assert/strict";
import test from "node:test";
import { StepSimulation } from "../src/step/step-engine.ts";
import { displayTimeline, cursorView } from "../src/mood-simulation/timeline.ts";

const config = {
  rooms: [{ key: "会客室", label: "会客室", kind: "guest", slots: 1, hour: 12, single: false,
    products: ["线索"], enabled: true, crewA: ["A"], crewB: ["B"] }], moods: { A: 30 }, work: {},
  boost: { dailyCount: 0, currentDay: 0, days: [{ list: [] }] },
};
test("dense replay keeps exact totals and transition points while shrinking the browser payload", () => {
  const engine = new StepSimulation(config, () => ({ reduce: 0, restore: 0, effMap: {} }),
    { work: 0.072, rest: 0.12, head: 0.4, assist: 0.3 }, { startHour: 0, maxHours: 96, sampleSec: 10 });
  engine.runToEnd();
  const full = engine.snapshot();
  const timeline = displayTimeline(full);
  assert.ok(full.history.length > 30000);
  assert.ok(timeline.history.length < 1000);
  assert.deepEqual(timeline.output, full.output);
  assert.deepEqual(timeline.history[0], full.history[0]);
  assert.deepEqual(timeline.history.at(-1), full.history.at(-1));
  let integral = 0;
  for (let index = 1; index < full.history.length; index++) {
    const before = full.history[index - 1], after = full.history[index];
    integral += (before.rates['会客室']?._total ?? 0) * (after.tSec - before.tSec) / 3600;
    if (before.activeRounds['会客室'] !== after.activeRounds['会客室']) {
      assert.ok(timeline.history.some(point => point.tSec === before.tSec));
      assert.ok(timeline.history.some(point => point.tSec === after.tSec));
    }
  }
  assert.ok(Math.abs(timeline.rateIntegrals['会客室']._total - integral) < 1e-8);
  const cursor = cursorView(full);
  assert.deepEqual(cursor.history, []);
  assert.deepEqual(cursor.ops, full.ops);
  for (const op of full.ops) {
    const moods = [op.mood, ...full.history.map(point => point.moods[op.name]).filter(value => value !== undefined)];
    assert.deepEqual(cursor.moodRanges[op.name], { minimum: Math.min(...moods), maximum: Math.max(...moods) });
  }
  engine.seekTo(6 * 3600);
  assert.equal(cursorView(engine.snapshot()).tSec, 6 * 3600);
  engine.seekTo(90 * 3600);
  assert.equal(cursorView(engine.snapshot()).tSec, 90 * 3600);
  assert.equal(timeline.history.at(-1).tSec, full.maxTSec, "seeking cannot truncate the displayed full timeline");
});
