import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_LOCALE, isAppLocale, resolveLocale } from "@riic/arknights-domain/i18n/config";
import { loadMessages } from "./messages.ts";
import { localizedOperatorName, localizedBuildingSkill, localizedRoomTitle } from "./game-data.ts";
import { operatorMatchesQuery } from "../building-rooms.ts";
import type { GameCatalog } from "./game-catalog.ts";

test("only supported cookie locales override the deployment default", () => {
  assert.equal(resolveLocale("en"), "en");
  assert.equal(resolveLocale("zh"), "zh-CN");
  assert.equal(resolveLocale("en-US"), "en");
  assert.equal(resolveLocale("zh-Hant"), "zh-TW");
  for (const invalid of [undefined, null, "", "ja", "../../en", {}, 1]) {
    assert.equal(isAppLocale(invalid), false);
    assert.equal(resolveLocale(invalid), DEFAULT_LOCALE);
  }
});

test("game resources are locale-scoped, reusable and do not mutate canonical names", async () => {
  const [en, tw, repeated] = await Promise.all([loadMessages("en", ["ArknightsGameData"]), loadMessages("zh-TW", ["ArknightsGameData"]), loadMessages("en", ["ArknightsGameData"])]);
  assert.equal(en.ArknightsGameData, repeated.ArknightsGameData);
  const english = en.ArknightsGameData as unknown as GameCatalog;
  const traditional = tw.ArknightsGameData as unknown as GameCatalog;
  assert.equal(localizedOperatorName("阿米娅", "en", english), "Amiya");
  assert.equal(localizedOperatorName("阿米娅", "zh-TW", traditional), "阿米婭");
  assert.equal(localizedOperatorName("阿米娅", "zh-CN", traditional), "阿米娅");
  const original = { name: "技能", description: "原始描述", id: "control_tra_spd_000" };
  const translated = localizedBuildingSkill(original.id, "zh-TW", original, traditional);
  assert.equal(translated.id, original.id);
  assert.equal(original.description, "原始描述");
  assert.notEqual(translated.description, original.description);
});

test("Simplified Chinese reuses canonical game records without a duplicate serialized catalog", async () => {
  const messages = await loadMessages("zh-CN", ["ArknightsGameData"]);
  const catalog = messages.ArknightsGameData as unknown as GameCatalog;
  assert.ok(JSON.stringify(catalog).length < 100);
  assert.equal(localizedOperatorName("阿米娅", "zh-CN", catalog), "阿米娅");
  assert.equal(localizedRoomTitle("制造站 1", "manufacture", "zh-CN", catalog), "制造站 1");
  const skill = { name: "订单管理", description: "订单效率提高30%" };
  assert.equal(localizedBuildingSkill("test", "zh-CN", skill, catalog), skill);
  for (const query of ["阿米娅", "Amiya", "阿米婭", "订单效率"]) {
    assert.ok(operatorMatchesQuery("阿米娅", ["test"], query, () => skill, catalog.operatorNames, undefined, catalog.buildingSkills), query);
  }
});
