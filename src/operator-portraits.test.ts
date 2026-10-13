import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import sourceManifest from "./generated/arkntools/source.json" with { type: "json" };
import {
  BUILDING_SKILL_CATALOG,
  OPERATOR_CATALOG,
  PROFESSION_LABELS,
  PROFESSION_LABELS_ENGLISH,
  buildingSkillUnlockLabel,
  buildingSkillUnlockLabelEnglish,
  buildingSkillUnlockPrefix,
  isBuildingSkillEnhanced,
  operatorBuildingSkillList,
  operatorPortraitFor,
  operatorPresentationFor,
  operatorProfessionFor,
  operatorProfessionLabelEnglishForCode,
  operatorProfessionPresentation,
} from "./operatorPortraits.ts";

const portraitManifest: { version: number; portraitsFallback?: { commit: string; operators: string[] } } = sourceManifest;
const fallbackPortraits = portraitManifest.portraitsFallback;
const portraitPath = (shortId: string) => {
  const commit = fallbackPortraits?.operators.includes(`char_${shortId}`)
    ? fallbackPortraits.commit : sourceManifest.portraitsSource.commit;
  return `/images/operator-portraits/${shortId}.webp?v=${sourceManifest.version}-${commit.slice(0, 12)}`;
};

test("building skill icons use the source revision and resolve to existing public assets", () => {
  const version = `${sourceManifest.version}-${sourceManifest.source.commit.slice(0, 12)}`;
  assert.ok(Object.keys(BUILDING_SKILL_CATALOG).length > 0);
  for (const skill of Object.values(BUILDING_SKILL_CATALOG)) {
    const url = new URL(skill.icon, "https://example.test");
    assert.match(url.pathname, /^\/images\/building-skills\/.+\.png$/);
    assert.equal(url.searchParams.get("v"), version, skill.id);
    assert.equal(url.searchParams.size, 1, skill.id);
    assert.ok(existsSync(new URL(`../public${url.pathname}`, import.meta.url)), skill.icon);
  }
  assert.equal(
    operatorPresentationFor({ name: "阿米娅", skill: 1 }).buildingSkill?.icon,
    operatorBuildingSkillList("阿米娅")[0].icon,
  );
});

test("resolves portraits by stable id before display name and keeps planner aliases", () => {
  const amiyaPortrait = portraitPath("002_amiya");
  assert.equal(operatorPortraitFor("名称可以不同", "char_002_amiya"), amiyaPortrait);
  assert.equal(operatorPortraitFor("阿米娅(近卫)"), amiyaPortrait);
  assert.equal(operatorPortraitFor("阿米娅(医疗)"), amiyaPortrait);
  assert.equal(operatorPortraitFor("嘉辛塔"), portraitPath("4237_jcinta"));
  assert.equal(operatorPortraitFor("不存在的干员"), undefined);
});

test("maps the one-based planner skill index to presentation-only building skill data", () => {
  const presentation = operatorPresentationFor({ name: "阿米娅", skill: 1 });
  assert.equal(presentation.operator?.id, "char_002_amiya");
  assert.equal(presentation.buildingSkill?.index, 1);
  assert.equal(presentation.buildingSkill?.name, "合作协议");
  assert.match(presentation.buildingSkill?.description ?? "", /所有贸易站订单效率\+7%/);
  assert.doesNotMatch(presentation.buildingSkill?.description ?? "", /<[^>]*>/);
  assert.equal(operatorPresentationFor({ name: "阿米娅", skill: 99 }).buildingSkill, undefined);
});

test("resolves numeric profession codes to labeled icons for every cataloged operator", () => {
  assert.deepEqual(operatorProfessionFor("阿米娅"), 6);
  assert.deepEqual(operatorProfessionPresentation("阿米娅"), { label: "术师", icon: "/images/profession/术师.webp" });
  for (const operator of OPERATOR_CATALOG) {
    const profession = operatorProfessionFor(operator.name);
    assert.equal(profession, operator.profession);
    assert.ok(PROFESSION_LABELS[profession as number]);
    assert.equal(operatorProfessionPresentation(operator.name)?.icon, `/images/profession/${PROFESSION_LABELS[profession as number]}.webp`);
  }
  assert.equal(operatorProfessionFor("不存在的干员"), undefined);
  assert.equal(operatorProfessionPresentation("不存在的干员"), undefined);
});

