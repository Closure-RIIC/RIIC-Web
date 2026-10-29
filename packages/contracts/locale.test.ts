import assert from "node:assert/strict";
import test from "node:test";
import { isAppLocale, localizedGameHref, parseLocale, readLocaleCookie, resolveLocale } from "./locale.ts";

test("UI locales normalize legacy preferences and always default to Simplified Chinese", () => {
  for (const value of [undefined, null, "", "fr", "__proto__", 1]) assert.equal(resolveLocale(value), "zh-CN");
  for (const value of ["zh", "zh-CN", "zh-Hans"]) assert.equal(resolveLocale(value), "zh-CN");
  for (const value of ["zh-TW", "zh-Hant", "zh-HK"]) assert.equal(resolveLocale(value), "zh-TW");
  for (const value of ["en", "en-US", "en-GB"]) assert.equal(resolveLocale(value), "en");
  assert.equal(parseLocale("constructor"), undefined);
  assert.equal(isAppLocale("zh"), false);
  assert.equal(isAppLocale("zh-TW"), true);
});
test("site preference wins over a legacy cookie without accepting cookie name suffixes", () => {
  assert.equal(readLocaleCookie("riic-locale=en; riic-endfield-locale=zh-TW", ["riic-endfield-locale", "riic-locale"]), "zh-TW");
  assert.equal(readLocaleCookie("other-riic-locale=en", ["riic-locale"]), "zh-CN");
  assert.equal(readLocaleCookie("riic-endfield-locale=invalid; riic-locale=en", ["riic-endfield-locale", "riic-locale"]), "en");
});
test("game navigation carries only a locale and preserves existing link state", () => {
  assert.equal(localizedGameHref("https://dj.riic.autos/skills?rarity=6#list", "zh-TW"), "https://dj.riic.autos/skills?rarity=6&ui_locale=zh-TW#list");
});
