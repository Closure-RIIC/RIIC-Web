import { resolveAgentOperator } from "./operator-tools.ts";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import roster from "../../../fixtures/operbox_full_e2.json" with { type: "json" };
import { buildCalculatorTools, type AgentOperatorPool } from "./calculator-tools.ts";
import { observeMasteryEnvironment } from "./mastery-environment.ts";
import type { SklandStatusSnapshot } from "../../types.ts";
import { calculateMastery } from "../../mastery.ts";
import { calculateRecruitment, RECRUITMENT_TAGS } from "../../recruitment.ts";
import { OPERATOR_CATALOG } from "../../operatorPortraits.ts";
import trainingPlannerDataJson from "../../generated/training-planner-data.json" with { type: "json" };
import type { AgentTrainingResources } from "./calculator-tools.ts";
import type { TrainingPlannerData } from "../../training-planner.ts";

test("identity resolution uses aliases, preserves ambiguity and prioritizes canonical names", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-alias-"));
  const old = process.env.AGENT_KB_DIR;
  try {
    await mkdir(path.join(root, "index"));
    await writeFile(path.join(root, "index/消歧字典.json"), JSON.stringify({ operator_aliases: {
      "维娜": { targets: ["维娜·维多利亚"] }, "德狼": { targets: ["德克萨斯", "拉普兰德"] },
      "能天使": { targets: ["新约能天使"] },
    } }));
    process.env.AGENT_KB_DIR = root;
    assert.deepEqual((await resolveAgentOperator("维娜")).candidates.map((op) => op.name), ["维娜·维多利亚"]);
    assert.deepEqual((await resolveAgentOperator("能天使")).candidates.map((op) => op.name), ["能天使"]);
    const ambiguous = await tools().calculate_mastery.execute!({ targetOperator: "德狼", target: 3 }, options);
    assert.ok(ambiguous && "code" in ambiguous);
    assert.equal(ambiguous.code, "identity_ambiguous");
    assert.equal(ambiguous.candidates.length, 2);
    const result = await tools().calculate_mastery.execute!({ targetOperator: "维娜", current: 0, target: 3 }, options);
    assert.ok(result && "settings" in result);
    assert.equal(result.targetOperator.name, "维娜·维多利亚");
    assert.deepEqual(result.simple.stages.map((s) => s.level), [1, 2, 3]);
    assert.equal(result.settingsSources.environment.fireworks, "默认值");
    assert.equal((await resolveAgentOperator("维娜", path.join(root, "missing"))).status, "ambiguous");
    assert.equal((await resolveAgentOperator("结城理", path.join(root, "missing"))).status, "resolved");
  } finally {
    if (old === undefined) delete process.env.AGENT_KB_DIR; else process.env.AGENT_KB_DIR = old;
    await rm(root, { recursive: true, force: true });
  }
});

test("mastery warns about ownership and training while preserving identity and support errors", async () => {
  const op = roster.find((entry) => entry.name === "至简")!;
  assert.ok(op);
  const run = async (pool: AgentOperatorPool, query = op.name) => buildCalculatorTools(async () => pool, async (_n, _i, fn) => fn()).resolve_operator.execute!({ query }, options);
  for (const [source, entries, code] of [
    ["skland", [], "not_owned"], ["maa", [], "ownership_unknown"], ["sample", [], "ownership_unknown"],
    ["sample", [op], "ownership_unknown"], ["maa", [{ ...op, own: false }], "not_owned"],
    ["skland", [{ ...op, elite: 0 }], "insufficient_training"], ["skland", [{ ...op, elite: 1 }], "insufficient_training"],
    ["skland", [op], undefined],
  ] as const) {
    const pool: AgentOperatorPool = { source, operbox: [...entries], sourceName: source };
    const before = structuredClone(pool);
    const result = await run(pool);
    assert.ok(result && "warnings" in result);
    assert.equal(result.warnings[0]?.code, code);
    assert.equal(result.eligible, true);
    assert.equal(result.own, source === "sample" || source === "maa" && !entries.length ? null : !!entries[0]?.own);
    const calculated = await buildCalculatorTools(async () => pool, async (_n, _i, fn) => fn()).calculate_mastery.execute!({ targetOperator: op.name, target: 3 }, options);
    assert.ok(calculated && "simple" in calculated);
    assert.deepEqual(calculated.warnings, result.warnings);
    assert.deepEqual(calculated.targetAssumptions, { owned: true, elite: 2 });
    assert.equal(calculated.targetStatus.elite, result.elite);
    assert.deepEqual(calculated.simple.stages.map((s) => s.level), [1, 2, 3]);
    assert.deepEqual(pool, before);
  }
  const unknown = await run({ source: "sample", operbox: roster, sourceName: "示例" }, "不存在");
  assert.ok(unknown && "code" in unknown); assert.equal(unknown.code, "identity_unknown");
  const unsupported = await run({ source: "sample", operbox: roster, sourceName: "示例" }, "char_4195_radian");
  assert.ok(unsupported && "code" in unsupported); assert.equal(unsupported.code, "calculation_unsupported");
  const sample = await run({ source: "sample", operbox: [{ ...op, id: op.id.replace(/^char_/, "") }], sourceName: "示例" });
  assert.ok(sample && "eligible" in sample); assert.equal(sample.own, null); assert.equal(sample.eligible, true);
});

