import assert from "node:assert/strict";
import test from "node:test";
import { createManualScheduleDraft } from "../manual-schedule.ts";
import { pointAt, segmentAt, simulate } from "./engine.ts";
import { createMoodPlayback, moodPlaybackInput, moodPlaybackReducer as reduce, type MoodPlaybackState } from "./playback.ts";
import { defaultMoodSettings, type MoodSimulationInput } from "./types.ts";

function fixture(activeShift = 1): MoodSimulationInput {
  const draft = createManualScheduleDraft([8, 8, 8]);
  draft.activeShift = activeShift;
  for (const shift of draft.shifts) shift.rooms.trade_1 = { operators: ["阿米娅"] };
  return {
    layout: { template: "test", drone_cap: 200, scenario: {}, rooms: [{ id: "trade_1", kind: "trade_post", level: 3 }] },
    draft,
    operbox: [{ id: "char_002_amiya", name: "阿米娅", own: true, elite: 2, level: 80, potential: 1, rarity: 5 }],
    settings: { ...defaultMoodSettings(), idleEnabled: false, cycles: 3 },
    fiammettaEnabled: false,
  };
}

function complete(state: MoodPlaybackState, input: MoodSimulationInput) {
  return reduce(state, { type: "result", calculationKey: moodPlaybackInput(input).calculationKey, result: simulate(input) });
}

function ready(input = fixture()) {
  return complete(createMoodPlayback(moodPlaybackInput(input)), input);
}

test("restored editor shifts seek the continuous trajectory without resetting morale", () => {
  for (const [shift, expectedTime, expectedMood] of [[1, 8, 16], [2, 16, 8]]) {
    const input = fixture(shift);
    const before = structuredClone(input);
    const state = reduce(ready(input), { type: "enter" });
    assert.equal(state.cursor, expectedTime);
    assert.equal(segmentAt(state.result!, state.cursor).shift, shift);
    assert.equal(pointAt(state.result!, state.cursor)["阿米娅"], expectedMood);
    assert.equal(state.playing, false);
    assert.deepEqual(input, before, "playback must not mutate the source schedule");
  }
});

test("view changes retain later-cycle progress only for the selected editor shift", () => {
  let state = reduce(ready(), { type: "seek", time: 33 });
  state = reduce(state, { type: "enter" });
  assert.equal(state.cursor, 33, "cycle 2 shift 2 remains selected");
  state = reduce(state, { type: "seek", time: 17 });
  state = reduce(state, { type: "enter" });
  assert.equal(state.cursor, 8, "returning from shift 3 aligns with editor shift 2");
});

test("navigation and recalculation use the live external clock instead of the last rendered cursor", () => {
  const input = fixture();
  let state = ready(input);
  state = reduce(state, { type: "enter" }, 33);
  assert.equal(state.cursor, 33, "same shift in a later cycle keeps live progress");
  state = reduce(state, { type: "toggle", fromEditor: false }, 34);
  assert.equal(state.cursor, 34);
  input.settings.idleEnabled = true;
  state = reduce(state, { type: "input", input: moodPlaybackInput(input) }, 35);
  state = complete(state, input);
  assert.equal(state.cursor, 35, "settings recalculation preserves elapsed playback time");
  state = reduce(state, { type: "enter" }, 41);
  assert.equal(state.cursor, 8, "live progress in a different shift returns to the editor selection");
});

test("editing a schedule resets position, simulation-only changes preserve it and clamp shortened cycles", () => {
  const input = fixture();
  let state = reduce(ready(input), { type: "seek", time: 65 });
  input.settings.idleEnabled = true;
  state = reduce(state, { type: "input", input: moodPlaybackInput(input) });
  assert.equal(state.status, "pending");
  state = complete(state, input);
  assert.equal(state.cursor, 65);
  input.settings.cycles = 1;
  state = complete(reduce(state, { type: "input", input: moodPlaybackInput(input) }), input);
  assert.equal(state.cursor, 24);
  assert.equal(state.playing, false);
  input.draft.shifts[1]!.rooms.trade_1 = { operators: [] };
  state = complete(reduce(state, { type: "input", input: moodPlaybackInput(input) }), input);
  assert.equal(state.cursor, 8);
  assert.deepEqual(segmentAt(state.result!, state.cursor).rooms.trade_1, []);
});

