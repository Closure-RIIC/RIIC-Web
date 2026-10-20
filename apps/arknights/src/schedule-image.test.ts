import assert from "node:assert/strict";
import { test } from "node:test";
import { scheduleImageScale } from "./schedule-image.ts";

test("exports ordinary schedule boards at double resolution", () => {
  assert.equal(scheduleImageScale(1600, 1200), 2);
});

test("limits long list views to the canvas dimension and memory budget", () => {
  for (const [width, height] of [[1600, 9000], [360, 22000], [18000, 900]]) {
    const scale = scheduleImageScale(width, height);
    assert.ok(scale > 0 && scale <= 2);
    assert.ok(width * scale <= 16_384);
    assert.ok(height * scale <= 16_384);
    assert.ok(width * height * scale * scale <= 16_000_001);
  }
});

test("rejects empty or invalid schedule dimensions", () => {
  for (const [width, height] of [[0, 100], [100, 0], [-1, 100], [NaN, 100], [100, Infinity]]) {
    assert.throws(() => scheduleImageScale(width, height), /not ready/);
  }
});