test("hypothetical target uses actual trainers without upgrading or adding pool entries", async () => {
  const find = (name: string) => ({ ...roster.find((entry) => entry.name === name)! });
  const target = { ...find("至简"), elite: 0 };
  const operbox = [target, { ...find("逻各斯"), elite: 1 }, { ...find("艾丽妮"), own: false }];
  const before = structuredClone(operbox);
  const all = buildCalculatorTools(async () => ({ source: "skland", sourceName: "森空岛", operbox }), async (_n, _i, fn) => fn());
  const result = await all.calculate_mastery.execute!({ targetOperator: "至简", target: 3 }, options);
  assert.ok(result && "simple" in result);
  const expected = calculateMastery({ operbox, targetId: target.id, current: 0, target: 3, controlBonus: true, bufferMinutes: 1, environment: {} });
  assert.equal(result.fast.totalSeconds, expected.fast.totalSeconds);
  assert.ok(result.fast.stages.every((s) => !s.activateWith && s.segments.every((p) => p.trainerName !== "艾丽妮" && p.trainerName !== "至简")));
  assert.deepEqual(operbox, before);
  for (const query of ["芬", "char_4195_radian", "char_4230_mcnist"]) {
    for (const result of [await all.resolve_operator.execute!({ query }, options), await all.calculate_mastery.execute!({ targetOperator: query, target: 3 }, options)]) {
      assert.ok(result && "code" in result);
      assert.equal(result.code, "calculation_unsupported");
    }
  }
});

test("real KB operator aliases match the site catalog", { skip: !process.env.AGENT_TEST_KB_DIR }, async () => {
  const root = process.env.AGENT_TEST_KB_DIR!;
  for (const [query, name] of [["结城理", "结城理"], ["维娜", "维娜·维多利亚"], ["推王", "推进之王"]]) {
    const result = await resolveAgentOperator(query, root);
    assert.equal(result.status, "resolved"); assert.deepEqual(result.candidates.map((op) => op.name), [name]);
  }
});

function tools(source: AgentOperatorPool["source"] = "sample") {
  return buildCalculatorTools(async () => ({ operbox: roster, source, sourceName: "测试干员池" }), async (_name, _input, run) => {
    try { return await run(); } catch (error) { return { error: (error as Error).message }; }
  });
}
const options = { toolCallId: "test", messages: [], context: {} };

test("snapshot environments reach mastery output and explicit zero overrides automatic counts", async () => {
  const room = (group: string, names: string[]) => ({ group, operators: names.map((name) => ({ id: roster.find((o) => o.name === name)!.id, name })) });
  const snapshot = { operbox: roster, infrastructure: { storeTs: 12345, currentTs: 12350, rooms: [
    room("control", ["阿斯卡纶", "薇薇安娜"]),
    room("dormitory", ["歌蕾蒂娅", "斯卡蒂", "幽灵鲨", "安哲拉", "乌尔比安"]),
    room("manufacture", ["灰毫", "野鬃", "远牙", "砾", "阿罗玛"]),
    room("trading", ["巫恋", "伺夜"]), room("hire", ["斥罪"]),
    room("training", ["歌蕾蒂娅"]), room("processing", ["提丰"]),
  ] } } as unknown as SklandStatusSnapshot;
  const observation = observeMasteryEnvironment(snapshot);
  assert.deepEqual(observation.environment, { sami: 0, abyssal: 5, knights: 5, defence: 0, attack: 0, siracusa: 4 });
  assert.equal(observation.controlBonus, true);
  assert.equal(observation.matches.abyssal.length, 5);
  const tool = buildCalculatorTools(async () => ({ source: "skland", sourceName: "测试快照", operbox: roster, masteryEnvironment: observation }), async (_n, _i, run) => run()).calculate_mastery;
  const result = await tool.execute!({ targetOperator: "结城理", target: 3 }, options);
  assert.ok(result && "settings" in result);
  assert.equal(result.settings.environment.abyssal, 5);
  assert.equal(result.settings.environment.fireworks, 0);
  assert.equal(result.settingsSources.environment.abyssal, "森空岛自动读取");
  assert.equal(result.environmentObservation!.warning, "自动读取状态可能存在误差或延迟，如果环境加成变动，记得跟我说哦。");
  assert.equal(result.environmentObservation!.storeTs, 12345);
  const override = await tool.execute!({ targetOperator: "结城理", target: 3, controlBonus: false, environment: { abyssal: 0 } }, options);
  assert.ok(override && "settings" in override);
  assert.equal(override.settings.controlBonus, false);
  assert.equal(override.settings.environment.abyssal, 0);
  assert.equal(override.settings.environment.knights, 5);
  assert.equal(override.settingsSources.environment.abyssal, "手动指定");
});

