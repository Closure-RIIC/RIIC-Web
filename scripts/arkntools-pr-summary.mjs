#!/usr/bin/env node
/* global console */

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--before-operators") options.beforeOperators = argv[++index];
    else if (argument === "--before-skills") options.beforeSkills = argv[++index];
    else if (argument === "--before-gacha-up") options.beforeGachaUp = argv[++index];
    else throw new Error(`未知参数：${argument}`);
  }
  return options;
}

async function json(filePath, fallback) {
  if (!filePath) return fallback;
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return fallback;
    throw error;
  }
}

function delta(value, previous) {
  const difference = value - previous;
  return difference === 0 ? "±0" : difference > 0 ? `+${difference}` : String(difference);
}

function list(values) {
  if (values.length === 0) return "无";
  const visible = values.slice(0, 50).join("、");
  return values.length > 50 ? `${visible}，以及另外 ${values.length - 50} 项` : visible;
}

const options = parseArguments(process.argv.slice(2));
const root = process.cwd();
const generatedRoot = path.join(root, "src/generated/arkntools");
const [beforeOperators, beforeSkills, operators, skills, source] = await Promise.all([
  json(options.beforeOperators, []),
  json(options.beforeSkills, {}),
  json(path.join(generatedRoot, "operator-catalog.json"), []),
  json(path.join(generatedRoot, "building-skill-catalog.json"), {}),
  json(path.join(generatedRoot, "source.json"), null),
]);

const beforeNames = new Set(beforeOperators.map((operator) => operator.name));
const afterNames = new Set(operators.map((operator) => operator.name));
const addedOperators = [...afterNames].filter((name) => !beforeNames.has(name)).sort((left, right) => left.localeCompare(right, "zh-CN"));
const removedOperators = [...beforeNames].filter((name) => !afterNames.has(name)).sort((left, right) => left.localeCompare(right, "zh-CN"));
const beforeSkillIds = new Set(Object.keys(beforeSkills));
const afterSkillIds = new Set(Object.keys(skills));
const [beforeGachaUp, gachaUp] = await Promise.all([
  json(options.beforeGachaUp, {}),
  json(path.join(root, "src/generated/gacha-up.json"), {}),
]);
const addedPools = Object.keys(gachaUp).filter((id) => !Object.hasOwn(beforeGachaUp, id));
const changedPools = Object.keys(gachaUp).filter((id) => Object.hasOwn(beforeGachaUp, id)
  && JSON.stringify(gachaUp[id]) !== JSON.stringify(beforeGachaUp[id]));
const removedPools = Object.keys(beforeGachaUp).filter((id) => !Object.hasOwn(gachaUp, id));

console.log(`## arkntools 自动资源同步

- 数据上游：${source.source.repository}
- 数据 Commit：\`${source.source.commit}\`
- 头像来源：${source.portraitsSource?.repository}
- 头像 Commit：\`${source.portraitsSource?.commit}\`
- 干员：${source.counts.operators}（${delta(source.counts.operators, beforeOperators.length)}）
- 基建技能：${source.counts.buildingSkills}（${delta(source.counts.buildingSkills, beforeSkillIds.size)}）
- 干员头像：${source.counts.portraits}
- 去重后的基建技能图标：${source.counts.buildingSkillIcons}
- 产物图标：${source.counts.productIcons}
- 新增干员：${list(addedOperators)}
- 移除干员：${list(removedOperators)}
- 新增技能定义：${[...afterSkillIds].filter((id) => !beforeSkillIds.has(id)).length}
- 移除技能定义：${[...beforeSkillIds].filter((id) => !afterSkillIds.has(id)).length}
- 卡池 UP 数据来源：https://weedy.prts.wiki/gacha_table.json
- 卡池开放日期来源：Kengxxiao/ArknightsGameData（国服）
- 卡池 UP 名单：${Object.keys(gachaUp).length}（${delta(Object.keys(gachaUp).length, Object.keys(beforeGachaUp).length)}）
- 新增卡池 UP：${list(addedPools)}
- 调整卡池 UP：${list(changedPools)}
- 移除卡池 UP：${list(removedPools)}

同步工作流已执行资源完整性检查、lint、单元测试、API 契约测试和生产构建；发布到 main 并同步 develop 时，纯干员与卡池数据更新沿用数据发布通道，跳过浏览器 E2E，保留其他质量门禁、构建和部署健康检查。

本 PR 只修改当前前端仓库的受管资源，不会向 arkntools 仓库写入内容。`);
