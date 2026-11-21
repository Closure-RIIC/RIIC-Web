import assert from "node:assert/strict";
import test from "node:test";

import { snapManualShiftDurationsToHours } from "./manual-schedule.ts";

/** 与 setup-dialog.updateCycleHours 相同的缩放规则。 */
function scaleToCycle(current: number[], next: number): number[] {
  const total = current.reduce((sum, duration) => sum + duration, 0);
  const scaled: number[] = current.map((duration) => Math.max(1, Math.round(duration / total * next)));
  let delta = next - scaled.reduce((sum, duration) => sum + duration, 0);
  for (let index = 0; delta !== 0 && index < scaled.length * 4; index = (index + 1) % scaled.length) {
    if (delta > 0) { scaled[index] = scaled[index]! + 1; delta -= 1; }
    else if (scaled[index]! > 1) { scaled[index] = scaled[index]! - 1; delta += 1; }
  }
  return scaled;
}

test("24 → 36 保持比例", () => {
  assert.deepEqual(scaleToCycle([12, 6, 6], 36), [18, 9, 9]);
  assert.deepEqual(scaleToCycle([12, 12], 36), [18, 18]);
  assert.deepEqual(scaleToCycle([24], 36), [36]);
});

test("36 → 24 缩回", () => {
  assert.deepEqual(scaleToCycle([18, 9, 9], 24), [12, 6, 6]);
  assert.deepEqual(scaleToCycle([18, 18], 24), [12, 12]);
});

test("总和始终等于目标周期", () => {
  const combos: [number[], number][] = [
    [[12, 6, 6], 24], [[12, 6, 6], 36], [[12, 6, 6], 48],
    [[12, 12], 24], [[12, 12], 36], [[12, 12], 48],
    [[6, 6, 6, 6], 24], [[6, 6, 6, 6], 36], [[6, 6, 6, 6], 48],
    [[12, 12, 12, 12], 24], [[12, 12, 12, 12], 36], [[12, 12, 12, 12], 48],
    [[24], 24], [[24], 36], [[24], 48],
  ];
  for (const [from, to] of combos) {
    const result = scaleToCycle(from, to);
    assert.equal(result.reduce((a, b) => a + b, 0), to, `${from} → ${to}`);
    assert.ok(result.every((hours) => hours >= 1 && Number.isInteger(hours)), `${from} → ${to} 每班正整数`);
  }
});

test("4 班也能吸附到整小时", () => {
  assert.deepEqual(snapManualShiftDurationsToHours([6, 6, 6, 6]), [6, 6, 6, 6]);
  assert.deepEqual(snapManualShiftDurationsToHours([12, 12, 12, 12]), [12, 12, 12, 12]);
});
