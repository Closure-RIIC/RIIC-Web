import assert from "node:assert/strict";
import test from "node:test";

import { decodeRotationKey, encodeRotationKey, rotationShiftCountFromKey } from "./rotation-settings.ts";

test("named profiles round-trip unchanged", () => {
  for (const key of ["abc_12_6_6", "main_backup_12_12", "main_backup_24_24", "fiammetta_8_8_4_4", "abyssal_7_5_7_5"]) {
    assert.equal(encodeRotationKey(key), key);
    assert.equal(decodeRotationKey(key), key);
  }
  assert.equal(rotationShiftCountFromKey("abc_12_6_6"), 3);
  assert.equal(rotationShiftCountFromKey("main_backup_24_24"), 2);
  // 四班专用 profile 也按实际班次数返回
  assert.equal(rotationShiftCountFromKey("fiammetta_8_8_4_4"), 4);
  assert.equal(rotationShiftCountFromKey("abyssal_7_5_7_5"), 4);
});

test("custom timings encode to a compact key and decode back", () => {
  assert.equal(encodeRotationKey({ topology: "main_backup", shift_hours: [16, 8] }), "custom_zb_16_8");
  assert.equal(encodeRotationKey({ topology: "abc", shift_hours: [6, 12, 6] }), "custom_abc_6_12_6");

  assert.deepEqual(decodeRotationKey("custom_zb_16_8"), { topology: "main_backup", shift_hours: [16, 8] });
  assert.deepEqual(decodeRotationKey("custom_abc_6_12_6"), { topology: "abc", shift_hours: [6, 12, 6] });

  assert.equal(rotationShiftCountFromKey("custom_zb_16_8"), 2);
  assert.equal(rotationShiftCountFromKey("custom_abc_6_12_6"), 3);
});

test("malformed custom keys are rejected", () => {
  // 班次数与拓扑不符
  assert.equal(decodeRotationKey("custom_zb_12_12_12"), null);
  assert.equal(decodeRotationKey("custom_abc_12_12"), null);
  // 非正整数
  assert.equal(decodeRotationKey("custom_zb_0_24"), null);
  assert.equal(decodeRotationKey("custom_zb_12_x"), null);
  // 周期不是 24/36/48
  assert.equal(decodeRotationKey("custom_zb_10_10"), null);
  // 未知前缀 / 拓扑
  assert.equal(decodeRotationKey("custom_xx_12_12"), null);
  assert.equal(decodeRotationKey("nonsense"), null);
  assert.equal(decodeRotationKey("custom_zb"), null);
});
