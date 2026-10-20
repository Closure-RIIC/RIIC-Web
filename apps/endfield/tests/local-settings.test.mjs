import test from "node:test";
import assert from "node:assert/strict";
import { clearEndfieldStorage, readEndfieldColorMode, readEndfieldLocale, DISPLAY_STORAGE_KEY } from "../src/local-settings.ts";
import { STORAGE_KEY } from "../../../packages/endfield-solver/model.mjs";
import { RESULT_STORAGE_KEY } from "../src/result-cache.ts";

test("Endfield defaults to dark and preserves an explicit light preference", () => {
  assert.equal(readEndfieldColorMode(null), "dark");
  assert.equal(readEndfieldColorMode(""), "dark");
  assert.equal(readEndfieldColorMode("invalid"), "dark");
  assert.equal(readEndfieldColorMode("dark"), "dark");
  assert.equal(readEndfieldColorMode("light"), "light");
});

test("Endfield cleanup only removes its own keys and handles corrupt archives", () => {
  const local = new Map([[STORAGE_KEY, "{broken"], [RESULT_STORAGE_KEY, "saved-result"], [DISPLAY_STORAGE_KEY, "{}"], ["riic-color-mode", "dark"], ["riic-web-user-settings", "keep"]]);
  const session = new Map([["riic:endfield:skland-selection", "private"], ["unrelated", "keep"]]);
  clearEndfieldStorage({ removeItem: key => local.delete(key) }, { removeItem: key => session.delete(key) });
  assert.deepEqual([...local], [["riic-web-user-settings", "keep"]]);
  assert.deepEqual([...session], [["unrelated", "keep"]]);
});
test("Endfield uses its own language after migration, regardless of the Arknights cookie", () => {
  assert.equal(readEndfieldLocale(""), "zh");
  assert.equal(readEndfieldLocale("riic-locale=en"), "en");
  assert.equal(readEndfieldLocale("riic-locale=en;riic-endfield-locale=zh"), "zh");
  assert.equal(readEndfieldLocale("riic-endfield-locale=en; riic-locale=zh"), "en");
});
