import assert from "node:assert/strict";
import test from "node:test";
import { trainingCost } from "./inventory-estimates.ts";

test("training costs sum each stage and promotion rather than interpolate levels", () => {
  assert.deepEqual(trainingCost(6, 0, 1), { lmd: 0, exp: 0 });
  assert.deepEqual(trainingCost(6, 0, 2), { lmd: 30, exp: 100 });
  assert.deepEqual(trainingCost(3, 1, 55), { lmd: 104040, exp: 115400 });
  assert.deepEqual(trainingCost(6, 2, 60), { lmd: 761409, exp: 588286 });
  const before = trainingCost(6, 0, 50);
  const after = trainingCost(6, 1, 1);
  assert.equal(after.lmd - before.lmd, 30000);
  assert.equal(after.exp, before.exp);
});

test("training estimates reject unavailable promotions and levels", () => {
  for (const target of [[3, 2, 1], [3, 1, 56], [4, 2, 71], [5, 2, 81], [6, 0, 51], [6, 2, 0]]) {
    assert.throws(() => trainingCost(target[0]!, target[1]!, target[2]!), RangeError);
  }
});
