import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { queryAgentSkills, inspectAgentOperators } from "./operator-tools.ts";
import { operatorBuildingSkillList } from "../../operatorPortraits.ts";
import { loadKnowledgePolicy, loadAgentSkillManifest, readAgentSkill } from "./knowledge-policy.ts";
import roster from "../../../../../fixtures/operbox_full_e2.json" with { type: "json" };

registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : nextResolve(specifier, context);
} });
const { searchKnowledgeBase, readKnowledgeDoc } = await import("./knowledge.ts");
const { buildAgentSystemPrompt } = await import("./persona.ts");

test("operator skill query reuses website skills and unlock levels, including one-character names", () => {
  for (const name of ["孑", "但书", "菲亚梅塔"]) {
    const actual = queryAgentSkills({ query: name, limit: 30 });
    const expected = operatorBuildingSkillList(name);
    assert.equal(actual.skills.length, expected.length);
    assert.deepEqual(actual.skills.map((s) => [s.id, s.elite, s.level, s.description]), expected.map((s) => [s.id, s.elite, s.level, s.description]));
    assert.ok(actual.skills.every((s) => s.operator === name));
  }
  for (const query of ["Exusiai", "nengtianshi", "nts"]) assert.ok(queryAgentSkills({ query, limit: 30 }).skills.some((s) => s.operator === "能天使"), query);
  assert.equal(queryAgentSkills({ query: "不存在的干员" }).matchedCount, 0);
  assert.ok(queryAgentSkills({ query: "订单", limit: 1 }).truncated);
});

test("sample ownership and progression stay unknown; real pool preserves missing and levels", () => {
  const op = roster.find((entry) => entry.name === "孑")!;
  const sample = inspectAgentOperators({ operbox: roster, source: "sample", sourceName: "示例" }, [op.name])[0];
  assert.equal(sample.own, null); assert.equal(sample.elite, null); assert.equal(sample.level, null);
  const real = inspectAgentOperators({ operbox: [{ ...op, own: true, elite: 1, level: 40 }], source: "maa", sourceName: "MAA" }, [op.name])[0];
  assert.deepEqual([real.own, real.elite, real.level], [true, 1, 40]);
  const missing = inspectAgentOperators({ operbox: [{ ...op, own: false }], source: "maa", sourceName: "MAA" }, [op.name])[0];
  assert.equal(missing.own, false); assert.equal(missing.elite, null);
  const absent = (source: "skland" | "maa") => inspectAgentOperators({ operbox: [], source, sourceName: source }, [op.name, "未知"]);
  assert.equal(absent("skland")[0].own, false);
  assert.equal(absent("skland")[1].own, null);
  assert.equal(absent("maa")[0].own, null);
});

test("website policy, manifest, routing and paginated reading work without model calls", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-kb-"));
  const old = process.env.AGENT_KB_DIR;
  try {
    await Promise.all(["agent", "skill", "index", "docs"].map((dir) => mkdir(path.join(root, dir))));
    await writeFile(path.join(root, "agent/KNOWLEDGE_RULES.md"), "共享测试规则");
    await writeFile(path.join(root, "skill/manifest.json"), JSON.stringify({ version: 1, skills: [{ id: "retrieval", title: "检索与消歧", path: "skill/skill-1-检索.md", purpose: "消歧" }] }));
    await writeFile(path.join(root, "skill/skill-1-检索.md"), "按需流程");
    await writeFile(path.join(root, "index/消歧字典.json"), "{}");
    await writeFile(path.join(root, "index/标题清单.md"), "- `docs/孑.md`（skill）孑：机制\n");
    await writeFile(path.join(root, "docs/孑.md"), "# 孑\n" + "正文".repeat(9000));
    await writeFile(path.join(root, "docs/无标题.md"), "普通正文");
    process.env.AGENT_KB_DIR = root;
    const prompt = await buildAgentSystemPrompt();
    assert.ok(prompt.includes(await loadKnowledgePolicy(root)));
    assert.ok(prompt.includes("固定先 query_skills"));
    assert.ok(prompt.includes("博士确认或调整后，再调 solve_schedule"));
    assert.ok(prompt.includes("简单计算无需加载"));
    assert.ok(prompt.includes("干员身份和专精资格必须先查站内数据"));
    assert.ok(prompt.includes("继续 current=0、target=3"));
    assert.ok(prompt.includes("名称歧义按工具候选请用户选择"));
    assert.ok(prompt.includes("相同来源的环境值合并"));
    assert.equal((await loadAgentSkillManifest(root)).length, 1);
    assert.equal((await readAgentSkill(root, "retrieval")).title, "检索与消歧");
    await assert.rejects(readAgentSkill(root, "../../secret"));
    assert.equal((await searchKnowledgeBase("孑")).matched[0]?.path, "docs/孑.md");
    const first = await readKnowledgeDoc("docs/孑.md");
    const second = await readKnowledgeDoc("docs/孑.md", first.nextOffset!);
    assert.equal(first.title, "孑"); assert.equal(second.truncated, false);
    assert.equal(first.content + second.content, await readFile(path.join(root, "docs/孑.md"), "utf8"));
    assert.equal((await readKnowledgeDoc("docs/无标题.md")).title, "知识正文");
    await assert.rejects(readKnowledgeDoc("skill/skill-1-检索.md"));
    await assert.rejects(readKnowledgeDoc("docs/../agent/KNOWLEDGE_RULES.md"));
    process.env.AGENT_KB_DIR = "";
    const degraded = await buildAgentSystemPrompt();
    assert.ok(degraded.includes("知识服务暂不可用"));
    assert.ok(degraded.includes("不声称没有规则"));
    assert.ok(degraded.includes("calculate_recruitment"));
    await assert.rejects(readKnowledgeDoc("docs/孑.md"));
  } finally {
    if (old === undefined) delete process.env.AGENT_KB_DIR; else process.env.AGENT_KB_DIR = old;
    await rm(root, { recursive: true, force: true });
  }
});

test("real KB standalone and website load the identical policy and enabled skills", { skip: !process.env.AGENT_TEST_KB_DIR }, async () => {
  const root = process.env.AGENT_TEST_KB_DIR!;
  const standalone = await import(pathToFileURL(path.join(root, "agent/load-policy.mjs")).href);
  const rules = await loadKnowledgePolicy(root);
  assert.equal(await standalone.loadKnowledgeRules(), rules);
  const prompt = await standalone.renderKnowledgePrompt({ context: "原文{question}", question: "测试" });
  assert.ok(prompt.includes(rules)); assert.ok(prompt.includes("原文{question}"));
  assert.ok(!prompt.includes("{knowledge_rules}"));
  assert.deepEqual((await loadAgentSkillManifest(root)).map((s) => s.id), ["retrieval", "substitution", "comparison", "boundaries", "training"]);
  for (const skill of await loadAgentSkillManifest(root)) assert.ok((await readAgentSkill(root, skill.id)).content.length > 100);
  const old = process.env.AGENT_KB_DIR;
  try {
    process.env.AGENT_KB_DIR = root;
    for (const [query, target] of [["孑", "释义/孑.md"], ["肥鸭", "释义/菲亚梅塔.md"], ["但书", "释义/违约索赔.md"]]) {
      assert.ok((await searchKnowledgeBase(query)).matched.some((entry) => entry.path.endsWith(target)), query);
    }
    assert.ok((await searchKnowledgeBase("裁缝 β")).disambiguation.length > 0);
  } finally {
    if (old === undefined) delete process.env.AGENT_KB_DIR; else process.env.AGENT_KB_DIR = old;
  }
});