test("mastery tool matches webpage calculation and preserves activation instructions", async () => {
  const tool = tools().calculate_mastery;
  const input = { targetOperator: "埃癸斯", target: 3 as const };
  const result = await tool.execute!(input, options);
  assert.ok(result && "simple" in result);
  const target = roster.find((entry) => entry.name === input.targetOperator)!;
  const expected = calculateMastery({ operbox: roster, targetId: target.id, current: 0, target: 3, controlBonus: true, bufferMinutes: 1, environment: {} });
  assert.equal(result.simple.totalSeconds, expected.simple.totalSeconds);
  assert.equal(result.fast.totalSeconds, expected.fast.totalSeconds);
  assert.equal(result.isSample, true);
  assert.equal(result.settings.current, 0);
  assert.equal(result.settings.controlBonus, true);
  assert.equal(result.settings.bufferMinutes, 1);
  assert.ok(Object.values(result.settings.environment).every((value) => value === 0));
  assert.ok(result.simple.instructions.flat().length > 0);
});

test("mastery honors explicit starting level and settings", async () => {
  const result = await tools().calculate_mastery.execute!({ targetOperator: "埃癸斯", current: 2, target: 3, controlBonus: false, bufferMinutes: 2 }, options);
  assert.ok(result && "settings" in result);
  assert.equal(result.settings.current, 2);
  assert.equal(result.settings.controlBonus, false);
  assert.equal(result.settings.bufferMinutes, 2);
  assert.deepEqual(result.simple.stages.map((stage) => stage.level), [3]);
});

test("mastery tool rejects unavailable operators and reversed progression", async () => {
  const tool = tools().calculate_mastery;
  const unknown = await tool.execute!({ targetOperator: "不存在", current: 0, target: 3 }, options);
  assert.ok(unknown && "error" in unknown);
  const reversed = await tool.execute!({ targetOperator: "埃癸斯", current: 2, target: 1 }, options);
  assert.ok(reversed && "error" in reversed);
});

test("recruitment fallback calculates combinations without inventing personal ownership", async () => {
  const tool = tools().calculate_recruitment;
  const tag = RECRUITMENT_TAGS.find((entry) => entry.id === 11)!;
  const result = await tool.execute!({ tags: [tag.zh], missingOnly: true }, options);
  assert.ok(result && "results" in result);
  assert.equal(result.minutes, 540);
  assert.equal(result.ownershipKnown, false);
  assert.equal(result.missingFilterApplied, false);
  assert.equal(result.results.length, calculateRecruitment([11]).length);
  assert.ok(result.results.every((entry) => entry.operators.every((operator) => operator.ownership === "unknown")));
});

test("recruitment personal pool supports missing and rarity filters", async () => {
  const tool = tools("maa").calculate_recruitment;
  const tag = RECRUITMENT_TAGS.find((entry) => entry.id === 11)!;
  const result = await tool.execute!({ tags: [tag.zh], fourStarOnly: true, missingOnly: true }, options);
  assert.ok(result && "results" in result);
  assert.equal(result.ownershipKnown, true);
  assert.equal(result.missingFilterApplied, true);
  assert.ok(result.results.every((entry) => entry.minimumRarity >= 4 && entry.missingCount! > 0));
});

test("tool schemas reject invalid tags, duration, environment and extra arguments", () => {
  const all = tools();
  const recruitment = all.calculate_recruitment.inputSchema as z.ZodType;
  const mastery = all.calculate_mastery.inputSchema as z.ZodType;
  assert.equal(recruitment.safeParse({ tags: ["不存在"] }).success, false);
  assert.equal(recruitment.safeParse({ tags: [RECRUITMENT_TAGS[0]!.zh], minutes: 541 }).success, false);
  assert.equal(mastery.safeParse({ targetOperator: "埃癸斯", current: 0, target: 3, environment: { invented: 1 } }).success, false);
  assert.equal(mastery.safeParse({ targetOperator: "埃癸斯", current: 0, target: 3, userId: "other" }).success, false);
});

