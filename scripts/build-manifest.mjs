import { renderBuildDocument } from "./render-build-document.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
const publicRoot = new URL("../apps/arknights/.output/public/", import.meta.url);

export async function loadRouteBundleStats() {
  const metadata = JSON.parse(await readFile(new URL("../apps/arknights/.output/riic-build.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL(".vite/manifest.json", publicRoot), "utf8"));
  const entryKeys = Object.keys(manifest).filter((key) => manifest[key].isEntry);
  assert.ok(entryKeys.length, "Vite client manifest has no entry points");
  function graph(keys) {
    const seen = new Set();
    function visit(key) {
      if (seen.has(key)) return;
      assert.ok(manifest[key], "Missing manifest entry: " + key);
      seen.add(key);
      for (const dependency of manifest[key].imports ?? []) visit(dependency);
    }
    keys.forEach(visit);
    return [...new Set([...seen].map((key) => manifest[key].file).filter((file) => file.endsWith(".js")))];
  }
  const pages = ["/", "/manual", "/training", "/mastery", "/recruitment", "/skills", "/skland", "/account"];
  const stats = [];
  for (const route of pages) {
    const name = route === "/" ? "index" : route.slice(1);
    const groupedEntry = (name) => Object.keys(manifest).find((key) => manifest[key].name === name);
    const keys = [
      manifest["src/routes/_workbench.tsx?tsr-split=component"] ? "src/routes/_workbench.tsx?tsr-split=component" : groupedEntry("workbench"),
      route === "/" ? groupedEntry("calculator") : "src/routes/_workbench." + name + ".tsx?tsr-split=component",
    ];
    keys.forEach((key) => assert.ok(manifest[key], "Missing independent route chunk: " + key));
    let paths = graph([...entryKeys, ...keys]);
    if (route === "/skland" && !metadata.sklandEnabled) {
      // beforeLoad returns 404 before the workbench renders; measure that real document.
      const html = await renderBuildDocument(route, 404);
      paths = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((match) => match[1].slice(1)))];
      assert.ok(paths.length, "Feature-disabled 404 document has no client entry");
    }
    const bodies = await Promise.all(paths.map((file) => readFile(new URL(file, publicRoot))));
    stats.push({ route, firstLoadChunkPaths: paths, firstLoadUncompressedJsBytes: bodies.reduce((total, body) => total + body.byteLength, 0) });
  }
  return stats;
}
