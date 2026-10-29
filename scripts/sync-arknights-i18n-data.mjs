import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { Converter } from "opencc-js";

const root = "apps/arknights/src/generated/i18n";
const read = async file => JSON.parse(await fs.readFile(file, "utf8"));
const hash = content => createHash("sha256").update(content).digest("hex");
const source = (await read("packages/arknights-domain/src/generated/arkntools/source.json")).source;
const operators = await read("packages/arknights-domain/src/generated/arkntools/operator-catalog.json");
const skills = await read("packages/arknights-domain/src/generated/arkntools/building-skill-catalog.json");
const items = await read("apps/arknights/src/generated/item-name-catalog.json");
const manifestFile = `${root}/sources.json`;
const localInputFiles = [
  "packages/arknights-domain/src/generated/arkntools/source.json",
  "packages/arknights-domain/src/generated/arkntools/operator-catalog.json",
  "packages/arknights-domain/src/generated/arkntools/building-skill-catalog.json",
  "apps/arknights/src/generated/item-name-catalog.json",
  "packages/arknights-domain/src/generated/operator-english-names.json",
  "apps/arknights/src/generated/building-skill-english.json",
  "apps/arknights/src/generated/building-skill-english-manual.json",
  "apps/arknights/i18n/game-overrides/en.json",
  "apps/arknights/i18n/game-overrides/zh-TW.json",
];
const localInputs = Object.fromEntries(await Promise.all(localInputFiles.map(async file => [file, hash(await fs.readFile(file))])));
if (process.argv.includes("--check")) {
  const manifest = await read(manifestFile);
  assert.deepEqual(manifest.localInputs, localInputs, "Regenerate game translations after changing canonical data or reviewed overrides.");
  assert.deepEqual(manifest.source, source, "Regenerate game translations after changing the game data revision.");
  for (const [file, expected] of Object.entries(manifest.outputs)) assert.equal(hash(await fs.readFile(file)), expected, `Generated game catalog changed: ${file}`);
  for (const locale of ["zh-CN", "zh-TW", "en"]) {
    const data = await read(`${root}/${locale}/ArknightsGameData.json`);
    assert.deepEqual(Object.keys(data.operatorNames).sort(), operators.map(op => op.name).sort());
    assert.deepEqual(Object.keys(data.buildingSkills).sort(), Object.keys(skills).sort());
    for (const value of Object.values(data.buildingSkills)) assert.ok(value.name && value.description);
  }
  console.log("Verified pinned Arknights game translations and generated hashes.");
  process.exit(0);
}
const cache = `.tmp/arknights-i18n/${source.commit}`;
const inputs = {};
async function upstream(file) {
  const target = `${cache}/${file}`;
  let content;
  try { content = await fs.readFile(target, "utf8"); }
  catch (error) {
    if (error.code !== "ENOENT" || process.argv.includes("--offline")) throw error;
    const response = await fetch(`https://raw.githubusercontent.com/arkntools/arknights-toolbox-data/${source.commit}/${file}`);
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`, { cause: error });
    content = await response.text();
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  inputs[file] = hash(content);
  return JSON.parse(content);
}
const buildingData = await upstream("assets/data/building.json");
const regional = Object.fromEntries(await Promise.all(["tw", "us"].map(async region => [region, Object.fromEntries(await Promise.all(["character", "building", "material"].map(async kind => [kind, await upstream(`assets/locales/${region}/${kind}.json`)])))])));
const convert = Converter({ from: "cn", to: "twp" });
const english = {
  operators: await read("packages/arknights-domain/src/generated/operator-english-names.json"),
  skills: { ...await read("apps/arknights/src/generated/building-skill-english.json"), ...await read("apps/arknights/src/generated/building-skill-english-manual.json") },
};
const overrides = Object.fromEntries(await Promise.all(["en", "zh-TW"].map(async locale => [locale, await read(`apps/arknights/i18n/game-overrides/${locale}.json`)])));
const roomCodes = { control: "CONTROL", trading: "TRADING", manufacture: "MANUFACTURE", power: "POWER", dormitory: "DORMITORY", meeting: "MEETING", hire: "HIRE", processing: "WORKSHOP", training: "TRAINING" };
const roomChinese = { control: "控制中枢", trading: "贸易站", manufacture: "制造站", power: "发电站", dormitory: "宿舍", meeting: "会客室", hire: "人力办公室", processing: "加工站", training: "训练室", recycling: "回收站" };
const outputs = {}, coverage = {}, catalogs = {};
for (const locale of ["zh-CN", "zh-TW", "en"]) {
  const upstreamData = regional[locale === "zh-TW" ? "tw" : "us"];
  const gaps = [];
  const data = { roomLabels: {}, operatorNames: {}, buildingSkills: {}, itemNames: {} };
  for (const op of operators) {
    const translated = upstreamData.character[op.id.replace(/^char_/, "")];
    const manual = overrides[locale]?.operatorNames?.[op.name];
    data.operatorNames[op.name] = locale === "zh-CN" ? op.name : manual || translated || (locale === "en" ? english.operators[op.name] : convert(op.name)) || op.name;
    if (locale !== "zh-CN" && !translated) gaps.push({ kind: "operator", id: op.id, source: op.name, translation: data.operatorNames[op.name], resolution: manual ? "manual" : locale === "en" ? "legacy-english" : "converted-draft" });
  }
  for (const [id, skill] of Object.entries(skills)) {
    const translated = { name: upstreamData.building.buff.name[id], description: upstreamData.building.buff.description[buildingData.buff.data[id].desc] };
    const manual = overrides[locale]?.buildingSkills?.[id];
    data.buildingSkills[id] = locale === "zh-CN" ? { name: skill.name, description: skill.descriptionRich }
      : manual || (translated.name && translated.description ? translated : locale === "en" ? english.skills[id] : { name: convert(skill.name), description: convert(skill.descriptionRich) });
    assert.ok(data.buildingSkills[id]?.name && data.buildingSkills[id]?.description, `Missing ${locale} skill ${id}`);
    if (locale !== "zh-CN" && (!translated.name || !translated.description)) gaps.push({ kind: "skill", id, resolution: manual ? "manual" : locale === "en" ? "legacy-english" : "converted-draft" });
  }
  for (const [group, cn] of Object.entries(roomChinese)) data.roomLabels[group] = locale === "zh-CN" ? cn : overrides[locale]?.roomLabels?.[group] || upstreamData.building.name[roomCodes[group]] || (locale === "en" ? "Recycling Station" : convert(cn));
  for (const [id, cn] of Object.entries(items)) {
    const translated = overrides[locale]?.itemNames?.[id] || upstreamData.material[id];
    data.itemNames[id] = locale === "zh-CN" ? cn : translated || (locale === "zh-TW" ? convert(cn) : cn);
    if (locale !== "zh-CN" && !translated) gaps.push({ kind: "item", id, source: cn, resolution: locale === "en" ? "source-fallback" : "converted-draft" });
  }
  const file = `${root}/${locale}/ArknightsGameData.json`, content = JSON.stringify(data, null, 2) + "\n";
  await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content);
  outputs[file] = hash(content); coverage[locale] = gaps; catalogs[locale] = data;
}
const aliases = Object.fromEntries(operators.map(op => [op.name, [...new Set(Object.values(catalogs).map(data => data.operatorNames[op.name]))]]));
const aliasesFile = `${root}/operator-aliases.json`, aliasesContent = JSON.stringify(aliases, null, 2) + "\n";
await fs.writeFile(aliasesFile, aliasesContent); outputs[aliasesFile] = hash(aliasesContent);
await fs.writeFile(manifestFile, JSON.stringify({ source, localInputs, inputs: Object.fromEntries(Object.entries(inputs).sort()), outputs, coverage }, null, 2) + "\n");
console.log(JSON.stringify({ operators: operators.length, skills: Object.keys(skills).length, regionalGaps: Object.fromEntries(Object.entries(coverage).map(([locale, gaps]) => [locale, gaps.length])) }));
