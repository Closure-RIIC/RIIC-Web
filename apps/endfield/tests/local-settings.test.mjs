import test from "node:test";
import assert from "node:assert/strict";
import { clearEndfieldStorage, readEndfieldColorMode, readEndfieldLocale, DISPLAY_STORAGE_KEY } from "../src/local-settings.ts";
import { STORAGE_KEY } from "@riic/endfield-solver/model.mjs";
import { RESULT_STORAGE_KEY } from "../src/result-cache.ts";
import { STEP_STORAGE_KEY } from "../src/step/step-keys.ts";

test("Endfield defaults to light and preserves an explicit dark preference", () => {
  assert.equal(readEndfieldColorMode(null), "light");
  assert.equal(readEndfieldColorMode(""), "light");
  assert.equal(readEndfieldColorMode("invalid"), "light");
  assert.equal(readEndfieldColorMode("dark"), "dark");
  assert.equal(readEndfieldColorMode("light"), "light");
});

test("Endfield cleanup only removes its own keys and handles corrupt archives", () => {
  const local = new Map([[STORAGE_KEY, "{broken"], [RESULT_STORAGE_KEY, "saved-result"], [DISPLAY_STORAGE_KEY, "{}"], ["riic-color-mode", "dark"], ["riic-web-user-settings", "keep"]]);
  local.set(STEP_STORAGE_KEY, "saved-simulation");
  const session = new Map([["riic:endfield:skland-selection", "private"], ["unrelated", "keep"]]);
  clearEndfieldStorage({ removeItem: key => local.delete(key) }, { removeItem: key => session.delete(key) });
  assert.deepEqual([...local], [["riic-web-user-settings", "keep"]]);
  assert.deepEqual([...session], [["unrelated", "keep"]]);
});
test("Endfield defaults to Simplified Chinese unless its own language was selected", () => {
  assert.equal(readEndfieldLocale(""), "zh-CN");
  assert.equal(readEndfieldLocale("riic-locale=en"), "zh-CN");
  assert.equal(readEndfieldLocale("riic-locale=zh-TW"), "zh-CN");
  assert.equal(readEndfieldLocale("riic-endfield-locale=invalid; riic-locale=en"), "zh-CN");
  assert.equal(readEndfieldLocale("riic-locale=en;riic-endfield-locale=zh"), "zh-CN");
  assert.equal(readEndfieldLocale("riic-endfield-locale=en; riic-locale=zh"), "en");
  assert.equal(readEndfieldLocale("riic-endfield-locale=zh-Hant; riic-locale=en"), "zh-TW");
});
