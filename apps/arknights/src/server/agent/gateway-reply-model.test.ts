import assert from "node:assert/strict";
import { createServer } from "node:http";
import { register, registerHooks } from "node:module";
import test from "node:test";
import { defaultRatePolicy, type ModelCallBudget } from "../billing/rate-policy.ts";
import { defaultModelPolicy } from "./model-policy.ts";

register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) {
  return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context);
} });

test("interrupted default-group replies retain the actual fallback identity before the final event", async t => {
  const originalEnv = { ...process.env };
  t.after(() => { process.env = originalEnv; });
  for (const key of Object.keys(process.env)) if (key.startsWith("AGENT_LLM_") || key.startsWith("AGENT_GATEWAY_")) delete process.env[key];
  process.env.AGENT_GATEWAY_MODELS = "deepseek,glm";
  process.env.AGENT_GATEWAY_OFFICIAL_FALLBACK_ENABLED = "1";
  process.env.AGENT_GATEWAY_KEY = "test-only";
  const rates = { id: "rates:test", policy: defaultRatePolicy("1.2") };
  const budgets: ModelCallBudget[] = [];
  const finished: Array<Record<string, unknown>> = [];
  const serverErrors: unknown[] = [];
  let returned = { provider: "riic-glm", model: "glm-5.3-flash" };
  const mocks: Array<[URL, Record<string, unknown>]> = [
    [new URL("../../../../../packages/platform-server/src/api-contract.ts", import.meta.url), { PublicApiError: class extends Error {} }],
    [new URL("./persona.ts", import.meta.url), { buildAgentSystemPrompt: async () => "You are a helpful assistant." }],
    [new URL("./tools.ts", import.meta.url), { buildAgentTools: () => ({}) }],
    [new URL("./gateway-route.ts", import.meta.url), { recordGatewayRoute: async () => {} }],
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
      settleAgentRun: async () => {},
    }],
  ];
  for (const [name, namedExports] of mocks) await t.mock.module(name, { namedExports });
  const { gatewayChat } = await import("./gateway-chat.ts");
  const gateway = createServer((request, response) => {
    void (async () => {
      let body = ""; for await (const chunk of request) body += chunk;
      assert.equal(JSON.parse(body).model, "group/riic-agent");
      const actual = { ...returned };
      response.writeHead(200, { "Content-Type": "text/event-stream", "X-Magpie-Provider": actual.provider, "X-Magpie-Model": `${actual.provider}/${actual.model}` });
      response.write(`data: ${JSON.stringify({ id: "reply:test", object: "chat.completion.chunk", created: 1, model: actual.model,
        choices: [{ index: 0, delta: { content: "This partial answer came from the actual fallback model." }, finish_reason: null }] })}\n\n`);
      // Deliver a real HTTP/SSE prefix, then fail before usage and finish arrive.
      setTimeout(() => response.destroy(), 25);
    })().catch(error => { serverErrors.push(error); response.destroy(); });
  });
  await new Promise<void>(resolve => gateway.listen(0, "127.0.0.1", resolve));
  t.after(async () => { gateway.closeAllConnections(); await new Promise<void>(resolve => gateway.close(() => resolve())); });
  const address = gateway.address(); assert.ok(address && typeof address !== "string");
  process.env.AGENT_GATEWAY_URL = `http://127.0.0.1:${address.port}/v1`;

  for (const actual of [{ provider: "riic-glm", model: "glm-5.3-flash" }, { provider: "riic-deepseek-official", model: "deepseek-flash" }, { provider: "riic-gpt", model: "gpt-6.1-sol" }]) {
    await t.test(actual.provider, async () => {
      returned = actual; budgets.length = 0; finished.length = 0;
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
      assert.ok(finished.some(call => call.provider === actual.provider && call.model === actual.model && call.error === (outsideGroup ? "identity_failed" : "stream_failed")));
    });
  }
  assert.deepEqual(serverErrors, []);
});
