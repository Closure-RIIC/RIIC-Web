import assert from "node:assert/strict";
import test from "node:test";
import { eyeSquintInfluence, eyeSurfaceZ, furGroom, squintedEyePoint } from "./fur-detail.ts";

test("baked grooming is repeatable, finite, and continuous across lattice boundaries", () => {
  for (const point of [[0, 0, 0], [1 / 3.7, -0.2, 0.8], [-1, 2, -3]]) {
    const [x, y, z] = point;
    const groom = furGroom(x, y, z);
    assert.deepEqual(groom, furGroom(x, y, z));
    assert.ok(groom.every(v => Number.isFinite(v) && Math.abs(v) <= 1.05));
    const nearby = furGroom(x + 1e-6, y, z);
    assert.ok(groom.every((v, i) => Math.abs(v - nearby[i]) < 1e-4));
  }
});

test("eye anchors follow the head surface rather than a floating frontal plane", () => {
  const center = [0, -0.13, 0], radii = [0.74, 0.7, 0.74];
  assert.equal(eyeSurfaceZ(0, -0.13, center, radii), 0.74);
  const x = -0.25, y = -0.025;
  const z = eyeSurfaceZ(x, y, center, radii);
  assert.ok(z > 0 && z < 0.74);
  assert.ok(Math.abs((x / radii[0]) ** 2 + ((y - center[1]) / radii[1]) ** 2 + (z / radii[2]) ** 2 - 1) < 1e-12);
  assert.ok(Number.isFinite(eyeSurfaceZ(3, 3, center, radii)));
});

test("eye closure is bounded during spring overshoot and fully restores at rest", () => {
  assert.equal(eyeSquintInfluence(0), 0);
  assert.equal(eyeSquintInfluence(1), 1);
  assert.equal(eyeSquintInfluence(1.2), 1);
  assert.equal(eyeSquintInfluence(-0.2), 0);
  assert.equal(eyeSquintInfluence(NaN), 0);
  let previous = 0;
  for (let press = 0; press <= 1; press += 0.01) {
    const value = eyeSquintInfluence(press);
    assert.ok(value >= previous && value <= 1);
    previous = value;
  }
});

test("squint flattens the eye and keeps raised embroidery above the curved head", () => {
  const center = [0, -0.13, 0], radii = [0.74, 0.7, 0.74], eye = [-0.25, -0.025];
  const x = eye[0] + 0.07, y = eye[1] + 0.10;
  const result = squintedEyePoint([x, y, eyeSurfaceZ(x, y, center, radii) + 0.006], eye, center, radii);
  assert.ok(Math.abs((result[1] - eye[1]) / 0.10 - 0.5) < 1e-10);
  assert.ok(Math.abs((result[0] - eye[0]) / 0.07 - 1.04) < 1e-10);
  assert.ok(Math.abs(result[2] - eyeSurfaceZ(result[0], result[1], center, radii) - 0.0039) < 1e-10);
});
