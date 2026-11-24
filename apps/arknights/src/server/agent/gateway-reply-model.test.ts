import assert from "node:assert/strict";
import { createServer } from "node:http";
import { register, registerHooks } from "node:module";
import test from "node:test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { defaultRatePolicy, priceModelCall, type ModelCallBudget } from "../billing/rate-policy.ts";
import { defaultModelPolicy, type AgentModelSelection } from "./model-policy.ts";
import { compileFilterPolicy } from "./filter-policy.ts";

register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) {
  return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context);
} });

test("gateway replies and accounting use verified stream member identity instead of early HTTP headers", async t => {
  const originalEnv = { ...process.env };
  t.after(() => { process.env = originalEnv; });
  for (const key of Object.keys(process.env)) if (key.startsWith("AGENT_LLM_") || key.startsWith("AGENT_GATEWAY_")) delete process.env[key];
  process.env.AGENT_GATEWAY_MODELS = "deepseek,glm";
  process.env.AGENT_GATEWAY_OFFICIAL_FALLBACK_ENABLED = "1";
  process.env.AGENT_GATEWAY_KEY = "test-only";
  const rates = { id: "rates:test", policy: defaultRatePolicy("1.2") };
  const primaryModel = rates.policy.models.find(row => row.provider === "riic-deepseek")!.model;
  const budgets: ModelCallBudget[] = [];
  const finished: Array<Record<string, unknown>> = [];
  const traces: Array<Record<string, unknown>> = [];
  const settlements: string[] = [];
  const serverErrors: unknown[] = [];
  let returned = { provider: "riic-glm", model: "glm-5.3-flash" };
  let scenario: { member?: string | null; headers?: "missing"; end?: "complete" | "cancel"; idOnlyPrefix?: boolean; tool?: boolean; usageOnly?: boolean } = {};
  const mocks: Array<[URL, Record<string, unknown>]> = [
    [new URL("../../../../../packages/platform-server/src/api-contract.ts", import.meta.url), { PublicApiError: class extends Error {} }],
    [new URL("./persona.ts", import.meta.url), { buildAgentSystemPrompt: async () => "You are a helpful assistant." }],
    [new URL("./tools.ts", import.meta.url), { buildAgentTools: () => ({}) }],
    [new URL("./gateway-route.ts", import.meta.url), { recordGatewayRoute: async (input: Record<string, unknown>) => { traces.push(input); } }],
    [new URL("../billing/agent-accounting.ts", import.meta.url), {
      activeAgentPolicies: async () => ({ rates, models: { id: "models:test", policy: defaultModelPolicy() }, filter: { id: "filter:test", policy: { rules: [], allow: [] } } }),
      agentSessionId: () => "session:test",
      beginAgentRun: async () => "run:test",
      beginModelCall: async (_run: string, _step: number, budget: ModelCallBudget) => { budgets.push(budget); return { id: "call:test", policy: rates.policy }; },
      finishModelCall: async (input: Record<string, unknown>) => { finished.push(input); },
      beginToolCharge: async () => { throw new Error("Unexpected tool charge"); },
      finishToolCharge: async () => {},
      markRunDelivered: async () => {},
      recordFilterEvent: async () => {},
      settleAgentRun: async (_run: string, state: string) => { settlements.push(state); },
    }],
  ];
  for (const [name, namedExports] of mocks) await t.mock.module(name, { namedExports });
  const { gatewayChat } = await import("./gateway-chat.ts");
  const { createGatewayRun } = await import("./gateway-runtime.ts");
  const gateway = createServer((request, response) => {
    void (async () => {
      let body = ""; for await (const chunk of request) body += chunk;
      assert.equal(JSON.parse(body).model, "group/riic-agent");
      assert.equal(request.headers["x-magpie-response-model"], "member");
      const actual = { ...returned };
      // These headers were committed for the primary before the final fallback.
      response.writeHead(200, { "Content-Type": "text/event-stream", ...(scenario.headers === "missing" ? {} : { "X-Magpie-Provider": "riic-deepseek", "X-Magpie-Model": `riic-deepseek/${primaryModel}` }) });
      if (scenario.usageOnly) {
        response.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } })}\n\ndata: [DONE]\n\n`);
        return;
      }
      const chunk = { id: "reply:test", object: "chat.completion.chunk", created: 1,
        ...(scenario.member === null ? {} : { model: scenario.member ?? `${actual.provider}/${actual.model}` }) };
      if (scenario.idOnlyPrefix) response.write(`data: ${JSON.stringify({ id: "placeholder:test", choices: [] })}\n\n`);
      response.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: scenario.tool
        ? { tool_calls: [{ index: 0, id: "call-tool", type: "function", function: { name: "unsafe_tool", arguments: "{}" } }] }
        : { content: "This partial answer came from the actual fallback model." }, finish_reason: null }] })}\n\n`);
      if (scenario.end === "complete") {
        response.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: scenario.tool ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } })}\n\n`);
        response.end("data: [DONE]\n\n");
      } else if (scenario.end !== "cancel") {
        // Deliver a real HTTP/SSE prefix, then fail before usage and finish arrive.
        setTimeout(() => response.destroy(), 25);
      }
    })().catch(error => { serverErrors.push(error); response.destroy(); });
  });
  await new Promise<void>(resolve => gateway.listen(0, "127.0.0.1", resolve));
  t.after(async () => { gateway.closeAllConnections(); await new Promise<void>(resolve => gateway.close(() => resolve())); });
  const address = gateway.address(); assert.ok(address && typeof address !== "string");
  process.env.AGENT_GATEWAY_URL = `http://127.0.0.1:${address.port}/v1`;

  for (const actual of [{ provider: "riic-glm", model: "glm-5.3-flash" }, { provider: "riic-deepseek-official", model: "deepseek-flash" }, { provider: "riic-gpt", model: "gpt-6.1-sol" }]) {
    await t.test(actual.provider, async () => {
      returned = actual; budgets.length = 0; finished.length = 0; traces.length = 0; settlements.length = 0;
      const response = await gatewayChat(new Request("https://riic.test/api/agent/chat"), "user:test", "request:test", {
        model: "deepseek", conversationId: "conversation:test", attemptId: "request-attempt-test", messages: [{ id: "user-message", role: "user", parts: [{ type: "text", text: "Give a partial answer." }] }],
      });
      const reader = response.body!.getReader(); const decoder = new TextDecoder(); let raw = "";
      try { while (true) { const chunk = await reader.read(); if (chunk.done) break; raw += decoder.decode(chunk.value, { stream: true }); } } catch { /* Partial UI replies survive a broken transport. */ }
      const chunks = raw.split(/\r?\n/).filter(line => line.startsWith("data: ") && line !== "data: [DONE]").map(line => JSON.parse(line.slice(6)) as Record<string, unknown>);
      const outsideGroup = actual.provider === "riic-gpt";
      assert.equal(chunks.some(chunk => chunk.type === "text-delta"), !outsideGroup);
      assert.equal(budgets.length, 1);
      assert.deepEqual(budgets[0].routes?.map(route => route.provider), ["riic-deepseek", "riic-glm", "riic-deepseek-official"]);
      if (!outsideGroup) {
        const metadata = chunks.flatMap(chunk => chunk.messageMetadata ? [chunk.messageMetadata as { replyModel: { id: string; label: string } }] : []);
        assert.deepEqual(metadata.at(-1)?.replyModel, { id: actual.provider, label: actual.model });
        assert.equal(chunks.some(chunk => chunk.type === "finish"), false, "the identity must arrive before a successful finish");
      }
      assert.equal(finished.length, 1);
      assert.equal(finished[0].provider, outsideGroup ? undefined : actual.provider);
      assert.equal(finished[0].model, outsideGroup ? undefined : actual.model);
      assert.equal(finished[0].error, outsideGroup ? "identity_failed" : "stream_failed");
      assert.equal(finished[0].usage, undefined);
      assert.equal(traces[0].model, outsideGroup ? undefined : `${actual.provider}/${actual.model}`);
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.deepEqual(settlements, ["failed"], "native stream errors must settle without SDK callbacks");
    });
  }

  for (const cancelled of [false, true]) {
    await t.test(cancelled ? "aborted HTTP stream settles once" : "successful HTTP stream settles once", async () => {
      returned = { provider: "riic-deepseek-official", model: "deepseek-flash" };
      scenario = { end: cancelled ? "cancel" : "complete" }; settlements.length = 0; finished.length = 0;
      const abort = new AbortController();
      const response = await gatewayChat(new Request("https://riic.test/api/agent/chat", { signal: abort.signal }), "user:test", "request:test", {
        model: "deepseek", conversationId: "conversation:test", attemptId: "request-attempt-test", messages: [{ id: "user-message", role: "user", parts: [{ type: "text", text: "Give an answer." }] }],
      });
      const reader = response.body!.getReader(); const decoder = new TextDecoder(); let raw = "";
      try {
        while (true) {
          const item = await reader.read(); if (item.done) break;
          raw += decoder.decode(item.value, { stream: true });
          if (cancelled && raw.includes('"type":"text-delta"')) abort.abort();
        }
      } catch (error) { if (!cancelled) throw error; }
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.deepEqual(settlements, [cancelled ? "cancelled" : "completed"]);
      assert.ok(finished.length > 0);
      assert.ok(finished.every(call => call.provider === returned.provider && call.model === returned.model));
      if (cancelled) assert.ok(finished.every(call => call.usage === undefined), "abort must not invent usage");
      else assert.equal(finished.length, 1);
    });
  }

  const selection: AgentModelSelection = { ...defaultModelPolicy().models[0], provider: "riic-deepseek", model: primaryModel, protocol: "chat", vision: false, policyVersion: "models:test", gatewayModel: "group/riic-agent",
    routes: [{ provider: "riic-deepseek", model: primaryModel }, { provider: "riic-glm", model: "glm-5.3-flash" }, { provider: "riic-deepseek-official", model: "deepseek-flash" }] };
  const startRun = (selected = selection) => createGatewayRun({ runId: "run:test", sessionId: "session:test", requestId: "request:test", userId: "user:test", filterVersion: "filter:test", filter: compileFilterPolicy({ rules: [], allow: [] }), selection: selected });
  const streamOptions = { prompt: [{ role: "user" as const, content: [{ type: "text" as const, text: "Give a verified answer." }] }], maxOutputTokens: 2048 };
  returned = { provider: "riic-deepseek-official", model: "deepseek-flash" };
  // Distinct prices make an accidental return to HTTP identity observable.
  const officialRate = rates.policy.models.find(row => row.provider === returned.provider)!;
  officialRate.input = "9"; officialRate.output = "18";
  for (const headers of [undefined, "missing"] as const) {
    await t.test(`complete fallback with ${headers ?? "stale"} HTTP identity`, async () => {
      scenario = { end: "complete", headers }; finished.length = 0; traces.length = 0;
      const run = startRun(); const result = await run.model.doStream(streamOptions);
      const parts: LanguageModelV4StreamPart[] = []; const reader = result.stream.getReader();
      while (true) { const item = await reader.read(); if (item.done) break; parts.push(item.value); }
      assert.equal(parts.filter(part => part.type === "text-delta").map(part => part.delta).join(""), "This partial answer came from the actual fallback model.");
      assert.deepEqual(run.replyModel(), { id: returned.provider, label: returned.model });
      assert.equal(finished.length, 1);
      assert.equal(finished[0].provider, returned.provider); assert.equal(finished[0].model, returned.model);
      assert.deepEqual(finished[0].usage, { inputTokens: 10, outputTokens: 2, cachedInputTokens: 0, reasoningTokens: 0 });
      assert.equal(finished[0].gatewayRequestId, "reply:test");
      const usage = finished[0].usage as { inputTokens: number; outputTokens: number; cachedInputTokens: number };
      const at = new Date("2026-11-22T00:00:00Z");
      assert.notEqual(priceModelCall(rates.policy, returned.provider, returned.model, usage, at).chargedRmb,
        priceModelCall(rates.policy, "riic-deepseek", primaryModel, usage, at).chargedRmb);
      assert.equal(traces[0].model, `${returned.provider}/${returned.model}`);
    });
  }
  const rejectedCases: Array<[string, typeof scenario, AgentModelSelection, boolean]> = [
    ["missing stream model", { member: null }, selection, false],
    ["bare model cannot identify its provider", { member: "deepseek-flash" }, selection, false],
    ["unselected member", { member: "riic-gpt/gpt-6.1-sol" }, selection, false],
    ["unknown member cannot execute tools", { member: "other/deepseek-flash", tool: true }, selection, false],
    ["id-only metadata is not repaired by later SSE model", { idOnlyPrefix: true }, selection, false],
    ["usage and finish without metadata", { usageOnly: true }, selection, false],
    ["ambiguous member", {}, { ...selection, routes: [...selection.routes!, selection.routes![2]] }, false],
    ["missing frozen rate", {}, selection, true],
  ];
  for (const [name, override, selected, missingRate] of rejectedCases) {
    await t.test(name, async () => {
      scenario = { ...override, end: "complete" }; finished.length = 0;
      const savedRates = rates.policy.models;
      if (missingRate) rates.policy.models = savedRates.filter(row => row.provider !== returned.provider);
      try {
        const run = startRun(selected); const result = await run.model.doStream(streamOptions);
        const parts: LanguageModelV4StreamPart[] = []; const reader = result.stream.getReader();
        await assert.rejects(async () => { while (true) { const item = await reader.read(); if (item.done) break; parts.push(item.value); } }, /本次回复中断/);
        assert.ok(parts.every(part => part.type === "stream-start"), "unverified identity must not deliver content or tool calls");
        assert.equal(finished.length, 1);
        assert.equal(finished[0].error, "identity_failed");
        assert.equal(finished[0].provider, undefined); assert.equal(finished[0].model, undefined); assert.equal(finished[0].usage, undefined);
      } finally { rates.policy.models = savedRates; }
    });
  }
  await t.test("cancellation retains verified member without guessing usage", async () => {
    scenario = { end: "cancel" }; finished.length = 0;
    const run = startRun(); const result = await run.model.doStream(streamOptions); const reader = result.stream.getReader();
    while (true) { const item = await reader.read(); assert.equal(item.done, false); if (item.value?.type === "text-delta") break; }
    await reader.cancel("test cancellation");
    assert.deepEqual(run.replyModel(), { id: returned.provider, label: returned.model });
    assert.equal(finished.length, 1);
    assert.equal(finished[0].provider, returned.provider); assert.equal(finished[0].model, returned.model);
    assert.equal(finished[0].error, "cancelled"); assert.equal(finished[0].usage, undefined);
  });
  assert.deepEqual(serverErrors, []);
});
