import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL, pathToFileURL, fileURLToPath } from "node:url";
import process from "node:process";
import console from "node:console";
import { loadEndfieldTables } from "./endfield-upstream.mjs";
import { writeGenerated } from "./i18n/write-generated.mjs";

// Only reviewed operator additions are regenerated; facility formulas retain their own snapshot.
const operatorIds = ["chr_0037_minghe"];
const tableNames = ["CharacterTable", "CharGrowthTable", "SpaceshipCharSkillTable", "SpaceshipSkillTable", "I18nTextTable_CN"];

export function solverOperator(id, tables, ship) {
  const char = tables.CharacterTable[id];
  const refs = tables.SpaceshipCharSkillTable[id];
  assert.ok(char && refs?.skillList?.length, `Missing schedulable operator: ${id}`);
  const text = field => {
    const value = tables.I18nTextTable_CN[field?.id] || field?.text;
    assert.ok(typeof value === "string" && value.length, `${id}: missing localized text`);
    return value;
  };
  const label = (key, value, name) => {
    const known = ship.operators.find(op => op[key] === value);
    assert.ok(known?.[name], `${id}: unknown ${key} ${value}`);
    return known[name];
  };
  return {
    charId: id, name: text(char.name), enName: char.engName, rarity: char.rarity,
    profession: char.profession, professionName: label("profession", char.profession, "professionName"),
    charType: char.charTypeId, charTypeName: label("charType", char.charTypeId, "charTypeName"),
    weaponType: char.weaponType, weaponTypeName: label("weaponType", char.weaponType, "weaponTypeName"),
    sortOrder: char.sortOrder, department: char.department, maxSkillCount: refs.maxSkillCount,
    shipSkills: refs.skillList.map(ref => {
      const skill = tables.SpaceshipSkillTable[ref.skillId];
      assert.ok(skill, `Missing skill: ${ref.skillId}`);
      const nodes = Object.values(tables.CharGrowthTable[id]?.talentNodeMap ?? {}).filter(node =>
        node.nodeType === 5 && node.factorySkillNodeInfo.index === ref.skillIndex && node.factorySkillNodeInfo.level === skill.level);
      assert.equal(nodes.length, 1, `${ref.skillId}: ambiguous or missing unlock node`);
      const unlock = nodes[0].factorySkillNodeInfo.breakStage;
      assert.ok(Number.isInteger(unlock) && unlock >= 0 && unlock <= 4, `${ref.skillId}: invalid unlock`);
      const effectType = ship.enums.effectType[skill.effectType];
      assert.ok(effectType, `${ref.skillId}: unknown effect`);
      // Float32 dumps contain representation noise; these existing percentage skills use 2 decimal places.
      const rawParams = skill.parameters.map(param => {
        const values = param.valueIntList ?? param.valueFloatList;
        assert.ok(Array.isArray(values) && values.length === 1 && Number.isFinite(values[0]), `${ref.skillId}: invalid parameter`);
        const rounded = Math.round(values[0] * 100) / 100;
        assert.ok(Math.abs(values[0] - rounded) < 1e-7, `${ref.skillId}: review a higher precision effect`);
        return rounded;
      });
      assert.ok([1, 7].includes(skill.effectType), `${ref.skillId}: review new effect decoding`);
      assert.equal(rawParams.length, skill.effectType === 7 ? 2 : 1);
      assert.ok(rawParams[0] > 0 && rawParams[0] <= 1, `${ref.skillId}: invalid rate`);
      const effect = { type: skill.effectType, key: effectType.key, cn: effectType.cn, rate: rawParams[0] };
      if (skill.effectType === 7) {
        assert.ok(ship.enums.expType[rawParams[1]], `${ref.skillId}: unknown EXP type`);
        Object.assign(effect, { expType: rawParams[1], expTypeName: ship.enums.expType[rawParams[1]] });
      }
      const roomName = ship.enums.roomType[skill.roomType]?.name;
      assert.ok(roomName, `${ref.skillId}: unknown room`);
      return { slot: ref.skillIndex + 1, roomType: skill.roomType, roomName, skillId: ref.skillId,
        name: text(skill.name), talentName: text(skill.talentName), level: skill.level, postfix: skill.skillNamePostfix,
        icon: skill.icon, desc: text(skill.desc), effect, rawParams, unlock };
    }),
  };
}

async function main() {
  const { tableData, provenance } = await loadEndfieldTables(tableNames, { offline: process.argv.includes("--offline") || process.argv.includes("--check") });
  const file = new URL("../packages/endfield-solver/data/ship-data.json", import.meta.url);
  const ship = JSON.parse(await readFile(file, "utf8"));
  for (const id of operatorIds) {
    const operator = solverOperator(id, tableData, ship);
    const index = ship.operators.findIndex(op => op.charId === id);
    if (index < 0) ship.operators.push(operator); else ship.operators[index] = operator;
  }
  ship.meta.operatorUpdates = { ...provenance, operatorIds };
  await writeGenerated(fileURLToPath(file), JSON.stringify(ship, null, 2) + "\n");
  console.log(`${process.argv.includes("--check") ? "Verified" : "Generated"} ${operatorIds.length} reviewed solver operator(s).`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
