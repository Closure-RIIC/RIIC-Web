import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context);
} });
const { readBuiltinAgentPersona, listBuiltinAgentPersonas, resolveAgentPersonaContent } = await import("./persona-catalog.ts");
const { buildAgentSystemPrompt } = await import("./persona.ts");

test("pure mode omits every persona while retaining system, knowledge and tool policies", async () => {
  const resources = {
    schema: 1 as const,
    systemPrompt: "mandatory-system-policy",
    defaultPersona: "private-default-persona",
    personas: [],
    knowledge: { version: "fixture", policy: "mandatory-knowledge-policy", files: [] },
    skills: [{ id: "fixture-tool", title: "Tool", purpose: "mandatory-tool-purpose", content: "", enabled: true }],
  };
  const selection = await resolveAgentPersonaContent({ kind: "none" }, resources);
  assert.equal(selection, null);
  const pure = await buildAgentSystemPrompt(selection, resources);
  assert.ok(!pure.includes(resources.defaultPersona));
  for (const required of [resources.systemPrompt, resources.knowledge.policy, resources.skills[0].purpose, "统一回答约束"]) {
    assert.ok(pure.includes(required));
  }
  assert.ok((await buildAgentSystemPrompt(undefined, resources)).startsWith(resources.defaultPersona));
  for (const persona of [{ kind: "none", id: "silverash" }, { kind: "none", content: "override" }]) {
    await assert.rejects(resolveAgentPersonaContent(persona, resources), /不能同时指定人格卡/);
  }
});