test("latest selection wins during computation even though its calculation key does not change", () => {
  const input = fixture(0);
  let state = createMoodPlayback(moodPlaybackInput(input));
  const initialKey = state.input.calculationKey;
  for (const shift of [1, 2]) {
    input.draft.activeShift = shift;
    input.draft.startTime = "12:00";
    state = reduce(state, { type: "input", input: moodPlaybackInput(input) });
    assert.equal(state.input.calculationKey, initialKey);
  }
  state = complete(state, input);
  assert.equal(state.cursor, 16);
  const result = state.result;
  input.draft.activeShift = 1;
  state = reduce(state, { type: "input", input: moodPlaybackInput(input) });
  assert.equal(state.cursor, 8);
  assert.equal(state.result, result, "switching shifts reuses the completed calculation");
});

test("schedule alignment survives subsequent settings edits and uses new shift boundaries", () => {
  const input = fixture(2);
  let state = ready(input);
  input.draft.shifts = input.draft.shifts.slice(0, 2);
  input.draft.shifts[0]!.durationHours = 10;
  input.draft.shifts[1]!.durationHours = 14;
  input.draft.activeShift = 1;
  state = reduce(state, { type: "input", input: moodPlaybackInput(input) });
  input.settings.cycles = 1;
  state = reduce(state, { type: "input", input: moodPlaybackInput(input) });
  state = complete(state, input);
  assert.equal(state.cursor, 10);
  assert.equal(segmentAt(state.result!, state.cursor).shift, 1);
  assert.equal(pointAt(state.result!, state.cursor)["阿米娅"], 14);
});

test("explicit seeking wins over editor alignment; playback, pause and end restart are consistent", () => {
  let state = reduce(ready(), { type: "seek", time: 0 });
  assert.equal(state.cursor, 0);
  state = reduce(state, { type: "toggle", fromEditor: false });
  assert.equal(state.cursor, 0);
  assert.equal(state.playing, true);
  state = reduce(state, { type: "tick", calculationKey: state.input.calculationKey, time: 17 });
  assert.equal(segmentAt(state.result!, state.cursor).shift, 2);
  state = reduce(state, { type: "pause" });
  state = reduce(state, { type: "tick", calculationKey: state.input.calculationKey, time: 18 });
  assert.equal(state.cursor, 17);
  state = reduce(state, { type: "toggle", fromEditor: true });
  assert.equal(state.cursor, 8);
  assert.equal(state.playing, true);
  state = reduce(state, { type: "tick", calculationKey: state.input.calculationKey, time: 80 });
  assert.equal(state.cursor, 72);
  assert.equal(state.playing, false);
  state = reduce(state, { type: "toggle", fromEditor: false });
  assert.equal(state.cursor, 0);
  assert.equal(state.playing, true);
});

test("stale computations and failures cannot revive playback or consume a new navigation intent", () => {
  const input = fixture();
  let state = reduce(ready(input), { type: "toggle", fromEditor: true });
  const old = state;
  input.draft.shifts[0]!.rooms.trade_1 = { operators: [] };
  state = reduce(state, { type: "input", input: moodPlaybackInput(input) });
  assert.equal(state.playing, false);
  for (const action of [
    { type: "result", calculationKey: old.input.calculationKey, result: old.result! } as const,
    { type: "error", calculationKey: old.input.calculationKey, message: "obsolete" } as const,
    { type: "tick", calculationKey: old.input.calculationKey, time: 20 } as const,
  ]) assert.equal(reduce(state, action), state);
  state = reduce(state, { type: "error", calculationKey: state.input.calculationKey, message: "failed" });
  assert.equal(state.status, "error");
  assert.equal(reduce(state, { type: "toggle", fromEditor: true }), state);
  assert.equal(reduce(state, { type: "seek", time: 0 }), state);
  input.draft.activeShift = 2;
  state = reduce(state, { type: "input", input: moodPlaybackInput(input) });
  input.settings.cycles = 1;
  state = complete(reduce(state, { type: "input", input: moodPlaybackInput(input) }), input);
  assert.equal(state.cursor, 16);
  assert.equal(state.playing, false);
});
