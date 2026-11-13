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
await import("../../i18n/test-setup.ts");
const { getDatabasePool } = await import("@riic/platform-server/db");
const { saveAgentPlanArtifact, getAgentPlanArtifact } = await import("./plan-artifact.ts");
const { restoreAgentScheduleContext } = await import("./schedule-context-service.ts");
const { buildScheduleContextTools } = await import("./schedule-context.ts");
const { prepareAgentRequest } = await import("../../agent-chat-transport.ts");
const { restoreAgentMessages } = await import("../../agent-history.ts");

test("durable result survives compact follow-up and reload; owner, chat, TTL and legacy isolation hold", async () => {
  const pool = getDatabasePool(); const owner = `plan-${randomUUID()}`; const foreign = `foreign-${randomUUID()}`;
  try {
    for (const user of [owner, foreign]) await pool.query('INSERT INTO public."user" (id,name,email,role) VALUES ($1,$1,$2,\'user\')', [user, `${user}@example.test`]);
    const plan = { diagnosticId: "matching-plan", durationMs: 1, layoutLabel: "243", operboxLabel: "fixture", summary: {}, dailyProduction: {}, plans: [{ shift: 1, name: "A", rooms: [{ room: "factory1", operators: ["能天使"] }] }], trainingAdvice: null };
    const meta = { layoutPreset: "243", boxSource: "sample", factoryRecipes: ["gold"], operatorCount: 1 };
    const session = { presetLabel: "243", layout: {}, operbox: ["PRIVATE_BOX"], sourceName: "fixture", boxSource: "sample", rotationProfile: "abc_12_12_12", fiammettaEnabled: false, activeShift: 0,
      result: { rotation: { daily: { production: { pure_gold: 20000, lmd: 15000, equivalent_gold: 1000 }, drone_production: { pure_gold: 2000, lmd: 1000 } } } } };
    const id = await saveAgentPlanArtifact(owner, plan, meta, session, "chat-a");
    const other = await saveAgentPlanArtifact(owner, { ...plan, diagnosticId: "wrong-plan" }, meta, { ...session, result: {} }, "chat-b");
    const messages = restoreAgentMessages([
      { id: "solve", role: "assistant", parts: [{ type: "tool-solve_schedule", toolCallId: "solve", state: "output-available", input: {}, output: { solved: true, artifactId: id, workbenchSession: { result: "x".repeat(17 * 1024 * 1024) } } }] },
      { id: "follow-up", role: "user", parts: [{ type: "text", text: "剩多少赤金" }] },
    ]);
    const prepared = await prepareAgentRequest({ id: "chat-a", messages, body: {}, trigger: "submit-message", api: "/api/agent/chat" });
    const wire = JSON.parse(JSON.stringify(prepared.body));
    assert.ok(JSON.stringify(wire).length < 1024); assert.deepEqual(wire.planArtifactIds, [id]);
    // New request/context instance: no access to previous in-memory results or browser snapshots.
    const context = restoreAgentScheduleContext(owner, wire.id, wire.planArtifactIds);
    const tools = buildScheduleContextTools(context);
    const read = await tools.read_schedule.execute({}, { toolCallId: "follow-up-read", messages: [] });
    assert.equal(read.available, true); assert.equal(read.diagnosticId, "matching-plan"); assert.equal(read.goldBalance.netGoldBars, 14);
    assert.deepEqual(read.plan.plans[0].rooms[0].operators, ["能天使"]);
    assert.doesNotMatch(JSON.stringify(read), /PRIVATE_BOX|workbenchSession/);
    assert.equal(await getAgentPlanArtifact(id, foreign), null);
    assert.equal((await restoreAgentScheduleContext(foreign, "chat-a", [id]).read()).available, false);
    assert.equal((await restoreAgentScheduleContext(owner, "chat-b", [id]).read()).available, false);
    assert.equal((await restoreAgentScheduleContext(owner, "chat-a", [id, other]).read()).available, false);
    const legacy = await saveAgentPlanArtifact(owner, plan, meta, session);
    assert.equal((await restoreAgentScheduleContext(owner, "chat-a", [legacy]).read()).available, false);
    await pool.query("UPDATE app.agent_plan_artifact SET expires_at=now()-interval '1 second' WHERE id=$1", [id]);
    assert.equal((await restoreAgentScheduleContext(owner, "chat-a", [id]).read()).available, false);
    assert.equal(await getAgentPlanArtifact(id, owner), null);
  } finally {
    await pool.query('DELETE FROM public."user" WHERE id=ANY($1::text[])', [[owner, foreign]]);
    await pool.end();
  }
});
