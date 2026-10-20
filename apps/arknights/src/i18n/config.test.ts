import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_LOCALE, isAppLocale, resolveLocale } from "./config.ts";
import { createGameCatalogStore } from "./game-data-client.ts";
import type { EnglishCatalog } from "./game-catalog.ts";

test("only supported cookie locales override the deployment default", () => {
  assert.equal(resolveLocale("en"), "en");
  assert.equal(resolveLocale("zh"), "zh");
  for (const invalid of [undefined, null, "", "ja", "../../en", "en-US", {}, 1]) {
    assert.equal(isAppLocale(invalid), false);
    assert.equal(resolveLocale(invalid), DEFAULT_LOCALE);
  }
});

test("game catalog store keeps a null server snapshot after the client catalog loads", async () => {
  const catalog = { roomLabels: {}, operatorNames: {}, buildingSkills: {} } as unknown as EnglishCatalog;
  let loads = 0;
  const store = createGameCatalogStore(async () => { loads += 1; return catalog; });
  let notifications = 0;
  const unsubscribe = store.subscribe(() => { notifications += 1; });

  assert.equal(store.getSnapshot(), null);
  assert.equal(store.getServerSnapshot(), null);
  const first = store.ensureLoaded();
  const second = store.ensureLoaded();
  assert.equal(first, second);
  await first;
  assert.equal(loads, 1);
  assert.equal(notifications, 1);
  assert.equal(store.getSnapshot(), catalog);
  assert.equal(store.getServerSnapshot(), null);
  unsubscribe();
});
