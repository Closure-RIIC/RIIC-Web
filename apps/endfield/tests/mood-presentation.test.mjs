import assert from "node:assert/strict";
import test from "node:test";
import { operatorsAt } from "../src/mood-simulation/presentation.ts";

test("operator states follow the current engine snapshot, including standby and depleted morale", () => {
  const view = {
    rooms: { 中枢: { activeRound: "round1" }, 会客室: { activeRound: "round2" } },
    ops: [
      { name: "A", roomKey: "中枢", round: "round1", mood: 51.25, working: true },
      { name: "B", roomKey: "中枢", round: "round2", mood: 70, working: false },
      { name: "C", roomKey: "会客室", round: "round2", mood: 15, working: false },
      { name: "D", roomKey: "会客室", round: "round2", mood: 0, working: false },
    ],
    history: [{ tSec: 60, moods: { A: 10, B: 20, C: 30, D: 40 } }],
  };
  const states = operatorsAt(view);
  assert.deepEqual(states.map(state => state.mood), [51.25, 70, 15, 0]);
  assert.deepEqual(states.map(state => state.status), ["work", "standby", "rest", "zero"]);
  assert.deepEqual(operatorsAt(view, "中枢"), states.slice(0, 2));
});
