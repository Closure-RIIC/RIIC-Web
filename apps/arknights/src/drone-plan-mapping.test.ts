import assert from "node:assert/strict";
import test from "node:test";

import { droneStoragePlanIndex, droneTargetShiftIndex } from "./drone-plan-mapping.ts";

test("drone pre-actions rotate target storage forward and restore it backward", () => {
  assert.deepEqual([0].map((index) => droneStoragePlanIndex(index, 1)), [0]);
  assert.deepEqual([0, 1].map((index) => droneStoragePlanIndex(index, 2)), [1, 0]);
  assert.deepEqual([0, 1, 2].map((index) => droneStoragePlanIndex(index, 3)), [1, 2, 0]);
  assert.deepEqual([0, 1, 2].map((index) => droneTargetShiftIndex(index, 3)), [2, 0, 1]);
  assert.deepEqual([0, 1, 2].map((index) => (
    droneTargetShiftIndex(droneStoragePlanIndex(index, 3), 3)
  )), [0, 1, 2]);
});