test("private preset loading, request selection and missing-resource behavior", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riic-persona-catalog-"));
  const filename = path.join(directory, "preset.md");
  const previous = process.env.AGENT_PERSONA_SILVERASH_CARD;
  const previousExusiai = process.env.AGENT_PERSONA_EXUSIAI_CARD;
  const previousSaileach = process.env.AGENT_PERSONA_SAILEACH_CARD;
  const previousMountain = process.env.AGENT_PERSONA_MOUNTAIN_CARD;
  try {
    delete process.env.AGENT_PERSONA_MOUNTAIN_CARD;
    delete process.env.AGENT_PERSONA_SAILEACH_CARD;
    delete process.env.AGENT_PERSONA_EXUSIAI_CARD;
    delete process.env.AGENT_PERSONA_SILVERASH_CARD;
    assert.deepEqual(await listBuiltinAgentPersonas(), []);
    await assert.rejects(readBuiltinAgentPersona("silverash"), /暂不可用/);
    process.env.AGENT_PERSONA_SILVERASH_CARD = filename;
    assert.deepEqual(await listBuiltinAgentPersonas(), []);
    await writeFile(filename, "# 测试人格\n说话沉稳，先说明取舍。\n", "utf8");
    const content = (await readFile(filename, "utf8")).trim();
    const cards = await listBuiltinAgentPersonas();
    assert.deepEqual(cards.map(card => card.id), ["silverash"]);
    assert.equal(JSON.stringify(cards).includes(filename), false);
    assert.equal(JSON.stringify(cards).includes(content), false);
    assert.equal(await resolveAgentPersonaContent({ id: "silverash", kind: "builtin", content: "不能替换服务端预设" }), content);
    const prompt = await buildAgentSystemPrompt(await resolveAgentPersonaContent({ id: "silverash", kind: "builtin" }));
    assert.ok(prompt.startsWith(content));
    assert.ok(prompt.includes("所选人格的自然语气"));
    assert.ok(prompt.includes("calculate_mastery"));
    assert.ok(prompt.includes("calculate_training"));
    await assert.rejects(resolveAgentPersonaContent({ id: "../preset.md", kind: "builtin" }), /未找到/);
    assert.equal(await resolveAgentPersonaContent({ id: "upload-test", content: " 上传的语气卡 " }), "上传的语气卡");
    assert.equal(await resolveAgentPersonaContent(), undefined);
    for (const invalid of ["", "银".repeat(12_001)]) {
      await writeFile(filename, invalid, "utf8");
      assert.deepEqual(await listBuiltinAgentPersonas(), []);
      await assert.rejects(readBuiltinAgentPersona("silverash"), /暂不可用/);
    }
    await assert.rejects(readBuiltinAgentPersona("exusiai"), /暂不可用/);
    process.env.AGENT_PERSONA_EXUSIAI_CARD = path.join(directory, "exusiai.md");
    const exusiaiContent = "# 新约能天使\n称呼老板，语气轻快，先把事情办妥。";
    await writeFile(process.env.AGENT_PERSONA_EXUSIAI_CARD, exusiaiContent, "utf8");
    await writeFile(filename, content, "utf8");
    const allCards = await listBuiltinAgentPersonas();
    assert.deepEqual(allCards.map(card => card.id), ["silverash", "exusiai"]);
    assert.equal(JSON.stringify(allCards).includes(directory), false);
    assert.equal(JSON.stringify(allCards).includes(exusiaiContent), false);
    const selected = await resolveAgentPersonaContent({ id: "exusiai", kind: "builtin", content: "不应覆盖私有人格" });
    assert.equal(selected, exusiaiContent);
    const exusiaiPrompt = await buildAgentSystemPrompt(selected);
    assert.ok(exusiaiPrompt.startsWith(exusiaiContent));
    assert.ok(exusiaiPrompt.includes("calculate_mastery"));
    for (const invalid of ["", "天".repeat(12_001)]) {
      await writeFile(process.env.AGENT_PERSONA_EXUSIAI_CARD, invalid, "utf8");
      assert.deepEqual((await listBuiltinAgentPersonas()).map(card => card.id), ["silverash"]);
      await assert.rejects(readBuiltinAgentPersona("exusiai"), /暂不可用/);
    }
    await assert.rejects(readBuiltinAgentPersona("saileach"), /暂不可用/);
    process.env.AGENT_PERSONA_SAILEACH_CARD = path.join(directory, "saileach.md");
    const saileachContent = "# 琴柳\n称呼博士，温和、坦诚，认真时坚定。";
    await writeFile(process.env.AGENT_PERSONA_SAILEACH_CARD, saileachContent, "utf8");
    const saileachCards = await listBuiltinAgentPersonas();
    assert.deepEqual(saileachCards.map(card => card.id), ["silverash", "saileach"]);
    assert.equal(JSON.stringify(saileachCards).includes(directory), false);
    assert.equal(JSON.stringify(saileachCards).includes(saileachContent), false);
    assert.equal(await resolveAgentPersonaContent({ id: "saileach", kind: "builtin", content: "untrusted override" }), saileachContent);
    const saileachPrompt = await buildAgentSystemPrompt(await readBuiltinAgentPersona("saileach"));
    assert.ok(saileachPrompt.startsWith(saileachContent));
    assert.ok(saileachPrompt.includes("calculate_mastery"));
    for (const invalid of ["", "柳".repeat(12_001)]) {
      await writeFile(process.env.AGENT_PERSONA_SAILEACH_CARD, invalid, "utf8");
      assert.deepEqual((await listBuiltinAgentPersonas()).map(card => card.id), ["silverash"]);
      await assert.rejects(readBuiltinAgentPersona("saileach"), /暂不可用/);
    }
    await assert.rejects(readBuiltinAgentPersona("mountain"), /暂不可用/);
    process.env.AGENT_PERSONA_MOUNTAIN_CARD = path.join(directory, "mountain.md");
    assert.deepEqual((await listBuiltinAgentPersonas()).map(card => card.id), ["silverash"]);
    const mountainContent = "# 山\n称呼博士，沉稳坦率，不卑不亢。";
    await writeFile(process.env.AGENT_PERSONA_MOUNTAIN_CARD, mountainContent, "utf8");
    const mountainCards = await listBuiltinAgentPersonas();
    assert.deepEqual(mountainCards.map(card => card.id), ["silverash", "mountain"]);
    assert.equal(JSON.stringify(mountainCards).includes(directory), false);
    assert.equal(JSON.stringify(mountainCards).includes(mountainContent), false);
    assert.equal(await resolveAgentPersonaContent({ id: "mountain", kind: "builtin", content: "untrusted override" }), mountainContent);
    const mountainPrompt = await buildAgentSystemPrompt(await readBuiltinAgentPersona("mountain"));
    assert.ok(mountainPrompt.startsWith(mountainContent));
    assert.ok(mountainPrompt.includes("calculate_mastery"));
    for (const invalid of ["", "山".repeat(12_001)]) {
      await writeFile(process.env.AGENT_PERSONA_MOUNTAIN_CARD, invalid, "utf8");
      assert.deepEqual((await listBuiltinAgentPersonas()).map(card => card.id), ["silverash"]);
      await assert.rejects(readBuiltinAgentPersona("mountain"), /暂不可用/);
    }
  } finally {
    if (previousMountain === undefined) delete process.env.AGENT_PERSONA_MOUNTAIN_CARD;
    else process.env.AGENT_PERSONA_MOUNTAIN_CARD = previousMountain;
    if (previousSaileach === undefined) delete process.env.AGENT_PERSONA_SAILEACH_CARD;
    else process.env.AGENT_PERSONA_SAILEACH_CARD = previousSaileach;
    if (previousExusiai === undefined) delete process.env.AGENT_PERSONA_EXUSIAI_CARD;
    else process.env.AGENT_PERSONA_EXUSIAI_CARD = previousExusiai;
    if (previous === undefined) delete process.env.AGENT_PERSONA_SILVERASH_CARD;
    else process.env.AGENT_PERSONA_SILVERASH_CARD = previous;
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
