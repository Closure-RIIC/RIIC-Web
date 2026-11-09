import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_MANUAL_SETUP_SHIFT_COUNT,
  MIN_MANUAL_SETUP_SHIFT_COUNT,
} from "./manual-schedule-config.ts";
import { resizeManualShiftDurations } from "./manual-schedule.ts";

test("配置窗口允许 2–4 班", () => {
  assert.equal(MIN_MANUAL_SETUP_SHIFT_COUNT, 2);
  assert.equal(MAX_MANUAL_SETUP_SHIFT_COUNT, 4);
});

test("两班起步，扩到 4 班、缩回 2 班都保持总时长", () => {
  const two = resizeManualShiftDurations([12, 12], 2);
  assert.equal(two.length, 2);
  assert.equal(two.reduce((sum, hours) => sum + hours, 0), 24);

  const four = resizeManualShiftDurations(two, 4);
  assert.equal(four.length, 4);
  assert.equal(four.reduce((sum, hours) => sum + hours, 0), 24);

  const back = resizeManualShiftDurations(four, 2);
  assert.equal(back.length, 2);
  assert.equal(back.reduce((sum, hours) => sum + hours, 0), 24);
});

test("requesting below the minimum clamps to 2 shifts", () => {
  assert.equal(resizeManualShiftDurations([24, 12, 12], 1).length, 2);
  assert.equal(resizeManualShiftDurations([12, 12], 0).length, 2);
});
