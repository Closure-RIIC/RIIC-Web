/* global fetch */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { log } from "node:console";
import process from "node:process";

// Use the same reviewed upstream revision as the operator catalog.
const source = JSON.parse(await readFile("apps/arknights/src/generated/arkntools/source.json", "utf8")).source;
const output = "apps/arknights/src/generated/recruitment-data.json";
const catalog = JSON.parse(await readFile("apps/arknights/src/generated/arkntools/operator-catalog.json", "utf8"));
const check = process.argv.includes("--check");
let data;
if (check) {
  data = JSON.parse(await readFile(output, "utf8"));
  assert.deepEqual(data.source, source, "Regenerate recruitment data after updating the operator catalog.");
} else {
  const base = `https://raw.githubusercontent.com/arkntools/arknights-toolbox-data/${source.commit}/`;
  const read = async (file) => {
    const response = await fetch(base + file);
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    return response.json();
  };
  const [characters, zh, en] = await Promise.all([
    read("assets/data/character.json"), read("assets/locales/cn/tag.json"), read("assets/locales/us/tag.json"),
  ]);
  data = {
    source,
    server: "cn",
    tags: Object.entries(zh).filter(([id]) => Number(id) < 100).map(([id, name]) => ({ id: Number(id), zh: name, en: en[id] })),
    operators: Object.entries(characters).filter(([, operator]) => operator.recruitment.cn > 0).map(([id, operator]) => {
      const entry = catalog.find((item) => item.id === `char_${id}`);
      assert.ok(entry, `Missing recruitment operator in catalog: ${id}`);
      return { id: entry.id, name: entry.name, rarity: operator.star, tags: [...new Set([
        operator.profession, operator.position, ...operator.tags,
        ...(operator.star === 6 ? [11] : operator.star === 5 ? [14] : []),
      ])].sort((a, b) => a - b) };
    }).sort((a, b) => a.id.localeCompare(b.id, "en")),
  };
}
assert.ok(data.operators.length > 100, "Recruitment pool unexpectedly small");
assert.equal(new Set(data.operators.map((operator) => operator.id)).size, data.operators.length);
for (const operator of data.operators) {
  const entry = catalog.find((item) => item.id === operator.id);
  assert.ok(entry && entry.name === operator.name && entry.rarity === operator.rarity, `Invalid operator: ${operator.id}`);
  assert.ok(operator.tags.every((id) => data.tags.some((tag) => tag.id === id && tag.zh && tag.en)));
}
if (!check) await writeFile(output, JSON.stringify(data, null, 2) + "\n");
log(`Recruitment data ${check ? "verified" : "generated"}: ${data.operators.length} operators (${source.commit.slice(0, 7)}).`);
