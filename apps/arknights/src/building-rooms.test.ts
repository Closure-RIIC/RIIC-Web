import assert from "node:assert/strict";
import test from "node:test";
import pinyinNames from "@riic/arknights-domain/generated/arkntools/operator-pinyin.json" with { type: "json" };

import {
  BUILDING_ROOM_LABELS,
  BUILDING_ROOM_PREFIXES,
  ROOM_SKILL_TAGS,
  buildingRoomPrefixForSkillId,
  filterOperators,
  operatorMatchesRoom,
  operatorMatchesNameContains,
  operatorMatchesTag,
  type BuildingRoomPrefix,
  type OperatorWithSkills,
  type SkillRecordLookup,
} from "./building-rooms.ts";
import { BUILDING_SKILL_CATALOG, OPERATOR_CATALOG } from "./operatorPortraits.ts";

const TAGS: Record<string, string[]> = {
  control_x: ["生产力"],
  dorm_y: [],
  manu_x: ["生产力"],
  manu_y: [],
};

const realSkillLookup: SkillRecordLookup = (skillId) => BUILDING_SKILL_CATALOG[skillId];

test("intersects rarity and profession with room, tag and search, without changing order", () => {
  const operators = [
    { name: "Alpha", rarity: 6, profession: 1, order: 1, buildingSkills: [{ id: "manu_x" }] },
    { name: "Beta", rarity: 5, profession: 1, order: 2, buildingSkills: [{ id: "manu_x" }] },
    { name: "Gamma", rarity: 6, profession: 2, order: 3, buildingSkills: [{ id: "manu_x" }] },
    { name: "Delta", rarity: 6, profession: 1, order: 4, buildingSkills: [{ id: "control_x" }] },
  ];
  const lookup: SkillRecordLookup = (id) => ({ tags: TAGS[id] ?? [] });
  const names = (filters: { rarity?: number | null; profession?: number | null }) => filterOperators(operators, null, null, "", lookup, filters).map((o) => o.name);
  assert.deepEqual(names({ rarity: 6 }), ["Delta", "Gamma", "Alpha"]);
  assert.deepEqual(names({ profession: 1 }), ["Delta", "Beta", "Alpha"]);
  assert.deepEqual(names({ rarity: 6, profession: 1 }), ["Delta", "Alpha"]);
  assert.deepEqual(names({ rarity: null, profession: null }), ["Delta", "Gamma", "Beta", "Alpha"]);
  assert.deepEqual(filterOperators(operators, "manu", "生产力", "alp", lookup, { rarity: 6, profession: 1 }).map((o) => o.name), ["Alpha"]);
  assert.deepEqual(filterOperators(operators, "manu", "生产力", "Beta", lookup, { rarity: 6, profession: 1 }), []);
  assert.deepEqual(names({ rarity: 1 }), []);
});

test("derives the building-room prefix from the skill id's first underscore segment", () => {
  assert.equal(buildingRoomPrefixForSkillId("control_tra_spd_000"), "control");
  assert.equal(buildingRoomPrefixForSkillId("manu_spd_000"), "manu");
  assert.equal(buildingRoomPrefixForSkillId("workshop_formula_cost_000"), "workshop");
  for (const prefix of BUILDING_ROOM_PREFIXES) {
    assert.equal(buildingRoomPrefixForSkillId(`${prefix}_anything_000`), prefix);
  }
  assert.equal(buildingRoomPrefixForSkillId("bank_x"), null);
  assert.equal(buildingRoomPrefixForSkillId("no-underscore"), null);
});

