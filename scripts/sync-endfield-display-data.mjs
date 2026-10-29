import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import { Converter } from "opencc-js";
import { parseLosslessJson } from "./i18n/lossless-json.mjs";
import { writeGenerated } from "./i18n/write-generated.mjs";

// Deliberately pinned: upstream updates are reviewed independently of solver updates.
const dataRevision = "8b955ea78c6f04b6e5164b75f63f46b503c5f6f2";
const assetRevision = "659fa8d40061616433722bdd803ef432e887f89e";
const root = fileURLToPath(new URL("../", import.meta.url));
const cache = path.join(root, ".tmp/endfield-upstream", dataRevision);
const output = path.join(root, "packages/endfield-data");
const publicDir = path.join(root, "apps/endfield/public/images/game");
const tables = ["CharacterTable", "CharGrowthTable", "WeaponBasicTable", "ItemTable", "SpaceshipCharSkillTable", "SpaceshipSkillTable", "I18nTextTable_CN", "I18nTextTable_EN", "I18nTextTable_TC"];
const check = process.argv.includes("--check");
const offline = process.argv.includes("--offline") || check;
const textOnly = process.argv.includes("--text-only") || check;
const tableHashes = {}, outputHashes = {};
async function emit(file, contents) {
  outputHashes[file] = createHash("sha256").update(contents).digest("hex");
  await writeGenerated(path.join(output, file), contents);
}
const traditional = Converter({ from: "cn", to: "twp" });
await mkdir(cache, { recursive: true });
await mkdir(output, { recursive: true });

async function fetchBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Upstream ${response.status}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
// Text IDs exceed Number.MAX_SAFE_INTEGER. Retain the original JSON token.
const parse = parseLosslessJson;
const tableData = {};
for (const name of tables) {
  const file = path.join(cache, `${name}.json`);
  let bytes;
  try { bytes = await readFile(file); }
  catch (cause) {
    if (offline) throw new Error(`Missing pinned upstream cache: ${file}; run the sync once without --offline.`, { cause });
    bytes = await fetchBytes(`https://raw.githubusercontent.com/rmxlinux/EndfieldData/${dataRevision}/TableCfg/${name}.json`);
    await writeFile(file, bytes);
  }
  tableHashes[name] = createHash("sha256").update(bytes).digest("hex");
  tableData[name] = parse(bytes.toString("utf8"));
}
const { CharacterTable: characters, CharGrowthTable: growth, WeaponBasicTable: weapons, ItemTable: items,
  SpaceshipCharSkillTable: charSkills, SpaceshipSkillTable: skills, I18nTextTable_CN: zh, I18nTextTable_EN: en, I18nTextTable_TC: tw } = tableData;
const localize = (field, dict) => dict[field?.id] || field?.text || "";
const clean = text => text.replace(/<[^>]*>/g, "");

// Upstream only stores numeric ids for effects, professions and room types; these tables mirror
// packages/endfield-solver/data/ship-data.json so both data sets stay readable side by side.
// Unknown ids fail the sync on purpose: a new game version should be reviewed, not silently dropped.
const EFFECT_TYPES = {
  0: { key: "MoodRecoveryAll", zh: "全员心情恢复提升", en: "Ship-wide morale recovery" },
  1: { key: "RoomMoodConsumeDown", zh: "舱室内干员心情消耗降低", en: "Room morale consumption" },
  3: { key: "GrowSpeedUp", zh: "培养舱 · 指定质料培养速度提升", en: "Growth speed" },
  4: { key: "ClueEfficiencyUp", zh: "会客室 · 线索收集效率提升", en: "Clue collection" },
  6: { key: "ClueProbabilityUp", zh: "会客室 · 指定线索出现概率提升", en: "Clue probability" },
  7: { key: "ManufactureEfficiencyUp", zh: "制造舱 · 指定经验素材生产效率提升", en: "Production efficiency" },
};
const PROFESSIONS = {
  0: { zh: "近卫", en: "Guard" },
  2: { zh: "重装", en: "Defender" },
  4: { zh: "辅助", en: "Support" },
  5: { zh: "术师", en: "Caster" },
  7: { zh: "先锋", en: "Vanguard" },
  8: { zh: "突击", en: "Striker" },
};
// Second skill parameter narrows the effect down to one target (see ship-data enums.effectParam).
const EXP_TYPES = { 1: { zh: "干员经验", en: "Operator EXP" }, 2: { zh: "武器经验", en: "Weapon EXP" } };
const MATERIAL_TYPES = { 1: { zh: "菌类", en: "Fungus" }, 2: { zh: "晶植", en: "Crystal" }, 3: { zh: "矿物", en: "Mineral" } };
/** ClueProbabilityUp carries [clueIndex, tier]: tier 1 is the small boost, tier 2 the larger one. */
const CLUE_TIERS = { 1: { zh: "小幅提升", en: "Small boost" }, 2: { zh: "提升", en: "Boost" } };
/** Chinese names follow the game's SpaceshipRoomTypeTable verbatim; English is the site's own copy. */
const ROOMS = {
  0: { zh: "总控中枢", en: "Control center" },
  1: { zh: "制造舱", en: "Manufacturing" },
  2: { zh: "培养舱", en: "Growth" },
  3: { zh: "会客室(接待/展示)", en: "Reception (display)" },
  5: { zh: "会客室(线索)", en: "Reception (clues)" },
};
const lookUp = (table, id, what) => {
  const entry = table[id];
  if (!entry) throw new Error(`Unknown ${what} id ${id}; review the game data before syncing.`);
  return entry;
};
/** Reads one indexed parameter list (valueIntList ?? valueFloatList) from a skill. */
const paramList = (skill, index) => {
  const param = skill.parameters?.[index];
  return param?.valueIntList ?? param?.valueFloatList ?? null;
};
/**
 * The second skill parameter narrows the effect to one target:
 * ManufactureEfficiencyUp → [rate, expType], GrowSpeedUp → [rate, materialType],
 * ClueProbabilityUp → [clueIndex, tier]. Other effects have no target.
 */
