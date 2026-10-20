import assert from "node:assert/strict";
import test from "node:test";
import { PLUSH_SLIDE_DURATION, plushFurInertia, plushGazeStep, plushOrbitDirection, plushOrbitPose, plushSlidePosition } from "./plush-motion.ts";

test("gaze and fur settle identically across fast and delayed GPU frames", () => {
  for (const duration of [0.1, 0.5, 2]) {
    const single = plushGazeStep(-0.55, 0.12, 0.34, duration);
    let stepped = { position: -0.55, lag: 0.12 };
    for (let i = 0; i < 120; i++) stepped = plushGazeStep(stepped.position, stepped.lag, 0.34, duration / 120);
    assert.ok(Math.abs(single.position - stepped.position) < 1e-10);
    assert.ok(Math.abs(single.lag - stepped.lag) < 1e-10);
  }
  const settled = plushGazeStep(0.55, 0.3, 0, 2);
  assert.ok(Math.abs(settled.position) + Math.abs(settled.lag) < 0.003);
  assert.deepEqual(plushGazeStep(0.2, 0.1, 0.2, 0), { position: 0.2, lag: 0.1 });
});

test("orbit projects depth and scale symmetrically and rests at the front", () => {
  assert.deepEqual(plushOrbitPose(0, 1440, 900), { x: 0, y: -0, scale: 1 });
  for (const progress of [0.25, 0.5, 1]) {
    const right = plushOrbitPose(progress, 1440, 900);
    const left = plushOrbitPose(-progress, 1440, 900);
    assert.equal(right.x, -left.x);
    assert.equal(right.y, left.y);
    assert.equal(right.scale, left.scale);
    assert.ok(right.y < 0 && right.scale < 1 && right.scale > 0.7);
  }
  assert.ok(Math.abs(plushOrbitPose(1, 1440, 900).x - 1440) < 1e-10);
  assert.equal(plushOrbitDirection(4, 0, 5), 1);
  assert.equal(plushOrbitDirection(0, 4, 5), -1);
  assert.equal(plushOrbitDirection(0, 1, 5), 1);
  assert.equal(plushOrbitDirection(1, 0, 5), -1);
});

test("slide starts offscreen, crosses center, rebounds, and stops exactly at rest", () => {
  for (const width of [390, 1440]) {
    assert.equal(plushSlidePosition(0, width), width);
    assert.equal(plushSlidePosition(PLUSH_SLIDE_DURATION, width), 0);
    const positions = Array.from({ length: 141 }, (_, i) => plushSlidePosition(350 + i * 10, width));
    assert.ok(Math.min(...positions) < -10 && Math.min(...positions) > -45);
    assert.ok(positions.slice(50).some(x => x > 1));
    const before = (plushSlidePosition(350, width) - plushSlidePosition(349, width)) * 1000;
    const after = (plushSlidePosition(351, width) - plushSlidePosition(350, width)) * 1000;
    assert.ok(Math.abs(before - after) < 40);
  }
});

test("fur trails movement, reverses on rebound, mirrors direction and settles", () => {
  for (const width of [390, 1440]) {
    const values = Array.from({ length: 175 }, (_, i) => plushFurInertia(i * 10, width, 1));
    assert.ok(values.some(value => value > 0.1));
    assert.ok(values.some(value => value < -0.01));
    values.forEach((value, i) => {
      assert.ok(Number.isFinite(value) && Math.abs(value) <= 0.7);
      assert.ok(Math.abs(value + plushFurInertia(i * 10, width, -1)) < 1e-10);
    });
    assert.equal(plushFurInertia(PLUSH_SLIDE_DURATION, width, 1), 0);
    assert.equal(plushFurInertia(0, width, 1), 0);
  }
});