test("maps the ten room prefixes to their Chinese labels", () => {
  const expected: Readonly<Record<BuildingRoomPrefix, string>> = {
    control: "控制中枢",
    power: "发电站",
    manu: "制造站",
    trade: "贸易站",
    dorm: "宿舍",
    hire: "办公室",
    meet: "会客室",
    train: "训练室",
    workshop: "加工站",
    recycle: "回收站",
  };
  assert.deepEqual({ ...BUILDING_ROOM_LABELS }, expected);
  assert.equal(BUILDING_ROOM_PREFIXES.length, 10);
  assert.equal(new Set(BUILDING_ROOM_PREFIXES).size, 10);
  assert.deepEqual([...BUILDING_ROOM_PREFIXES].sort(), [...Object.keys(expected)].sort());
});

test("recycling room and conversion tag match the real recycling skills", () => {
  assert.equal(buildingRoomPrefixForSkillId("recycle_spd&cost_000"), "recycle");
  const operators = filterOperators(OPERATOR_CATALOG, "recycle", "转化效率", "", realSkillLookup);
  assert.ok(operators.some(operator => operator.name === "旅骨"));
  assert.ok(operators.every(operator => operator.buildingSkills.some(skill => skill.id.startsWith("recycle_"))));
});

test("filters operators by a single room prefix", () => {
  assert.equal(operatorMatchesRoom([], null), true);
  assert.equal(operatorMatchesRoom(["control_x"], null), true);
  assert.equal(operatorMatchesRoom(["control_x"], "control"), true);
  assert.equal(operatorMatchesRoom(["manu_x"], "control"), false);
  assert.equal(operatorMatchesRoom(["manu_x", "control_y"], "control"), true);
  assert.equal(operatorMatchesRoom(["manu_x", "control_y"], "dorm"), false);
  assert.equal(operatorMatchesRoom([], "control"), false);
});

test("matches a tag only on skills in the selected room", () => {
  const lookup: SkillRecordLookup = (id) => ({ tags: TAGS[id] ?? [] });
  assert.equal(operatorMatchesTag([], null, "生产力", lookup), false);
  assert.equal(operatorMatchesTag(["control_x"], null, null, lookup), true);
  assert.equal(operatorMatchesTag(["control_x"], null, "生产力", lookup), true);
  assert.equal(operatorMatchesTag(["control_x"], "manu", "生产力", lookup), false);
  assert.equal(operatorMatchesTag(["manu_x", "control_x"], "control", "生产力", lookup), true);
  assert.equal(operatorMatchesTag(["manu_x", "control_x"], "manu", "生产力", lookup), true);
  assert.equal(operatorMatchesTag(["manu_y", "control_x"], "manu", "生产力", lookup), false);
  assert.equal(operatorMatchesTag(["manu_y"], "manu", "生产力", lookup), false);
});

test("matches operator names by case-insensitive trimmed substring", () => {
  assert.equal(operatorMatchesNameContains("阿米娅", ""), true);
  assert.equal(operatorMatchesNameContains("阿米娅", "   "), true);
  assert.equal(operatorMatchesNameContains("阿米娅", "阿"), true);
  assert.equal(operatorMatchesNameContains("阿米娅", "米"), true);
  assert.equal(operatorMatchesNameContains("阿米娅", "能"), false);
  assert.equal(operatorMatchesNameContains("THRM-EX", "thrm"), true);
  assert.equal(operatorMatchesNameContains("阿米娅", " 米 "), true);
});