test("maps numeric profession codes to English labels", () => {
  assert.equal(operatorProfessionLabelEnglishForCode(1), "Guard");
  assert.equal(operatorProfessionLabelEnglishForCode(8), "Vanguard");
  assert.equal(PROFESSION_LABELS_ENGLISH[6], "Caster");
  assert.equal(operatorProfessionLabelEnglishForCode(undefined), undefined);
});

test("marks the higher-index skill of a same-prefix pair as enhanced", () => {
  const refs = [
    { index: 1, id: "trade_ord_wt&cost_002", elite: 0, level: 1 },
    { index: 2, id: "trade_ord_wt&cost_012", elite: 2, level: 1 },
  ];
  assert.equal(isBuildingSkillEnhanced(refs, refs[0]), false);
  assert.equal(isBuildingSkillEnhanced(refs, refs[1]), true);
  assert.equal(isBuildingSkillEnhanced(refs, { index: 9, id: "unrelated_id", elite: 2, level: 1 }), false);
  // 同干员只有一个该前缀技能时不算提升
  assert.equal(isBuildingSkillEnhanced([refs[1]], refs[1]), false);
});

test("pairs skills by prefix regardless of elite (桑葚 hire_spd_cost_100 → _110)", () => {
  const refs = [
    { index: 1, id: "hire_spd_cost_100", elite: 0, level: 1 },
    { index: 2, id: "hire_spd_cost_110", elite: 1, level: 1 },
  ];
  assert.equal(isBuildingSkillEnhanced(refs, refs[1]), true);
  assert.equal(isBuildingSkillEnhanced(refs, refs[0]), false);
});

test("flags both of 芙兰卡's same-prefix higher-index skills (后缀可多字符不同)", () => {
  const refs = [
    { index: 1, id: "train_spd&profession_020", elite: 0, level: 1 },
    { index: 2, id: "train_spd&profession_021", elite: 2, level: 1 },
    { index: 3, id: "meet_spd&team_000", elite: 0, level: 1 },
    { index: 4, id: "meet_spd&team_031", elite: 2, level: 1 },
  ];
  assert.equal(isBuildingSkillEnhanced(refs, refs[0]), false);
  assert.equal(isBuildingSkillEnhanced(refs, refs[1]), true);
  assert.equal(isBuildingSkillEnhanced(refs, refs[2]), false);
  assert.equal(isBuildingSkillEnhanced(refs, refs[3]), true);
});

test("flags every skill above the minimum index in a three-skill prefix group (赫拉格)", () => {
  const refs = [
    { index: 1, id: "dorm_rec_all&oneself_010", elite: 0, level: 1 },
    { index: 2, id: "dorm_rec_all&oneself_011", elite: 1, level: 1 },
    { index: 3, id: "dorm_rec_all&oneself_012", elite: 2, level: 1 },
  ];
  assert.equal(isBuildingSkillEnhanced(refs, refs[0]), false);
  assert.equal(isBuildingSkillEnhanced(refs, refs[1]), true);
  assert.equal(isBuildingSkillEnhanced(refs, refs[2]), true);
});

