import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { catalog } from "@riic/endfield-solver/model.mjs";
import { compareOperatorRelease, operatorReleases } from "./operator-releases.ts";

test("release metadata covers every displayed operator exactly once", async () => {
  const { operators } = JSON.parse(await readFile(new URL("./catalog.json", import.meta.url)));
  const ids = operatorReleases.flatMap(release => release.operatorIds);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), Object.keys(operators).sort());
  for (const release of operatorReleases) {
    assert.match(release.releasedOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(new URL(release.source).hostname, "endfield.hypergryph.com");
  }
});

test("skills sort by first release, including later event rewards and non-sequential character IDs", () => {
  const originalOrder = catalog.map(op => op.id);
  const sorted = [...catalog].sort(compareOperatorRelease);
  assert.deepEqual(sorted.slice(0, 10).map(op => op.id), [
    "chr_0036_jsspsi", "chr_0038_purrche", "chr_0034_typhoea", "chr_0035_liino",
    "chr_0032_lizhiyan", "chr_0033_camille", "chr_0031_mifu", "chr_0030_zhuangfy",
    "chr_0028_wulfa", "chr_0027_tangtang",
  ]);
  assert.deepEqual(catalog.map(op => op.id), originalOrder);
  const launchIds = new Set(operatorReleases.at(-1).operatorIds);
  assert.deepEqual(sorted.filter(op => launchIds.has(op.id)), catalog.filter(op => launchIds.has(op.id)));
  assert.ok(compareOperatorRelease({ id: "unknown" }, sorted[0]) > 0);
  assert.equal(compareOperatorRelease({ id: "chr_0017_yvonne" }, { id: "chr_0016_laevat" }), 0);
});
