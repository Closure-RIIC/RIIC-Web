import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { parseLosslessJson } from "./lossless-json.mjs";

const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
test("64-bit text IDs retain their exact decimal tokens", () => {
  const data = parseLosslessJson('{"id":9223372036854775807,"negative":-9223372036854775808,"level":4,"value":1.25}');
  assert.deepEqual(data, { id: "9223372036854775807", negative: "-9223372036854775808", level: 4, value: 1.25 });
});

test("Endfield locale catalogs preserve every canonical entity and output hash", () => {
  const root = "packages/endfield-data";
  const metadata = read(`${root}/metadata.json`);
  const full = read(`${root}/catalog.json`);
  const source = read(`${root}/sources.json`);
  assert.ok(source.data.inputs.I18nTextTable_TC);
  const records = [...Object.values(full.operators), ...Object.values(full.weapons), ...Object.values(full.operators).flatMap(operator => operator.skills)];
  for (const [file, expected] of Object.entries(source.translations.outputs)) {
    assert.equal(createHash("sha256").update(fs.readFileSync(`${root}/${file}`)).digest("hex"), expected, file);
  }
  for (const locale of ["zh-CN", "zh-TW", "en"]) {
    const catalog = read(`${root}/messages/${locale}/EndfieldGameData.json`);
    assert.deepEqual(Object.keys(catalog).sort(), [...new Set(records.map(record => record.id))].sort());
    for (const record of records) assert.ok(catalog[record.id].name?.trim(), `${locale}:${record.id}`);
  }
  for (const [id, record] of Object.entries(full.operators)) {
    assert.equal(metadata.operators[id].name, record.name);
    for (const name of [record.name, record.enName, record.twName]) assert.ok(metadata.operators[id].aliases.includes(name));
  }
});

test("Arknights aliases preserve canonical identity and reviewed skill values", async () => {
  const root = "apps/arknights/src/generated/i18n";
  const catalogs = Object.fromEntries(["zh-CN", "zh-TW", "en"].map(locale => [locale, read(root + "/" + locale + "/ArknightsGameData.json")]));
  const aliases = read(root + "/operator-aliases.json");
  const { operatorMatchesQuery } = await import("../../apps/arknights/src/building-rooms.ts");
  for (const [canonical, values] of Object.entries(aliases)) {
    for (const locale of ["zh-CN", "zh-TW", "en"]) assert.ok(values.includes(catalogs[locale].operatorNames[canonical]));
    for (const name of values) assert.ok(operatorMatchesQuery(canonical, [], name, () => undefined), canonical + ": " + name);
  }
  const overrides = read("apps/arknights/i18n/game-overrides/zh-TW.json");
  const numericTokens = value => value.replace(/<[^>]*>/g, "").match(/[-+]?\d+(?:\.\d+)?%?/g) ?? [];
  const markup = value => value.match(/<[^>]*>/g) ?? [];
  for (const [id, translated] of Object.entries(overrides.buildingSkills)) {
    const source = catalogs["zh-CN"].buildingSkills[id];
    assert.deepEqual(numericTokens(translated.description), numericTokens(source.description), id + ": numeric skill values");
    assert.deepEqual(markup(translated.description), markup(source.description), id + ": skill markup");
  }
  const manifest = read(root + "/sources.json");
  for (const [file, expected] of Object.entries({...manifest.localInputs, ...manifest.outputs})) assert.equal(createHash("sha256").update(fs.readFileSync(file)).digest("hex"), expected, file);
  assert.ok(manifest.coverage["zh-TW"].every(gap => gap.resolution === "manual"));
});
