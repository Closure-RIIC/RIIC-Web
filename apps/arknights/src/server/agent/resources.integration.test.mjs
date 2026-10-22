import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { register, registerHooks } from "node:module";
import test from "node:test";
import process from "node:process";
import { URL } from "node:url";
register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) { return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context); } });
const url = process.env.AUTH_INTEGRATION_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("Isolated *_test database required");
process.env.DATABASE_URL = url;
const { getDatabasePool } = await import("@riic/platform-server/db");
const { changeAgentPolicy } = await import("../billing/admin.ts");
const { activeAgentResources } = await import("./resources.ts");
const { readKnowledgeDoc } = await import("./knowledge.ts");

test("resource drafts, concurrent publication, immutable per-request snapshot and audited rollback", async () => {
  const pool = getDatabasePool(); const actor = `resource-admin-${randomUUID()}`; const owned = [];
  const payload = { schema: 1, systemPrompt: "系统规则", defaultPersona: "助理", personas: [], skills: [], knowledge: { version: "test-v1", policy: "按知识作答", files: [{ path: "index/标题清单.md", content: "- `docs/test.md` 测试" }, { path: "index/消歧字典.json", content: "{}" }, { path: "docs/test.md", content: "# 测试\n第一版" }] } };
  try {
    assert.equal(await activeAgentResources(), null, "test requires no active resource policy");
    await pool.query('INSERT INTO public."user" (id,name,email,role) VALUES ($1,$1,$2,\'admin\')', [actor, `${actor}@example.test`]);
    const draft = async (body, expectedActive) => { const row = await changeAgentPolicy(actor, { action: "draft", kind: "resources", reason: "isolated resource test", payload: body, expectedActive }); owned.push(row.id); return row.id; };
    const first = await draft(payload); const second = await draft({ ...payload, systemPrompt: "第二版提示词" });
    assert.equal(await activeAgentResources(), null);
    const publish = id => changeAgentPolicy(actor, { action: "publish", kind: "resources", id, reason: "concurrency test" });
    const races = await Promise.allSettled([publish(first), publish(second)]);
    assert.equal(races.filter(result => result.status === "fulfilled").length, 1);
    const original = await activeAgentResources();
    const changed = globalThis.structuredClone(payload); changed.knowledge.files[2].content = "# 测试\n第二版";
    const next = await draft(changed, original.id);
    await assert.rejects(publish(next), /已更新/);
    await changeAgentPolicy(actor, { action: "publish", kind: "resources", id: next, expectedActive: original.id, reason: "publish new" });
    assert.match((await readKnowledgeDoc("docs/test.md", 0, original.policy)).content, /第一版/);
    assert.match((await readKnowledgeDoc("docs/test.md", 0, (await activeAgentResources()).policy)).content, /第二版/);
    const rolledBack = await changeAgentPolicy(actor, { action: "rollback", kind: "resources", id: original.id, expectedActive: next, reason: "restore" }); owned.push(rolledBack.id);
    assert.notEqual(rolledBack.id, original.id);
    assert.match((await readKnowledgeDoc("docs/test.md", 0, (await activeAgentResources()).policy)).content, /第一版/);
    assert.ok((await pool.query("SELECT count(*)::int AS n FROM app.billing_admin_audit WHERE actor_id=$1", [actor])).rows[0].n >= 6);
  } finally {
    await pool.query("DELETE FROM app.billing_admin_audit WHERE actor_id=$1", [actor]);
    await pool.query("DELETE FROM app.agent_policy_version WHERE id=any($1::text[]) AND kind='resources'", [owned]);
    await pool.query('DELETE FROM public."user" WHERE id=$1', [actor]);
    await pool.end();
  }
});
