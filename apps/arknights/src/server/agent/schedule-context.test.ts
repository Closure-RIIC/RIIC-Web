import assert from "node:assert/strict";
import test from "node:test";
import { AgentScheduleContext, scheduleGoldBalance, parsePlanReferences, scheduleContextPrompt, buildScheduleContextTools } from "./schedule-context.ts";
import { agentPlanReferences } from "../../agent-plan-reference.ts";
import type { AgentPlanArtifactRecord } from "./plan-artifact.ts";
import { MockLanguageModelV4 } from "ai/test";
import { stepCountIs, streamText } from "ai";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";

const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const otherId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const result = { rotation: { daily: { production: { pure_gold: 20000, lmd: 15000, equivalent_gold: 1000 }, drone_production: { pure_gold: 2000, lmd: 1000 } } } };
function artifact(artifactId = id, conversationId = "chat-a"): AgentPlanArtifactRecord {
  return { id: artifactId, conversationId, createdAt: new Date("2026-11-10T00:00:00Z"),
    plan: { diagnosticId: artifactId, durationMs: 42, layoutLabel: "243", operboxLabel: "fixture", summary: {}, dailyProduction: {}, plans: [{ shift: 1, name: "A", rooms: [{ room: "manufacture1", operators: ["能天使"] }] }], trainingAdvice: null },
    meta: { layoutPreset: "243", boxSource: "sample", factoryRecipes: ["gold"], operatorCount: 1 },
    session: { presetLabel: "243", layout: {}, operbox: "PRIVATE_FULL_BOX", sourceName: "fixture", boxSource: "sample", rotationProfile: "abc_12_12_12", fiammettaEnabled: false, activeShift: 0, result } };
}

test("gold accounting includes trade compensation and drones, excludes gifted gold and stock", () => {
  const balance = scheduleGoldBalance(result);
  assert.equal(balance.available, true);
  if (!balance.available) return;
  assert.equal(balance.netGoldBars, 14); assert.equal(balance.factoryGoldBars, 40);
  assert.equal(balance.tradeGoldEquivalentDemandBars, 28); assert.equal(balance.periodHours, 24);
  const deficit = structuredClone(result); deficit.rotation.daily.production.pure_gold = 1000.25;
  const negative = scheduleGoldBalance(deficit);
  assert.equal(negative.available && negative.netGoldBars, -23.9995);
  assert.equal(scheduleGoldBalance({ rotation: { daily: { production: { pure_gold: 1 } } } }).available, false);
  assert.equal(scheduleGoldBalance(null).available, false);
  assert.equal(scheduleGoldBalance({ rotation: { daily: { production: { pure_gold: NaN } } } }).available, false);
});

test("references keep recent successful results only, bounded and deduplicated", () => {
  const part = (artifactId: string) => ({ type: "tool-solve_schedule", state: "output-available", output: { solved: true, artifactId } });
  const ids = Array.from({ length: 10 }, (_, i) => `${String(i).repeat(8)}-aaaa-4aaa-aaaa-aaaaaaaaaaaa`);
  assert.deepEqual(agentPlanReferences([{ parts: ids.map(part) }]), ids.slice(-8));
  assert.deepEqual(agentPlanReferences([{ parts: [part(id), part(otherId), part(id), part("bad"), { ...part(otherId), state: "output-error" }] }]), [otherId, id]);
  assert.throws(() => parsePlanReferences(Array(9).fill(id))); assert.throws(() => parsePlanReferences(["not-an-id"]));
});

test("restore selects corresponding current plan and rejects absent, foreign, cross-chat and expired references", async () => {
  const first = artifact(); const second = artifact(otherId);
  second.session = { ...second.session!, result: { rotation: { daily: { production: { pure_gold: 0, equivalent_gold: 0, lmd: 15000 }, drone_production: { pure_gold: 0, lmd: 0 } } } } };
  const load = async (key: string, user: string) => user === "owner" ? [first, second].find(p => p.id === key) ?? null : null;
  const context = new AgentScheduleContext("owner", "chat-a", [id, otherId], load);
  const latest = await context.read(); assert.equal(latest.available && latest.goldBalance.available && latest.goldBalance.netGoldBars, -30);
  const older = await context.read(id); assert.equal(older.available && older.goldBalance.available && older.goldBalance.netGoldBars, 14);
  assert.equal((await new AgentScheduleContext("foreign", "chat-a", [id], load).read()).available, false);
  assert.equal((await new AgentScheduleContext("owner", "other-chat", [id], load).read()).available, false);
  assert.equal((await new AgentScheduleContext("owner", "chat-a", [], load).read(id)).available, false);
  assert.equal((await new AgentScheduleContext("owner", "chat-a", [id, otherId], async key => key === id ? first : null).read()).available, false);
  assert.doesNotMatch(await scheduleContextPrompt(context), /PRIVATE_FULL_BOX|能天使/);
});

test("SDK follow-up ‘剩多少赤金’ reads the referenced plan through read_schedule", async () => {
  const context = new AgentScheduleContext("owner", "chat-a", [id], async (key, user) => key === id && user === "owner" ? artifact() : null);
  const finish = (reason: "stop" | "tool-calls"): LanguageModelV4StreamPart => ({ type: "finish", finishReason: { unified: reason, raw: reason }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } });
  let seen = false;
  const model = new MockLanguageModelV4({ doStream: async ({ prompt }) => {
    const toolResult = prompt.find(message => message.role === "tool");
    const parts: LanguageModelV4StreamPart[] = [];
    if (!toolResult) {
      assert.match(JSON.stringify(prompt), /剩多少赤金/);
      parts.push({ type: "tool-call", toolCallId: "read", toolName: "read_schedule", input: "{}" }, finish("tool-calls"));
    } else {
      const wire = JSON.stringify(toolResult);
      assert.match(wire, /netGoldBars.*14/); assert.match(wire, /aaaaaaaa-aaaa/); assert.match(wire, /能天使/);
      assert.doesNotMatch(wire, /PRIVATE_FULL_BOX/); seen = true;
      parts.push({ type: "text-start", id: "answer" }, { type: "text-delta", id: "answer", delta: "按对应排班，贸易消耗后每天净余14枚赤金；这不是仓库库存。" }, { type: "text-end", id: "answer" }, finish("stop"));
    }
    return { stream: new ReadableStream({ start(controller) { parts.forEach(part => controller.enqueue(part)); controller.close(); } }) };
  } });
  const response = streamText({ model, system: await scheduleContextPrompt(context), prompt: "剩多少赤金", tools: buildScheduleContextTools(context), stopWhen: stepCountIs(3) });
  assert.match(await response.text, /净余14枚/); assert.ok(seen); assert.equal(model.doStreamCalls.length, 2);
});
