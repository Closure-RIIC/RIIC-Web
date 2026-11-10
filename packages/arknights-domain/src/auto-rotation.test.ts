import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_AUTO_ROTATION_HOURS,
  autoRotationFromKey,
  encodeAutoRotationKey,
  isAutoRotationHours,
} from "./auto-rotation.ts";

test("automatic rotation hours require two finite positive minute-sized values", () => {
  assert.equal(isAutoRotationHours([24, 12]), true);
  assert.equal(isAutoRotationHours([0.5, 1 / 60]), true);
  for (const value of [[24], [24, 12, 6], [0, 12], [-1, 12], [Infinity, 12], [0.01, 12], ["24", 12]]) {
    assert.equal(isAutoRotationHours(value), false);
  }
});

test("automatic rotation keys round trip without changing the configured hours", () => {
  assert.deepEqual(DEFAULT_AUTO_ROTATION_HOURS, [32, 32]);
  assert.equal(encodeAutoRotationKey([24, 12]), "auto_24_12");
  assert.equal(encodeAutoRotationKey([0.5, 1.25]), "auto_0.5_1.25");
  assert.deepEqual(autoRotationFromKey("auto_24_12"), [24, 12]);
  assert.deepEqual(autoRotationFromKey("auto_0.5_1.25"), [0.5, 1.25]);
  assert.equal(autoRotationFromKey("abc_12_6_6"), null);
  assert.equal(autoRotationFromKey("auto_24_12_extra"), null);
  assert.equal(autoRotationFromKey("auto_0_12"), null);
  assert.throws(() => encodeAutoRotationKey([0, 12]), /Invalid automatic rotation hours/);
});
