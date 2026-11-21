import assert from "node:assert/strict";
import { createServer } from "node:http";
import { register, registerHooks } from "node:module";
import test from "node:test";
import { defaultRatePolicy } from "../billing/rate-policy.ts";
import { compileFilterPolicy } from "./filter-policy.ts";
import type { AgentModelSelection } from "./model-policy.ts";

register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) {
  return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context);
} });

test("real SDK streaming preserves cache writes for accounting without inventing missing usage", async t => {
  const originalEnv = { ...process.env };
  t.after(() => { process.env = originalEnv; });
  process.env.AGENT_GATEWAY_KEY = "test-only";
  const policy = defaultRatePolicy("1.2");
  policy.models.push({ provider: "riic-gpt", model: "gpt-6.1-sol", currency: "RMB", exchangeRate: "1", input: "2", cachedInput: "0.1", cacheWrite: "2.5", output: "10" });
  const finished: Array<{ usage?: { inputTokens: number; cachedInputTokens: number; cacheWriteTokens?: number }; error?: string }> = [];
  await t.mock.module(new URL("../billing/agent-accounting.ts", import.meta.url), { namedExports: {
    beginModelCall: async () => ({ id: "call:test", policy }),
    finishModelCall: async (input: (typeof finished)[number]) => { finished.push(input); },
    markRunDelivered: async () => {}, recordFilterEvent: async () => {}, settleAgentRun: async () => {},
  } });
  await t.mock.module(new URL("./gateway-route.ts", import.meta.url), { namedExports: { recordGatewayRoute: async () => {} } });
  const { createGatewayRun } = await import("./gateway-runtime.ts");
  let details: Record<string, unknown> = {};
  const serverErrors: unknown[] = [];
  const gateway = createServer((request, response) => {
    void (async () => {
      let raw = ""; for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      assert.equal(body.model, "riic-gpt/gpt-6.1-sol");
      assert.equal(body.reasoning_effort, "medium");
      response.writeHead(200, { "Content-Type": "text/event-stream", "X-Magpie-Provider": "riic-gpt", "X-Magpie-Model": "gpt-6.1-sol" });
      const chunk = { id: "cache-write:test", object: "chat.completion.chunk", created: 1, model: "gpt-6.1-sol" };
      for (const event of [
        { ...chunk, choices: [{ index: 0, delta: { content: "Verified reply." }, finish_reason: null }] },
        { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
        { ...chunk, choices: [], usage: { prompt_tokens: 15000, completion_tokens: 4, total_tokens: 15004, prompt_tokens_details: details } },
      ]) response.write(`data: ${JSON.stringify(event)}\n\n`);
      response.end("data: [DONE]\n\n");
    })().catch(error => { serverErrors.push(error); response.destroy(); });
  });
  await new Promise<void>(resolve => gateway.listen(0, "127.0.0.1", resolve));
  t.after(async () => { gateway.closeAllConnections(); await new Promise<void>(resolve => gateway.close(() => resolve())); });
  const address = gateway.address(); assert.ok(address && typeof address !== "string");
  process.env.AGENT_GATEWAY_URL = `http://127.0.0.1:${address.port}/v1`;
  const selection: AgentModelSelection = { id: "gpt", label: "GPT", enabled: true, provider: "riic-gpt", model: "gpt-6.1-sol", protocol: "responses", vision: true, policyVersion: "models:test", maxImages: 1, maxImageBytes: 1024, maxImagePixels: 1024, imageTokensPerImage: 100 };
  for (const [name, cacheDetails, expected, invalid] of [
    ["nonzero", { cached_tokens: 12000, cache_write_tokens: 3000 }, 3000, false],
    ["explicit zero", { cached_tokens: 12000, cache_write_tokens: 0 }, 0, false],
    ["missing", { cached_tokens: 12000 }, undefined, false],
    ["malformed", { cached_tokens: 12000, cache_write_tokens: "3000" }, undefined, true],
  ] as const) {
    await t.test(name, async () => {
      details = { ...cacheDetails }; finished.length = 0;
      const run = createGatewayRun({ runId: "run:test", sessionId: "session:test", requestId: "request:test", userId: "user:test", filterVersion: "filter:test", filter: compileFilterPolicy({ rules: [], allow: [] }), selection });
      const result = await run.model.doStream({ prompt: [{ role: "user", content: [{ type: "text", text: "Read this." }] }], maxOutputTokens: 2048 });
      const reader = result.stream.getReader();
      while (!(await reader.read()).done) { /* Exercise the actual SDK-to-accounting boundary. */ }
      assert.deepEqual(serverErrors, []);
      assert.equal(finished.length, 1);
      if (invalid) {
        assert.equal(finished[0].usage, undefined);
        assert.equal(finished[0].error, "invalid_cache_write_usage");
      } else {
        assert.equal(finished[0].usage?.inputTokens, 15000);
        assert.equal(finished[0].usage?.cachedInputTokens, 12000);
        assert.equal(finished[0].usage?.cacheWriteTokens, expected);
        assert.equal(Object.hasOwn(finished[0].usage!, "cacheWriteTokens"), expected !== undefined);
      }
    });
  }
});
