import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { convertToModelMessages, tool } from "ai";
import { z } from "zod";
import { agentArtifactFromOutput, consumeAgentArtifactHandoff, isAgentArtifactHandoff, receiveAgentArtifactMessage, requestAgentArtifactOpen } from "../apps/arknights/src/agent-artifact-bridge.ts";

const session = { presetLabel: "243", layout: { rooms: [] }, operbox: [{ name: "test" }], sourceName: "sample", boxSource: "sample", rotationProfile: "abc_12_12_12", fiammettaEnabled: false, result: { maa: { plans: [] }, diagnosticId: "first" }, activeShift: 0 };
const handoff = { preset: "243", session };

test("temporary handoff navigates same tab, consumes once, rejects invalid and expired data", () => {
  const storage = new Map<string, string>();
  const locations: string[] = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    sessionStorage: { setItem: (key: string, value: string) => storage.set(key, value), getItem: (key: string) => storage.get(key) ?? null, removeItem: (key: string) => storage.delete(key) },
    location: { assign: (url: string) => locations.push(url) },
  } });
  try {
    requestAgentArtifactOpen(handoff);
    assert.deepEqual(locations, ["/"]);
    assert.deepEqual(consumeAgentArtifactHandoff()?.session, session);
    assert.equal(storage.size, 0);
    assert.equal(consumeAgentArtifactHandoff(), null);
    for (const value of ["{", JSON.stringify({ ...handoff, expiresAt: 0 }), JSON.stringify({ artifactId: "old" })]) {
      storage.set("riic-agent-artifact-handoff", value);
      assert.throws(() => consumeAgentArtifactHandoff());
      assert.equal(storage.size, 0);
    }
    window.sessionStorage.setItem = () => { throw new Error("quota"); };
    assert.throws(() => requestAgentArtifactOpen(handoff), /临时交接失败/);
    assert.deepEqual(locations, ["/"]);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("broadcast payload preserves complete session and rejects obsolete or malformed messages", () => {
  assert.equal(agentArtifactFromOutput({ planUrl: "/plan/old" }), null);
  for (const value of [null, {}, { preset: "243", session: {} }, { ...handoff, session: { ...session, operbox: null } }]) {
    assert.equal(isAgentArtifactHandoff(value), false);
  }
  const first = agentArtifactFromOutput({ workbenchSession: session });
  const latest = agentArtifactFromOutput({ workbenchSession: { ...session, result: { ...session.result, diagnosticId: "latest" } } });
  let notice: unknown = null;
  const ready = (value: unknown) => { notice = structuredClone(value); };
  for (const data of [first, latest]) receiveAgentArtifactMessage({ type: "plan-ready", ...data }, ready);
  assert.deepEqual(notice, { type: "plan-ready", ...latest });
  receiveAgentArtifactMessage({ type: "plan-ready", artifactId: "old" }, ready);
  receiveAgentArtifactMessage({ type: "other", ...first }, ready);
  assert.deepEqual(notice, { type: "plan-ready", ...latest });
  assert.deepEqual(first?.session.operbox, session.operbox);
});

test("solve tool stops artifact writes and SDK projection excludes full session on subsequent turns", async () => {
  const source = await readFile(new URL("../apps/arknights/src/server/agent/tools.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /saveAgentPlanArtifact|planUrl|planArtifactNote/);
  const ast = ts.createSourceFile("tools.ts", source, ts.ScriptTarget.Latest, true);
  let projection = "";
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === "toModelOutput") projection = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(projection);
  const js = ts.transpile(`const project = ${projection};`, { target: ts.ScriptTarget.ES2022 });
  const project = new Function(`${js}; return project;`)();
  const output = { solved: true, plan: { plans: [], summary: { owned: 1 } }, workbenchSession: session };
  assert.deepEqual(JSON.parse(project({ output }).value), { solved: true, plan: output.plan });
  const tools = { solve_schedule: tool({ inputSchema: z.object({}), toModelOutput: project }) };
  const converted = await convertToModelMessages([{ id: "test", role: "assistant", parts: [{ type: "tool-solve_schedule", toolCallId: "call", input: {}, state: "output-available", output }] }], { tools });
  assert.doesNotMatch(JSON.stringify(converted), /workbenchSession|operbox|diagnosticId/);
  assert.match(JSON.stringify(converted), /owned/);
  const route = await readFile(new URL("../apps/arknights/src/app/api/agent/chat/route.ts", import.meta.url), "utf8");
  assert.match(route, /convertToModelMessages\(body.messages, \{ tools \}\)/);
});
