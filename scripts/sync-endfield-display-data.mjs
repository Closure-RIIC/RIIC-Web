/* global fetch, AbortSignal, Buffer, console */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";

// Deliberately pinned: upstream updates are reviewed independently of solver updates.
const dataRevision = "8b955ea78c6f04b6e5164b75f63f46b503c5f6f2";
const assetRevision = "659fa8d40061616433722bdd803ef432e887f89e";
const root = fileURLToPath(new URL("../", import.meta.url));
const cache = path.join(root, ".tmp/endfield-upstream", dataRevision);
const output = path.join(root, "packages/endfield-data");
const publicDir = path.join(root, "apps/endfield/public/images/game");
const tables = ["CharacterTable", "CharGrowthTable", "WeaponBasicTable", "ItemTable", "SpaceshipCharSkillTable", "SpaceshipSkillTable", "I18nTextTable_CN", "I18nTextTable_EN"];
await mkdir(cache, { recursive: true });
await mkdir(output, { recursive: true });

async function fetchBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Upstream ${response.status}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
// Text IDs exceed Number.MAX_SAFE_INTEGER. Retain the original JSON token.
const parse = text => JSON.parse(text, (_key, value, context) =>
  typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value) ? context.source : value);
const tableData = {};
for (const name of tables) {
  const file = path.join(cache, `${name}.json`);
  let bytes;
  try { bytes = await readFile(file); }
  catch {
    bytes = await fetchBytes(`https://raw.githubusercontent.com/rmxlinux/EndfieldData/${dataRevision}/TableCfg/${name}.json`);
    await writeFile(file, bytes);
  }
  tableData[name] = parse(bytes.toString("utf8"));
}
const { CharacterTable: characters, CharGrowthTable: growth, WeaponBasicTable: weapons, ItemTable: items,
  SpaceshipCharSkillTable: charSkills, SpaceshipSkillTable: skills, I18nTextTable_CN: zh, I18nTextTable_EN: en } = tableData;
const localize = (field, dict) => field?.text || dict[field?.id] || "";
const clean = text => text.replace(/<[^>]*>/g, "");
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
  id, name: localize(char.name, zh), enName: localize(char.name, en) || char.engName, rarity: char.rarity,
  // Illustrated round portraits; charbattleicon contains the in-battle 3D model heads.
  icon: asset("operators", `portrait_${id}`, `gameplay/ui/sprites/charroundicon/icon_round_${id}.png`),
  skills: (charSkills[id]?.skillList ?? []).map(ref => {
    const skill = skills[ref.skillId];
    if (!skill) throw new Error(`Missing skill ${ref.skillId}`);
    const node = Object.values(growth[id]?.talentNodeMap ?? {}).find(node =>
      node.nodeType === 5 && node.factorySkillNodeInfo.index === ref.skillIndex && node.factorySkillNodeInfo.level === skill.level);
    return { id: ref.skillId, name: localize(skill.name, zh), enName: localize(skill.name, en),
      description: clean(localize(skill.desc, zh)), enDescription: clean(localize(skill.desc, en)),
      unlock: node?.factorySkillNodeInfo.breakStage ?? null, roomType: skill.roomType,
      icon: asset("skills", skill.icon, `gameplay/ui/sprites/spaceship/spaceshipskillicon/${skill.icon}.png`) };
  }),
}]));
const weaponData = Object.fromEntries(Object.entries(weapons).map(([id, weapon]) => [id, {
  id, name: localize(items[id]?.name, zh) || id, enName: localize(items[id]?.name, en) || id, rarity: weapon.rarity,
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
await writeFile(path.join(output, "catalog.json"), JSON.stringify({ operators, weapons: weaponData }, null, 2) + "\n");
await writeFile(path.join(output, "workbench.json"), JSON.stringify(workbench, null, 2) + "\n");
await writeFile(path.join(output, "sources.json"), JSON.stringify({
  data: { repository: "https://github.com/rmxlinux/EndfieldData", revision: dataRevision, tables },
  assets: { repository: "https://github.com/555me/EndfieldAssets", revision: assetRevision },
  files: manifest.sort((a, b) => a.target.localeCompare(b.target)),
}, null, 2) + "\n");
console.log(`Generated ${Object.keys(operators).length} operators, ${Object.keys(weaponData).length} weapons, ${manifest.length} local images.`);
