/* global console */
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const args = process.argv.slice(2);
const options = { check: false };
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--check") options.check = true;
  else if (["--character-table", "--uniequip-table", "--building-data", "--item-table", "--output", "--source-sha"].includes(argument)) {
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`缺少 ${argument} 参数值。`);
    options[argument.slice(2).replaceAll("-", "")] = value;
  } else throw new Error(`未知参数：${argument}`);
}
const inputPaths = {
  characterTable: options.charactertable ?? ".tmp/training-planner/character_table.json",
  uniequipTable: options.uniequiptable ?? ".tmp/training-planner/uniequip_table.json",
  buildingData: options.buildingdata ?? ".tmp/training-planner/building_data.json",
  itemTable: options.itemtable ?? ".tmp/training-planner/item_table.json",
};
const outputPath = options.output ?? "apps/arknights/src/generated/training-planner-data.json";
const sourceSha = options.sourcesha;
if (!/^[0-9a-f]{40}$/i.test(sourceSha ?? "")) {
  throw new Error("必须提供当前 ArknightsGameData 固定提交的 --source-sha。 ");
}
const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const [characters, uniequips, building, itemsTable, operatorCatalog, itemCatalog] = await Promise.all([
  read(inputPaths.characterTable),
  read(inputPaths.uniequipTable),
  read(inputPaths.buildingData),
  read(inputPaths.itemTable),
  read("packages/arknights-domain/src/generated/arkntools/operator-catalog.json"),
  read("apps/arknights/src/generated/item-catalog.json"),
]);

const costs = (entries) => (entries ?? []).map(({ id, count }) => ({ id: String(id), count }));
const operators = Object.fromEntries(operatorCatalog.flatMap(({ id }) => {
  const character = characters[id];
  if (!character) throw new Error(`Missing game data for ${id}`);
  const modules = (uniequips.charEquip[id] ?? []).flatMap((moduleId) => {
    const module = uniequips.equipDict[moduleId];
    if (!module || module.type !== "ADVANCED" || !module.itemCost) return [];
    return [{
      id: moduleId,
      name: module.uniEquipName,
      unlockLevel: module.unlockLevel ?? 0,
      costs: Object.fromEntries(Object.entries(module.itemCost).map(([level, items]) => [level, costs(items)])),
    }];
  });
  return [[id, {
    phases: character.phases.map((phase) => costs(phase.evolveCost)),
    skillLevels: (character.allSkillLvlup ?? []).map((level) => costs(level.lvlUpCost)),
    skills: (character.skills ?? []).map((skill) => ({
      id: skill.skillId,
      masteries: (skill.levelUpCostCond ?? []).map((level) => costs(level.levelUpCost)),
    })),
    modules,
  }]];
}));

const materialIds = new Set(Object.keys(itemCatalog).filter((id) => /^\d+$/.test(id)));
for (const operator of Object.values(operators)) {
  for (const phase of operator.phases) for (const item of phase) materialIds.add(item.id);
  for (const level of operator.skillLevels) for (const item of level) materialIds.add(item.id);
  for (const skill of operator.skills) for (const level of skill.masteries) for (const item of level) materialIds.add(item.id);
  for (const module of operator.modules) for (const level of Object.values(module.costs)) {
    for (const item of level) materialIds.add(item.id);
  }
}
const items = {};
for (const id of materialIds) {
  const item = itemsTable.items[id];
  if (!item) continue;
  const formula = (item.buildingProductList ?? []).flatMap((entry) => {
    const formulaSet = entry.roomType === "WORKSHOP" ? building.workshopFormulas
      : entry.roomType === "MANUFACTURE" ? building.manufactFormulas : null;
    const source = formulaSet?.[entry.formulaId];
    if (!source) return [];
    const costList = costs(source.costs);
    return [{
      facility: entry.roomType,
      level: source.requireRooms?.find((room) => room.roomId === entry.roomType)?.roomLevel ?? 1,
      output: source.count ?? 1,
      lmd: source.goldCost ?? costList.filter((cost) => cost.id === "4001").reduce((sum, cost) => sum + cost.count, 0),
      inputs: costList.filter((cost) => cost.id !== "4001"),
      stages: (source.requireStages ?? []).map((stage) => stage.stageId),
    }];
  });
  items[id] = {
    name: item.name,
    icon: itemCatalog[id]?.icon ?? `/images/items/${id}.png`,
    rarity: Number(item.rarity?.match(/TIER_(\d+)/)?.[1] ?? 0),
    drops: (item.stageDropList ?? []).slice(0, 4).map((stage) => stage.stageId),
    recipes: formula,
  };
}

const data = {
  source: {
    repository: "https://github.com/Kengxxiao/ArknightsGameData",
    commit: sourceSha,
  },
  operators,
  items,
};
const serialized = `${JSON.stringify(data)}\n`;
if (options.check) {
  const current = await readFile(outputPath, "utf8");
  if (current !== serialized) throw new Error("Training planner data is stale for the pinned ArknightsGameData source.");
} else await writeFile(outputPath, serialized);
console.log(`${options.check ? "Verified" : "Generated"} planner data for ${Object.keys(operators).length} operators and ${Object.keys(items).length} items from ${sourceSha.slice(0, 12)}.`);
