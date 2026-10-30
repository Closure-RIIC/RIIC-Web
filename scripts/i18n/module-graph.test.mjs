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

test("every feature loads the namespaces found by the independent translation usage scanner", async () => {
  for (const app of ['arknights', 'endfield']) {
    const { features, rootNamespaces } = await import(`../../apps/${app}/src/i18n/feature-manifest.ts`);
    const { messageNamespaces } = await import(`../../apps/${app}/src/i18n/messages.ts`);
    const { references } = await import(`../../apps/${app}/i18n/usage-manifest.ts`);
    const byFile = new Map();
    for (const reference of references) {
      const file = path.resolve(reference.source.replace(/:\d+$/, ''));
      const namespace = reference.key.split('.')[0];
      if (!messageNamespaces.includes(namespace)) continue;
      if (!byFile.has(file)) byFile.set(file, new Set());
      byFile.get(file).add(namespace);
    }
    const graph = createModuleGraph(new Set(messageNamespaces));
    for (const [feature, loaded] of Object.entries(features)) {
      const available = new Set([...rootNamespaces, ...loaded]);
      const seen = new Set();
      function visit(file) {
        if (seen.has(file)) return;
        seen.add(file);
        for (const namespace of byFile.get(file) ?? []) {
          assert.ok(available.has(namespace), `${feature}: ${namespace} required by ${path.relative(process.cwd(), file)}`);
        }
        for (const imported of graph.inspect(file).imports) visit(imported);
      }
      visit(path.resolve(feature));
    }
  }
});
