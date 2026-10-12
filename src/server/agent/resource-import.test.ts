import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) { return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context); } });
const { importAgentResources } = await import("./resources.ts");

test("configured private files import as a complete draft and missing documents fail without a partial snapshot", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "riic-resource-import-"));
  const previous = process.env.AGENT_KB_DIR;
  try {
    for (const directory of ["docs", "index", "agent", "skill"]) await mkdir(path.join(root, directory));
    const fixture = {
      "docs/factory.md": "# 制造站\n经核实的正文",
      "index/标题清单.md": "- `docs/factory.md` 制造站",
      "index/消歧字典.json": "{}",
      "agent/KNOWLEDGE_RULES.md": "共享知识规则",
      "skill/manifest.json": JSON.stringify({ version: 1, skills: [{ id: "mechanism", title: "机制", purpose: "核实机制", path: "skill/skill-1-mechanism.md" }] }),
      "skill/skill-1-mechanism.md": "先检索后阅读",
    };
    for (const [file, text] of Object.entries(fixture)) await writeFile(path.join(root, file), text);
    process.env.AGENT_KB_DIR = root;
    const first = await importAgentResources();
    assert.equal(first.knowledge.files.length, 3); assert.equal(first.skills[0].content, "先检索后阅读");
    assert.equal(first.knowledge.policy, "共享知识规则");
    assert.equal((await importAgentResources()).knowledge.version, first.knowledge.version);
    await writeFile(path.join(root, "docs/factory.md"), "# 制造站\n修订后的正文");
    assert.notEqual((await importAgentResources()).knowledge.version, first.knowledge.version);
    await rm(path.join(root, "docs/factory.md"));
    await assert.rejects(importAgentResources(), /缺失/);
  } finally {
    if (previous === undefined) delete process.env.AGENT_KB_DIR; else process.env.AGENT_KB_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
