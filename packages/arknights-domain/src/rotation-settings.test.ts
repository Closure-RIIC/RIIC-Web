import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ROTATION_PROFILE,
  ROTATION_OPTIONS,
  SELECTABLE_ROTATION_OPTIONS,
  isRotationProfile,
  normalizeRotationProfile,
  rotationDurations,
  rotationOption,
} from "./rotation-settings.ts";

test("keeps all supported solver profiles readable for historical sessions", () => {
  assert.deepEqual(ROTATION_OPTIONS.map(({ profile }) => profile), [
    "abc_12_6_6",
    "main_backup_12_12",
    "abc_12_12_12",
    "main_backup_24_24",
    "fiammetta_8_8_4_4",
    "abyssal_7_5_7_5",
  ]);
  assert.equal(isRotationProfile("abc_12_6_6"), true);
  assert.equal(isRotationProfile("abc_12_12_12"), true);
  assert.equal(isRotationProfile("main_backup_24_24"), true);
  // 隐藏的历史 profile 仍允许旧会话读取。
  assert.equal(isRotationProfile("fiammetta_8_8_4_4"), true);
  assert.equal(isRotationProfile("abyssal_7_5_7_5"), true);
  assert.equal(isRotationProfile("auto_rotation"), false);
});

test("keeps the worker-defined durations for every supported profile", () => {
  assert.deepEqual(rotationOption("abc_12_6_6").durations, [12, 6, 6]);
  assert.deepEqual(rotationOption("main_backup_12_12").durations, [12, 12]);
  assert.deepEqual(rotationOption("abc_12_12_12").durations, [12, 12, 12]);
  assert.deepEqual(rotationOption("main_backup_24_24").durations, [24, 24]);
  assert.deepEqual(rotationDurations("fiammetta_8_8_4_4"), [8, 8, 4, 4]);
});

test("invalid persisted values fall back to the existing default profile", () => {
  assert.equal(normalizeRotationProfile("fiammetta_8_8_4_4"), "fiammetta_8_8_4_4");
  assert.equal(normalizeRotationProfile("automatic"), DEFAULT_ROTATION_PROFILE);
  assert.equal(normalizeRotationProfile(null), DEFAULT_ROTATION_PROFILE);
});

test("calculator presets follow the requested order while hidden profiles remain readable", () => {
  assert.deepEqual(SELECTABLE_ROTATION_OPTIONS.map(({ profile }) => profile), [
    "abc_12_12_12", "abc_12_6_6", "main_backup_24_24",
  ]);
  assert.deepEqual(SELECTABLE_ROTATION_OPTIONS.map(({ label }) => label), [
    "一天两换三班倒", "一天三换三班倒", "主备两班轮换",
  ]);
});