function skillTarget(skill, effectKey) {
  const second = paramList(skill, 1);
  const id = Array.isArray(second) && second.length ? Number(second[0]) : null;
  if (effectKey === "ManufactureEfficiencyUp") {
    const target = lookUp(EXP_TYPES, id, "expType");
    return { targetId: id, target: target.zh, enTarget: target.en };
  }
  if (effectKey === "GrowSpeedUp") {
    const target = lookUp(MATERIAL_TYPES, id, "materialType");
    return { targetId: id, target: target.zh, enTarget: target.en };
  }
  if (effectKey === "ClueProbabilityUp") {
    const clueIndex = Number(Array.isArray(paramList(skill, 0)) ? paramList(skill, 0)[0] : NaN);
    const tier = lookUp(CLUE_TIERS, id, "clue tier");
    if (!Number.isInteger(clueIndex) || clueIndex < 1) throw new Error(`ClueProbabilityUp without clueIndex: ${skill.id}`);
    return { targetId: clueIndex, target: `线索 ${clueIndex}`, enTarget: `Clue ${clueIndex}`, clueIndex, clueTier: id, clueTierName: tier.zh, enClueTierName: tier.en };
  }
  return {};
}
const beyondRoot = `https://raw.githubusercontent.com/555me/EndfieldAssets/${assetRevision}/assets/beyond/`;
const assetRoot = `${beyondRoot}dynamicassets/`;
const manifest = [];
const downloads = new Map();
function asset(folder, name, source, sourceRoot = assetRoot) {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error("Invalid asset identifier");
  const target = `${folder}/${name}.png`;
  downloads.set(target, { target, source: sourceRoot + source });
  return `/images/game/${target}`;
}
const operators = Object.fromEntries(Object.entries(characters).filter(([id]) => id !== "chr_9000_endmin").map(([id, char]) => [id, {
  id, name: localize(char.name, zh), enName: localize(char.name, en) || char.engName, twName: localize(char.name, tw), rarity: char.rarity,
  profession: lookUp(PROFESSIONS, char.profession, "profession").zh,
  enProfession: lookUp(PROFESSIONS, char.profession, "profession").en,
  twProfession: traditional(lookUp(PROFESSIONS, char.profession, "profession").zh),
  // Illustrated round portraits; charbattleicon contains the in-battle 3D model heads.
  icon: asset("operators", `portrait_${id}`, `gameplay/ui/sprites/charroundicon/icon_round_${id}.png`),
  skills: (charSkills[id]?.skillList ?? []).map(ref => {
    const skill = skills[ref.skillId];
    if (!skill) throw new Error(`Missing skill ${ref.skillId}`);
    const node = Object.values(growth[id]?.talentNodeMap ?? {}).find(node =>
      node.nodeType === 5 && node.factorySkillNodeInfo.index === ref.skillIndex && node.factorySkillNodeInfo.level === skill.level);
    const effect = lookUp(EFFECT_TYPES, skill.effectType, "effectType");
    const room = lookUp(ROOMS, skill.roomType, "roomType");
    return { id: ref.skillId, name: localize(skill.name, zh), enName: localize(skill.name, en), twName: localize(skill.name, tw),
      description: clean(localize(skill.desc, zh)), enDescription: clean(localize(skill.desc, en)), twDescription: clean(localize(skill.desc, tw)),
      unlock: node?.factorySkillNodeInfo.breakStage ?? null, roomType: skill.roomType,
      room: room.zh, enRoom: room.en, twRoom: traditional(room.zh), effectKey: effect.key, effectName: effect.zh, enEffectName: effect.en, twEffectName: traditional(effect.zh),
      ...skillTarget(skill, effect.key),
      icon: asset("skills", skill.icon, `gameplay/ui/sprites/spaceship/spaceshipskillicon/${skill.icon}.png`) };
  }),
}]));
const weaponData = Object.fromEntries(Object.entries(weapons).map(([id, weapon]) => [id, {
  id, name: localize(items[id]?.name, zh) || id, enName: localize(items[id]?.name, en) || id, twName: localize(items[id]?.name, tw) || id, rarity: weapon.rarity,
  icon: asset("weapons", id, `gameplay/ui/sprites/itemicon/${items[id]?.iconId || id}.png`),
}]));
const workbenchSources = JSON.parse(await readFile(path.join(output, "workbench-sources.json"), "utf8"));
const workbench = Object.fromEntries(Object.entries(workbenchSources).map(([group, entries]) => [group,
  Object.fromEntries(Object.entries(entries).map(([id, entry]) => {
    const source = entry.itemId ? `dynamicassets/gameplay/ui/sprites/itemicon/${items[entry.itemId]?.iconId}.png` : entry.source;
    if (entry.itemId && !items[entry.itemId]?.iconId) throw new Error(`Missing item icon: ${entry.itemId}`);
    return [id, { icon: asset(group, id, source, beyondRoot), ...(entry.color ? { color: entry.color } : {}) }];
  })),
]));
const queue = [...downloads.values()];
if (textOnly) {
  const previous = JSON.parse(await readFile(path.join(output, "sources.json"), "utf8"));
  manifest.push(...previous.files);
  queue.length = 0;
}
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const item = queue.shift();
    const target = path.join(publicDir, item.target);
    await mkdir(path.dirname(target), { recursive: true });
    const bytes = await fetchBytes(item.source);
    if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error(`Invalid PNG: ${item.source}`);
    await writeFile(target, bytes);
    manifest.push({ ...item, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
}));
await emit("catalog.json", JSON.stringify({ operators, weapons: weaponData }, null, 2) + "\n");
// Keep complete locale text in independent chunks; metadata retains canonical
// Chinese names used by saved schedules, search aliases, and solver lookups.
const metadata = JSON.parse(JSON.stringify({ operators, weapons: weaponData }, (key, value) => /^(?:en|tw)[A-Z]/.test(key) || key === "description" ? undefined : value));
for (const [group, records] of Object.entries({ operators, weapons: weaponData })) {
  for (const [id, record] of Object.entries(records)) metadata[group][id].aliases = [...new Set([record.name, record.enName, record.twName].filter(Boolean))];
}
await emit("metadata.json", JSON.stringify(metadata, null, 2) + "\n");
for (const [locale, prefix] of [["zh-CN", ""], ["zh-TW", "tw"], ["en", "en"]]) {
  const text = {};
  for (const record of [...Object.values(operators), ...Object.values(weaponData), ...Object.values(operators).flatMap(operator => operator.skills)]) {
    text[record.id] = {};
    for (const field of ["name", "description", "profession", "room", "effectName", "target", "clueTierName"]) {
      if (!(field in record)) continue;
      const translated = prefix ? record[`${prefix}${field[0].toUpperCase()}${field.slice(1)}`] : record[field];
      text[record.id][field] = translated || (locale === "zh-TW" ? traditional(record[field]) : record[field]);
    }
  }
  await mkdir(path.join(output, "messages", locale), { recursive: true });
  await emit(`messages/${locale}/EndfieldGameData.json`, JSON.stringify(text, null, 2) + "\n");
}
await emit("workbench.json", JSON.stringify(workbench, null, 2) + "\n");
await writeGenerated(path.join(output, "sources.json"), JSON.stringify({
  data: { repository: "https://github.com/rmxlinux/EndfieldData", revision: dataRevision, tables, inputs: tableHashes },
  translations: { outputs: outputHashes, "zh-TW": { textTable: "I18nTextTable_TC", siteDefinedLabels: "OpenCC cn→twp; reviewed separately from upstream game text" } },
  assets: { repository: "https://github.com/555me/EndfieldAssets", revision: assetRevision },
  files: manifest.sort((a, b) => a.target.localeCompare(b.target)),
}, null, 2) + "\n");
console.log(`${check ? "Verified" : "Generated"} ${Object.keys(operators).length} operators, ${Object.keys(weaponData).length} weapons, ${manifest.length} local images.`);
