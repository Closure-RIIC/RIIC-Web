import assert from "node:assert/strict";
import test from "node:test";
import { agentFrameInterval, motionResolutionScale } from "./fur-frame-budget.ts";

test("motion keeps full resolution on fast GPUs and bounds slow GPU sampling", () => {
  assert.equal(motionResolutionScale(8, 1), 1);
  assert.equal(motionResolutionScale(1000, 1), 0.5);
  assert.equal(motionResolutionScale(NaN, 1), 1);
  assert.equal(motionResolutionScale(0, 1), 1);
});

test("cost is normalized to the currently sampled area rather than repeatedly halving", () => {
  const scale = motionResolutionScale(40, 1);
  assert.equal(scale, 0.65);
  assert.equal(motionResolutionScale(40 * scale * scale, scale), scale);
  assert.equal(motionResolutionScale(4, 0.5), 1);
});

test("interactive avatars keep the selected FPS even after expensive completed frames", () => {
  for (const fps of [24, 30, 60]) {
    for (const completedMs of [0, 16, 32, 250, 1500]) {
      assert.equal(agentFrameInterval(fps, completedMs, true), 1000 / fps);
    }
  }
});

test("only background animation retains the bounded streaming-text throttle", () => {
  assert.equal(agentFrameInterval(24, 8, false), 1000 / 24);
  assert.equal(agentFrameInterval(24, 16, false), 64);
  assert.equal(agentFrameInterval(24, 32, false), 128);
  assert.equal(agentFrameInterval(24, 1500, false), 250);
  // Claiming interaction immediately drops a previously accumulated throttle;
  // releasing it restores the budget for background animation, not a global cap.
  assert.equal(agentFrameInterval(24, 1500, true), 1000 / 24);
  assert.equal(agentFrameInterval(24, 1500, false), 250);
});

test("unavailable timing cannot stall either interactive or background animation", () => {
  for (const interactive of [true, false]) {
    assert.equal(agentFrameInterval(24, NaN, interactive), 1000 / 24);
    assert.equal(agentFrameInterval(24, Infinity, interactive), 1000 / 24);
  }
});
