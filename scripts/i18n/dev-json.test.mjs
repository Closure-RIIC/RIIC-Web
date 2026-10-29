import assert from "node:assert/strict";
import test from "node:test";
import { i18nDevJsonModules } from "../vite-i18n-json.ts";

test("generated dev client imports accept Vite's JavaScript JSON modules", () => {
  const plugin = i18nDevJsonModules();
  const source = '() => import("../../messages/en/Common.json", { with: { type: "json" } }).then(module => module.default)';
  const id = 'D:/repo/apps/arknights/src/i18n/loaders/en.ts';
  assert.equal(plugin.apply, 'serve');
  assert.equal(plugin.transform.call({environment:{name:'client'}},source,id).code, '() => import("../../messages/en/Common.json").then(module => module.default)');
  assert.equal(plugin.transform.call({environment:{name:'ssr'}},source,id), undefined);
  assert.equal(plugin.transform.call({environment:{name:'client'}},source,'/src/other.ts'), undefined);
});
