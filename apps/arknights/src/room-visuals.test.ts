import assert from "node:assert/strict";
import test from "node:test";

import { roomLightAccentFor, roomVisualFor } from "./room-visuals.ts";

test("light comparison labels preserve schedule facility colours", () => {
  for (const group of ["trading", "manufacture", "power", "dormitory"] as const) {
    assert.equal(roomLightAccentFor(group), roomVisualFor(group).accent);
  }
  assert.equal(roomLightAccentFor("control"), "#D58A32");
});

test("white and unknown facilities use a visible neutral accent on light surfaces", () => {
  assert.equal(roomLightAccentFor("meeting"), "#71717A");
  assert.equal(roomLightAccentFor("hire"), "#71717A");
  assert.equal(roomLightAccentFor("processing"), "#71717A");
  assert.equal(roomLightAccentFor("unknown"), "#71717A");
});

test("the recycle protocol room retains the training room visual", () => {
  assert.deepEqual(roomVisualFor("recycle"), roomVisualFor("training"));
  assert.equal(roomVisualFor("recycle").background, "/images/building-room-emblems/emblem_training.png");
  assert.equal(roomLightAccentFor("recycle"), roomLightAccentFor("training"));
});
