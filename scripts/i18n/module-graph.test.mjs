import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createModuleGraph, resolveModule } from "./module-graph.mjs";

test("deployment aliases include enabled cloud, inventory and Skland translation dependencies", () => {
  const namespaces = new Set(fs.readdirSync('apps/arknights/messages/zh-CN').map(file => file.replace(/\.json$/, '')));
  const graph = createModuleGraph(namespaces);
  const cloud = resolveModule('account-cloud-workspace-bridge', path.resolve('apps/arknights/src/App.tsx'));
  assert.ok(cloud);
  assert.ok(graph.resources(cloud).has('components_cloud_CloudDataSync'));
  assert.ok(graph.resources(path.resolve('apps/arknights/src/routes/_workbench.tsx')).has('components_cloud_CloudDataSync'));
  assert.ok(resolveModule('workbench-inventory-route', cloud)?.endsWith('InventoryPage.tsx'));
  assert.ok(resolveModule('workbench-skland-route', cloud)?.endsWith('SklandRoute.tsx'));
});

test("compact generated feature indexes preserve every module's resource set", async () => {
  for (const app of ['arknights', 'endfield']) {
    const { features } = await import(`../../apps/${app}/src/i18n/feature-manifest.ts`);
    const names = new Set(Object.values(features).flat());
    const graph = createModuleGraph(names);
    for (const [file, resources] of Object.entries(features)) assert.deepEqual([...resources].sort(), [...graph.resources(path.resolve(file))].sort(), file);
  }
});

test("Skland route loads dynamically named field translations in all locales", async () => {
  const namespaces = new Set(fs.readdirSync('apps/endfield/messages/zh-CN').map(file => file.replace(/\.json$/, '')));
  const graph = createModuleGraph(namespaces);
  assert.ok(graph.resources(path.resolve('apps/endfield/src/routes/skland.tsx')).has('SklandFields'));
  const { pageNamespaces } = await import('../../apps/endfield/src/i18n/feature-manifest.ts');
  const { loadMessages } = await import('../../apps/endfield/src/i18n/messages.ts');
  for (const locale of ['zh-CN', 'zh-TW', 'en']) {
    const messages = await loadMessages(locale, pageNamespaces('/skland'));
    for (const key of ['createTime', 'lastLoginTime', 'exp', 'level', 'worldLevel', 'charNum', 'weaponNum']) {
      assert.equal(typeof messages.SklandFields?.[key], 'string', `${locale}: ${key}`);
    }
  }
});
