import assert from "node:assert/strict";
import test from "node:test";

import { manualShiftDurationsOf, uniformManualShiftHours } from "./manual-schedule.ts";

test("统一时长读取", () => {
  assert.equal(uniformManualShiftHours([12, 12]), 12);
  assert.equal(uniformManualShiftHours([8, 8, 8]), 8);
  // 各班长短不一 → null（时间轴模式）
  assert.equal(uniformManualShiftHours([12, 6, 6]), null);
});

test("按统一时长生成班次", () => {
  assert.deepEqual(manualShiftDurationsOf(2, 12), [12, 12]);
  assert.deepEqual(manualShiftDurationsOf(2, 18), [18, 18]);
  assert.deepEqual(manualShiftDurationsOf(3, 12), [12, 12, 12]);
  assert.deepEqual(manualShiftDurationsOf(4, 12), [12, 12, 12, 12]);
  // 边界：至少 1 小时、至少 2 班
  assert.deepEqual(manualShiftDurationsOf(2, 0), [1, 1]);
  assert.deepEqual(manualShiftDurationsOf(0, 12), [12, 12]);
});

test("周期组合", () => {
  const cases: [number, number, number][] = [
    [2, 12, 24], [2, 18, 36], [2, 24, 48],
    [3, 8, 24], [3, 12, 36], [3, 16, 48],
    [4, 6, 24], [4, 9, 36], [4, 12, 48],
  ];
  for (const [shifts, hours, total] of cases) {
    assert.equal(manualShiftDurationsOf(shifts, hours).reduce((a, b) => a + b, 0), total, `${shifts}×${hours}`);
  }
});