test("training calculator reports level costs and material, LMD and experience shortages", async () => {
  const operator = OPERATOR_CATALOG.find((entry) => entry.name === "阿米娅")!;
  const resources: AgentTrainingResources = {
    operators: [],
    inventory: [],
    sourceName: "森空岛·测试角色",
    fetchedAt: "2026-10-19T00:00:00.000Z",
  };
  const tool = buildCalculatorTools(
    async () => ({ operbox: [], source: "skland", sourceName: resources.sourceName }),
    async (_name, _input, run) => run(),
    async () => resources,
  ).calculate_training;
  const result = await tool.execute!({ operator: "阿米娅", targetElite: 1, targetLevel: 50 }, options);
  assert.ok(result && "hasInventoryShortage" in result, JSON.stringify(result));
  assert.equal(result.operator?.id, operator.id);
  assert.equal(result.owned, false);
  assert.equal(result.target.elite, 1);
  assert.equal(result.target.level, 50);
  assert.ok(result.lmd.required > 0);
  assert.ok(result.lmd.missing > 0);
  assert.ok(result.experience.required > 0);
  assert.ok(result.experience.missing > 0);
  assert.ok(result.experience.missingBookEquivalent > 0);
  assert.ok(result.materials.length > 0);
  assert.ok(result.materialShortages.length > 0);
  assert.equal(result.hasInventoryShortage, true);
  assert.ok(result.warnings.some((warning) => warning.includes("按精0 1级")));
});

test("training calculator uses Skland progression and reports a fully stocked target", async () => {
  const plannerData = trainingPlannerDataJson as TrainingPlannerData;
  const operator = OPERATOR_CATALOG.find((entry) => entry.name === "阿米娅")!;
  const training = plannerData.operators[operator.id]!;
  const firstModule = training.modules[0]!;
  const resources: AgentTrainingResources = {
    operators: [{
      id: operator.id,
      name: operator.name,
      rarity: operator.rarity,
      profession: "CASTER",
      subProfessionName: "Core Caster",
      elite: 1,
      level: 30,
      potential: 1,
      favorPercent: 100,
      mainSkillLevel: 5,
      skills: [{ index: 1, specializeLevel: 0 }, { index: 2, specializeLevel: 0 }, { index: 3, specializeLevel: 0 }],
      modules: [{ id: firstModule.id, name: firstModule.name, level: 1, locked: false, isDefault: false }],
      currentSkinName: null,
      acquiredAt: 0,
      isAssist: false,
    }],
    inventory: [
      ...Object.keys(plannerData.items).map((id) => ({ id, count: 100_000 })),
      ...["2001", "2002", "2003", "2004", "3003"].map((id) => ({ id, count: 100_000 })),
      { id: "4001", count: 10_000_000 },
    ],
    sourceName: "森空岛·测试角色",
    fetchedAt: "2026-10-19T00:00:00.000Z",
  };
  const tool = buildCalculatorTools(
    async () => ({ operbox: [], source: "skland", sourceName: resources.sourceName }),
    async (_name, _input, run) => run(),
    async () => resources,
  ).calculate_training;
  const result = await tool.execute!({
    operator: operator.id,
    targetElite: 2,
    targetLevel: 80,
    targetSkillLevel: 7,
    targetModules: [{ module: firstModule.id, level: 2 }],
  }, options);
  assert.ok(result && "hasInventoryShortage" in result, JSON.stringify(result));
  assert.equal(result.owned, true);
  assert.deepEqual([result.current.elite, result.current.level, result.current.skillLevel], [1, 30, 5]);
  assert.equal(result.current.modules.find((module) => module.moduleId === firstModule.id)?.level, 1);
  assert.deepEqual([result.target.elite, result.target.level, result.target.skillLevel], [2, 80, 7]);
  assert.equal(result.target.modules.find((module) => module.moduleId === firstModule.id)?.level, 2);
  assert.equal(result.hasInventoryShortage, false);
});

test("training calculator rejects impossible levels, unresolved names and invalid schema values", async () => {
  const resources: AgentTrainingResources = { operators: [], inventory: [], sourceName: "森空岛", fetchedAt: "now" };
  const tool = buildCalculatorTools(
    async () => ({ operbox: [], source: "skland", sourceName: "森空岛" }),
    async (_name, _input, run) => run(),
    async () => resources,
  ).calculate_training;
  const invalidLevel = await tool.execute!({ operator: "阿米娅", targetElite: 1, targetLevel: 90 }, options);
  assert.ok(invalidLevel && "error" in invalidLevel);
  const unknown = await tool.execute!({ operator: "不存在的干员", targetElite: 1, targetLevel: 50 }, options);
  assert.ok(unknown && "code" in unknown);
  assert.equal(unknown.code, "identity_unknown");
  const schema = tool.inputSchema as z.ZodType;
  assert.equal(schema.safeParse({ operator: "阿米娅", targetElite: 1, targetLevel: 50, extra: true }).success, false);
  assert.equal(schema.safeParse({ operator: "阿米娅", targetElite: 1, targetLevel: 50, targetModules: [{ module: "x", level: 4 }] }).success, false);
});
