import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import { parseLosslessJson } from "./i18n/lossless-json.mjs";

// Select a reviewed snapshot explicitly. Never mix versions after a failed request.
export const dataSources = {
  github: {
    repository: "https://github.com/rmxlinux/EndfieldData",
    revision: "8b955ea78c6f04b6e5164b75f63f46b503c5f6f2",
    tableCfgUrl: "https://raw.githubusercontent.com/rmxlinux/EndfieldData/8b955ea78c6f04b6e5164b75f63f46b503c5f6f2/TableCfg",
    cacheKey: "8b955ea78c6f04b6e5164b75f63f46b503c5f6f2",
  },
  akedata: {
    repository: "https://github.com/nagiyume/akedatabase",
    revision: "1.6.4@11529267-11",
    manifest: "https://data.akedata.wiki/manifest.json",
    tableCfgUrl: "https://data.akedata.wiki/public/1.6.4/11529267-11/TableCfg",
    cacheKey: "akedata/1.6.4-11529267-11",
  },
};
export const dataSource = dataSources.akedata;
const root = fileURLToPath(new URL("../", import.meta.url));

export async function loadEndfieldTables(names, { offline = false, source = dataSource } = {}) {
  const cache = path.join(root, ".tmp/endfield-upstream", source.cacheKey);
  await mkdir(cache, { recursive: true });
  const previous = JSON.parse(await readFile(path.join(root, "packages/endfield-data/sources.json"), "utf8"));
  const expected = previous.data.repository === source.repository && previous.data.revision === source.revision
    ? previous.data.inputs : {};
  const tableData = {}, inputs = {};
  const queue = [...names];
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const name = queue.shift();
      const file = path.join(cache, `${name}.json`);
      let bytes;
      try { bytes = await readFile(file); }
      catch (cause) {
        if (offline) throw new Error(`Missing pinned upstream cache: ${file}; run the sync once without --offline.`, { cause });
        if (cause.code !== "ENOENT") throw cause;
      }
      if (!bytes) {
        const response = await globalThis.fetch(`${source.tableCfgUrl}/${name}.json`, { signal: globalThis.AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(`Upstream ${response.status}: ${source.tableCfgUrl}/${name}.json`);
        bytes = Buffer.from(await response.arrayBuffer());
        await writeFile(file, bytes);
      }
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (expected[name] && hash !== expected[name]) throw new Error(`Pinned ${source.revision}/${name} checksum changed; review a new snapshot before syncing.`);
      const value = parseLosslessJson(bytes.toString("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid upstream table: ${name}`);
      tableData[name] = value;
      inputs[name] = hash;
    }
  }));
  const provenance = { ...source };
  delete provenance.cacheKey;
  return { tableData, provenance: { ...provenance, tables: names, inputs: Object.fromEntries(names.map(name => [name, inputs[name]])) } };
}
