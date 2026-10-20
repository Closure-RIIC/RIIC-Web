import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { parseResourcePolicy, resourceSkill } from "./resource-policy.ts";
registerHooks({ resolve(specifier, context, next) { return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context); } });
const { buildAgentSystemPrompt } = await import("./persona.ts");
const { readKnowledgeDoc, searchKnowledgeBase } = await import("./knowledge.ts");
const { listBuiltinAgentPersonas, resolveAgentPersonaContent } = await import("./persona-catalog.ts");
export const fixtureResources = () => parseResourcePolicy({ schema: 1, systemPrompt: "管理员共享提示词", defaultPersona: "默认助理", personas: [{ id: "saileach", enabled: true, content: "琴柳人格" }], knowledge: { version: "v1", policy: "知识优先", files: [{ path: "index/标题清单.md", content: "- `docs/制造站.md` 制造站" }, { path: "index/消歧字典.json", content: "{}" }, { path: "docs/制造站.md", content: "# 制造站\n正文数值30%" }] }, skills: [{ id: "production", title: "制造站", purpose: "查询机制", content: "先查原文", enabled: true }, { id: "disabled", title: "关闭指引", purpose: "不应进入提示词", content: "不能加载", enabled: false }] });

test("one snapshot supplies persona, prompt, knowledge and enabled skills without filesystem fallback", async () => {
  const policy = fixtureResources();
  assert.deepEqual((await listBuiltinAgentPersonas(policy)).map(item => item.id), ["saileach"]);
  const persona = await resolveAgentPersonaContent({ id: "saileach", kind: "builtin", content: "客户端伪造" }, policy);
  const prompt = await buildAgentSystemPrompt(persona, policy);
  for (const text of ["琴柳人格", "管理员共享提示词", "知识优先", "production", "默认使用简体中文", "内部思考"]) assert.ok(prompt.includes(text));
  assert.doesNotMatch(prompt, /客户端伪造|关闭指引/);
  assert.equal((await searchKnowledgeBase("制造站", policy)).matched[0].path, "docs/制造站.md");
  assert.match((await readKnowledgeDoc("docs/制造站.md", 0, policy)).content, /30%/);
  assert.equal(resourceSkill(policy, "production").content, "先查原文");
  assert.throws(() => resourceSkill(policy, "disabled"));
  await assert.rejects(resolveAgentPersonaContent({ id: "silverash", kind: "builtin" }, policy));
  await assert.rejects(readKnowledgeDoc("docs/../secret.md", 0, policy));
  await assert.rejects(readKnowledgeDoc("docs/missing.md", 0, policy));
});

test("rejects broken catalog references, invalid JSON, duplicates and paths before publishing", () => {
  const policy = fixtureResources();
  for (const change of [
    (p: typeof policy) => { p.knowledge.files[0].content = "- `docs/missing.md` missing"; },
    (p: typeof policy) => { p.knowledge.files[1].content = "["; },
    (p: typeof policy) => { p.knowledge.files.push(p.knowledge.files[0]); },
    (p: typeof policy) => { p.knowledge.files[2].path = "docs/../../secret.md"; },
    (p: typeof policy) => { p.personas[0].content = ""; },
  ]) { const copy = structuredClone(policy); change(copy); assert.throws(() => parseResourcePolicy(copy)); }
});