test("renders the elite-2 提升 label for enhanced skills", () => {
  assert.equal(buildingSkillUnlockLabel(0, 1), "初始解锁");
  assert.equal(buildingSkillUnlockLabel(0, 3), "等级 3 解锁");
  assert.equal(buildingSkillUnlockLabel(2, 1), "精英 2 解锁");
  assert.equal(buildingSkillUnlockLabel(2, 3), "精英 2 · 等级 3 解锁");
  assert.equal(buildingSkillUnlockLabel(2, 1, true), "精英 2 提升");
  assert.equal(buildingSkillUnlockLabel(2, 3, true), "精英 2 · 等级 3 提升");
  assert.equal(buildingSkillUnlockPrefix(2, 1), "精英 2 ");
  assert.equal(buildingSkillUnlockLabelEnglish(0, 1), "Initial unlock");
  assert.equal(buildingSkillUnlockLabelEnglish(0, 3), "Level 3 unlock");
  assert.equal(buildingSkillUnlockLabelEnglish(2, 1), "Elite 2 unlock");
  assert.equal(buildingSkillUnlockLabelEnglish(2, 3, true), "Elite 2 · Level 3 upgrade");

  // operatorPresentationFor 的展示结果带上 enhanced 标记
  assert.equal(operatorPresentationFor({ name: "折光", skill: 2 }).buildingSkill?.enhanced, true);
  assert.equal(operatorPresentationFor({ name: "折光", skill: 1 }).buildingSkill?.enhanced, false);
});

test("resolves an operator's full building skill list sorted by index", () => {
  const skills = operatorBuildingSkillList("折光");
  assert.deepEqual(skills.map((skill) => [skill.index, skill.enhanced]), [[1, false], [2, true]]);
  for (const skill of skills) {
    assert.ok(skill.name.length > 0);
    assert.ok(skill.description.length > 0);
    assert.match(skill.icon, /^\/images\//);
  }
  assert.deepEqual(operatorBuildingSkillList("不存在的干员"), []);
});

test("same-prefix enhanced pairs are detected across the catalog", () => {
  const enhancedByOperator = new Map<string, string[]>();
  for (const operator of OPERATOR_CATALOG) {
    const flagged: string[] = [];
    for (const ref of operator.buildingSkills) {
      if (isBuildingSkillEnhanced(operator.buildingSkills, ref)) flagged.push(ref.id);
    }
    if (flagged.length) enhancedByOperator.set(operator.name, flagged);
  }
  // 折光、桑葚、芙兰卡都按同前缀规则判为提升
  assert.ok(enhancedByOperator.get("折光")?.includes("trade_ord_wt&cost_012"));
  assert.ok(enhancedByOperator.get("桑葚")?.includes("hire_spd_cost_110"));
  assert.ok(enhancedByOperator.get("芙兰卡")?.includes("meet_spd&team_031"));
  // 赫拉格三阶段：index 1 之外的后两个都是提升
  assert.ok(enhancedByOperator.get("赫拉格")?.includes("dorm_rec_all&oneself_011"));
  assert.ok(enhancedByOperator.get("赫拉格")?.includes("dorm_rec_all&oneself_012"));
  assert.ok(!enhancedByOperator.get("赫拉格")?.includes("dorm_rec_all&oneself_010"));
  assert.ok(enhancedByOperator.size >= 100);
});

test("generated catalog has unique ids, names, and matching stable portrait paths", () => {
  assert.ok(OPERATOR_CATALOG.length >= 400);
  assert.equal(new Set(OPERATOR_CATALOG.map((operator) => operator.id)).size, OPERATOR_CATALOG.length);
  assert.equal(new Set(OPERATOR_CATALOG.map((operator) => operator.name)).size, OPERATOR_CATALOG.length);
  for (const operator of OPERATOR_CATALOG) {
    assert.match(operator.id, /^char_[A-Za-z0-9_&]+$/);
    assert.equal(operator.portrait, portraitPath(operator.id.slice(5)));
  }
});

test("fallback portraits are tied to the toolbox revision and real catalog entries", () => {
  if (!fallbackPortraits) return;
  assert.equal(fallbackPortraits.commit, sourceManifest.source.commit);
  assert.equal(new Set(fallbackPortraits.operators).size, fallbackPortraits.operators.length);
  for (const id of fallbackPortraits.operators) {
    const operator = OPERATOR_CATALOG.find((entry) => entry.id === id);
    assert.ok(operator, `Fallback portrait must belong to a catalog operator: ${id}`);
    assert.equal(operatorPortraitFor(operator.name), portraitPath(id.slice(5)));
    assert.ok(existsSync(`public/images/operator-portraits/${id.slice(5)}.webp`));
  }
});