test("combines room and name-substring filters with AND and sorts by name", () => {
  const operators: OperatorWithSkills[] = [
    { name: "阿米娅", buildingSkills: [{ id: "control_x" }, { id: "dorm_y" }] },
    { name: "能天使", buildingSkills: [{ id: "manu_x" }] },
    { name: "阿能", buildingSkills: [{ id: "manu_y" }] },
  ];
  const lookup: SkillRecordLookup = (id) => ({ tags: TAGS[id] ?? [] });
  assert.deepEqual(filterOperators(operators, "manu", null, "阿", lookup).map((operator) => operator.name), ["阿能"]);
  assert.deepEqual(filterOperators(operators, "control", null, "", lookup).map((operator) => operator.name), ["阿米娅"]);
  assert.deepEqual(filterOperators(operators, "control", "生产力", "", lookup).map((operator) => operator.name), ["阿米娅"]);
  assert.deepEqual(filterOperators(operators, "control", "订单效率", "", lookup), []);
  assert.deepEqual(filterOperators(operators, "manu", "生产力", "", lookup).map((operator) => operator.name), ["能天使"]);
  assert.deepEqual(filterOperators(operators, "manu", "生产力", "阿", lookup), []);
  assert.deepEqual(filterOperators(operators, "trade", null, "阿", lookup), []);
  assert.deepEqual(filterOperators(operators, null, null, "能", lookup).map((operator) => operator.name), ["阿能", "能天使"]);
  assert.deepEqual(filterOperators(operators, null, "生产力", "", lookup).map((operator) => operator.name), ["阿米娅", "能天使"]);
  const all = filterOperators(operators, null, null, "", lookup).map((operator) => operator.name);
  assert.equal(all.length, 3);
  assert.ok(all.includes("阿米娅") && all.includes("阿能") && all.includes("能天使"));
});

test("regional name aliases preserve canonical operators and optional custom names", () => {
  const operators: OperatorWithSkills[] = [
    { name: "能天使", buildingSkills: [{ id: "control_x" }] },
    { name: "阿米娅", buildingSkills: [{ id: "control_x" }] },
  ];
  const lookup: SkillRecordLookup = () => ({});
  assert.deepEqual(filterOperators(operators, null, null, "Exusiai", lookup), [operators[0]]);
  assert.deepEqual(filterOperators(operators, null, null, "阿米婭", lookup), [operators[1]]);
  assert.deepEqual(filterOperators(operators, null, null, "custom operator alias", lookup), []);
  assert.deepEqual(filterOperators(operators, null, null, "custom operator alias", lookup, { englishNames: { "能天使": "custom operator alias" } }), [operators[0]]);
});

test("supports Chinese operator-name fuzzy search with initials and full pinyin", () => {
  const operators: OperatorWithSkills[] = [
    { name: "阿米娅", buildingSkills: [{ id: "control_x" }] },
    { name: "能天使", buildingSkills: [{ id: "manu_x" }] },
  ];
  const lookup: SkillRecordLookup = () => ({});
  assert.deepEqual(filterOperators(operators, null, null, "amy", lookup, { pinyinNames }).map((operator) => operator.name), ["阿米娅"]);
  assert.deepEqual(filterOperators(operators, null, null, "amiya", lookup, { pinyinNames }).map((operator) => operator.name), ["阿米娅"]);
  assert.deepEqual(filterOperators(operators, null, null, "nts", lookup, { pinyinNames }).map((operator) => operator.name), ["能天使"]);
});

test("keeps both pinyin readings for 仇白", () => {
  const operators: OperatorWithSkills[] = [{ name: "仇白", buildingSkills: [{ id: "control_x" }] }];
  const lookup: SkillRecordLookup = () => ({});
  assert.deepEqual(filterOperators(operators, null, null, "choubai", lookup, { pinyinNames }).map((operator) => operator.name), ["仇白"]);
  assert.deepEqual(filterOperators(operators, null, null, "qiubai", lookup, { pinyinNames }).map((operator) => operator.name), ["仇白"]);
});

test("matches queries against skill names and plain-text descriptions", () => {
  const operators: OperatorWithSkills[] = [
    { name: "阿米娅", buildingSkills: [{ id: "control_x" }] },
    { name: "能天使", buildingSkills: [{ id: "manu_x" }] },
  ];
  const lookup: SkillRecordLookup = (id) => ({
    control_x: { name: "合作协议", description: "进驻控制中枢时，所有贸易站订单效率+7%" },
    manu_x: { name: "金属工艺·β", description: "进驻制造站时，贵金属类产物生产力+35%" },
  }[id]);
  assert.deepEqual(filterOperators(operators, null, null, "合作协议", lookup).map((operator) => operator.name), ["阿米娅"]);
  assert.deepEqual(filterOperators(operators, null, null, "贵金属", lookup).map((operator) => operator.name), ["能天使"]);
  assert.deepEqual(filterOperators(operators, null, null, "贸易站", lookup).map((operator) => operator.name), ["阿米娅"]);
  assert.deepEqual(filterOperators(operators, null, null, "不存在的词", lookup), []);
  // 技能文本搜索与房间条件仍取交集。
  assert.deepEqual(filterOperators(operators, "manu", null, "贸易站", lookup), []);
});

