import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { URL } from "node:url";
import { catalog } from "@riic/endfield-solver/model.mjs";
const data = JSON.parse(await readFile(new URL("./catalog.json", import.meta.url)));
const sources = JSON.parse(await readFile(new URL("./sources.json", import.meta.url)));
const workbench = JSON.parse(await readFile(new URL("./workbench.json", import.meta.url)));

test("every schedulable operator and skill resolves to the pinned display catalog", () => {
  for (const operator of catalog) {
    const display = data.operators[operator.id];
    assert.equal(display.name, operator.name);
    assert.ok(display.enName && display.icon);
    for (const skill of operator.skills) {
      const source = display.skills.find(s => s.name === skill.name);
      assert.ok(source?.icon && source.enName && source.description, `${operator.name}: ${skill.name}`);
      assert.ok(Number.isInteger(source.unlock) && source.unlock >= 0 && source.unlock <= 4);
    }
  }
  assert.equal(data.operators.chr_0004_pelica.name, "佩丽卡", "64-bit localization IDs retain precision");
  assert.equal(data.operators.chr_0015_lifeng.skills.find(s => s.name === "小大人·α").unlock, 2);
});

test("operator portraits come from the illustrated round portrait assets", () => {
  for (const operator of Object.values(data.operators)) {
    const file = sources.files.find(file => `/images/game/${file.target}` === operator.icon);
    assert.ok(file, operator.id);
    assert.ok(file.source.endsWith(`/charroundicon/icon_round_${operator.id}.png`), `${operator.name}: use the illustration, not the battle model`);
  }
});
test("all referenced local artwork has PNG signatures and matches recorded checksums", async () => {
  const paths = new Set(sources.files.map(file => `/images/game/${file.target}`));
  for (const entry of [...Object.values(data.operators), ...Object.values(data.weapons)]) {
    assert.ok(paths.has(entry.icon), entry.id);
    for (const skill of entry.skills ?? []) assert.ok(paths.has(skill.icon));
  }
  for (const group of Object.values(workbench)) {
    for (const entry of Object.values(group)) assert.ok(paths.has(entry.icon), entry.icon);
  }
  for (const file of sources.files) {
    const bytes = await readFile(new URL(`../../apps/endfield/public/images/game/${file.target}`, import.meta.url));
    assert.equal(bytes.length, file.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  }
});
