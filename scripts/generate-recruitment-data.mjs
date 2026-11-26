/* global fetch */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { log } from "node:console";
import path from "node:path";
import process from "node:process";

let check = false;
let allowRemovals = false;
let sourceRoot;
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--check") check = true;
  else if (argument === "--allow-removals") allowRemovals = true;
  else if (argument === "--source") {
    const value = process.argv[++index];
    assert.ok(value && !value.startsWith("--"), "--source requires a checkout directory");
    sourceRoot = path.resolve(value);
  } else throw new Error(`Unknown argument: ${argument}`);
}

// Use the same reviewed upstream revision as the operator catalog.
const source = JSON.parse(await readFile("packages/arknights-domain/src/generated/arkntools/source.json", "utf8")).source;
const output = "apps/arknights/src/generated/recruitment-data.json";
const catalog = JSON.parse(await readFile("packages/arknights-domain/src/generated/arkntools/operator-catalog.json", "utf8"));
let data;
if (check && !sourceRoot) {
  data = JSON.parse(await readFile(output, "utf8"));
  assert.deepEqual(data.source, source, "Regenerate recruitment data after updating the operator catalog.");
} else {
  if (sourceRoot) {
    const revision = execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    assert.equal(revision, source.commit, "Recruitment source checkout must match the operator catalog revision.");
  }
  const base = `https://raw.githubusercontent.com/arkntools/arknights-toolbox-data/${source.commit}/`;
  const read = async (file) => {
    if (sourceRoot) return JSON.parse(await readFile(path.join(sourceRoot, file), "utf8"));
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
  if (check) {
    const stored = JSON.parse(await readFile(output, "utf8"));
    assert.deepEqual(stored, data, "Regenerate recruitment data after updating the recruitment pool.");
  }
}
assert.ok(data.operators.length > 100, "Recruitment pool unexpectedly small");
assert.equal(new Set(data.operators.map((operator) => operator.id)).size, data.operators.length);
for (const operator of data.operators) {
  const entry = catalog.find((item) => item.id === operator.id);
  assert.ok(entry && entry.name === operator.name && entry.rarity === operator.rarity, `Invalid operator: ${operator.id}`);
  assert.ok(operator.tags.every((id) => data.tags.some((tag) => tag.id === id && tag.zh && tag.en)));
}
if (!check) {
  const previous = await readFile(output, "utf8").catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (previous !== null) {
    const stored = JSON.parse(previous);
    assert.ok(stored && Array.isArray(stored.operators), "Existing recruitment snapshot has an invalid operator list");
    const nextIds = new Set(data.operators.map((operator) => operator.id));
    const removed = stored.operators.filter((operator) => !nextIds.has(operator.id));
    assert.ok(allowRemovals || removed.length === 0,
      `Recruitment update would remove ${removed.length} operator(s): ${removed.map((operator) => operator.id).join(", ")}. Review the removals and rerun with --allow-removals.`);
  }
  await writeFile(output, JSON.stringify(data, null, 2) + "\n");
}
log(`Recruitment data ${check ? "verified" : "generated"}: ${data.operators.length} operators (${source.commit.slice(0, 7)}).`);
