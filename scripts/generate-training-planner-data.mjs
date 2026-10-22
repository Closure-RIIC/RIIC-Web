/* global console */
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const args = process.argv.slice(2);
const valueFor = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const inputPaths = {
  characterTable: valueFor("--character-table", ".tmp/training-planner/character_table.json"),
  uniequipTable: valueFor("--uniequip-table", ".tmp/training-planner/uniequip_table.json"),
  buildingData: valueFor("--building-data", ".tmp/training-planner/building_data.json"),
  itemTable: valueFor("--item-table", ".tmp/training-planner/item_table.json"),
};
const outputPath = valueFor("--output", "apps/arknights/src/generated/training-planner-data.json");
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
    commit: "bee3f83c5d60590b5e1cd42b8d09d00ce32ab10d",
  },
  operators,
  items,
};
await writeFile(outputPath, `${JSON.stringify(data)}\n`);
console.log(`Generated planner data for ${Object.keys(operators).length} operators and ${Object.keys(items).length} items.`);