test("room skill tag options cover every room prefix without duplicates", () => {
  assert.deepEqual(Object.keys(ROOM_SKILL_TAGS).sort(), [...BUILDING_ROOM_PREFIXES].sort());
  for (const tags of Object.values(ROOM_SKILL_TAGS)) {
    assert.ok(Array.isArray(tags));
    assert.equal(new Set(tags).size, tags.length);
  }
});

test("default browse order follows the data warehouse order in reverse", () => {
  const operators: OperatorWithSkills[] = [
    { name: "能天使", order: 0, buildingSkills: [{ id: "manu_x" }] },
    { name: "阿米娅", order: 2, buildingSkills: [{ id: "control_x" }] },
    { name: "阿能", order: 1, buildingSkills: [{ id: "manu_y" }] },
  ];
  assert.deepEqual(filterOperators(operators, null, null, "", () => ({})).map((operator) => operator.name), ["阿米娅", "阿能", "能天使"]);
  // 带搜索词时仍按名字排序，便于查找。
  assert.deepEqual(filterOperators(operators, null, null, "阿", () => ({})).map((operator) => operator.name), ["阿米娅", "阿能"]);
});

test("filters the real catalog by substring query", () => {
  const names = filterOperators(OPERATOR_CATALOG, null, null, "黑角", realSkillLookup).map((operator) => operator.name);
  assert.ok(names.includes("黑角"));
  assert.ok(names.every((name) => name.includes("黑角")));
});

test("filters the real catalog by control room and productivity tag", () => {
  const names = filterOperators(OPERATOR_CATALOG, "control", "生产力", "", realSkillLookup).map((operator) => operator.name);
  assert.ok(names.length > 0);
  for (const name of names) {
    const operator = OPERATOR_CATALOG.find((candidate) => candidate.name === name);
    assert.ok(operator, `缺少干员 ${name}`);
    assert.ok(
      operator.buildingSkills.some(
        (skill) => skill.id.startsWith("control_") && (realSkillLookup(skill.id)?.tags ?? []).includes("生产力"),
      ),
      `干员 ${name} 没有控制中枢的生产力标签技能`,
    );
  }
});

test("filters the real catalog by skill name and description text", () => {
  const byName = filterOperators(OPERATOR_CATALOG, null, null, "合作协议", realSkillLookup).map((operator) => operator.name);
  assert.ok(byName.includes("阿米娅"));
  for (const name of byName) {
    const operator = OPERATOR_CATALOG.find((candidate) => candidate.name === name);
    assert.ok(operator, `缺少干员 ${name}`);
    assert.ok(
      operator.buildingSkills.some((skill) => (realSkillLookup(skill.id)?.name ?? "").includes("合作协议")),
      `干员 ${name} 没有名称含「合作协议」的技能`,
    );
  }

  const byDescription = filterOperators(OPERATOR_CATALOG, null, null, "尚未拥有的线索", realSkillLookup).map((operator) => operator.name);
  assert.ok(byDescription.length > 0);
  for (const name of byDescription) {
    const operator = OPERATOR_CATALOG.find((candidate) => candidate.name === name);
    assert.ok(operator, `缺少干员 ${name}`);
    assert.ok(
      operator.buildingSkills.some((skill) => (realSkillLookup(skill.id)?.description ?? "").includes("尚未拥有的线索")),
      `干员 ${name} 没有描述含「尚未拥有的线索」的技能`,
    );
  }
});
