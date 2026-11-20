import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import test from "node:test";
import { defaultRatePolicy } from "../billing/rate-policy.ts";
import { calculateAgentTokenCost } from "../billing/pricing.ts";
import { splitPoints } from "../billing/points.ts";

register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) {
  return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context);
} });

test("chat API separates automatic gateway routing from direct model selection", async t => {
  const originalEnv = { ...process.env };
  t.after(() => { process.env = originalEnv; });
  for (const key of Object.keys(process.env)) if (key.startsWith("AGENT_LLM_")) delete process.env[key];
  let automatic = true;
  let allowed = true;
  let sameOrigin = true;
  let balance = 1;
  let configuredRates = true;
  let rates = { id: "rates:test-1", policy: defaultRatePolicy("1.5") };
  let finish: (event: Record<string, unknown>) => Promise<void>;
  const settled: Array<Record<string, unknown>> = [];
  const calls: string[] = [];
  class PublicApiError extends Error {
    code: string;
    constructor(code: string, options?: { message?: string }) {
      super(options?.message ?? code);
      this.code = code;
    }
  }
  const mocks: Array<[string | URL, Record<string, unknown>]> = [
    ["node:fs/promises", { appendFile: async () => {} }],
    ["ai", {
      convertToModelMessages: async (messages: unknown) => messages,
      stepCountIs: () => () => false,
      streamText: ({ model, onFinish }: { model: string; onFinish: typeof finish }) => {
        calls.push(`direct:${model}`);
        finish = onFinish;
        return { toUIMessageStream: () => new ReadableStream({ start(controller) { controller.close(); } }) };
      },
      createUIMessageStreamResponse: () => Response.json({ mode: "direct" }),
    }],
    [new URL("../../../../../packages/platform-server/src/api-contract.ts", import.meta.url), {
      PublicApiError,
      createRequestId: () => "chat-model-test",
      assertSameOrigin: () => { if (!sameOrigin) throw new PublicApiError("AIC-AUTH-2002"); },
      enforceRateLimit: () => { calls.push("rate"); },
      readJsonBody: (request: Request) => request.json(),
      successResponse: (data: unknown) => Response.json({ success: true, data }),
      failureResponse: (error: Error) => Response.json({
        success: false,
        error: { code: error instanceof PublicApiError ? error.code : "AIC-SYS-5000", message: error.message },
      }, { status: error instanceof PublicApiError
        ? error.code === "AIC-BILLING-4101" ? 402 : error.code.startsWith("AIC-AUTH-") ? 403 : 400
        : 500 }),
    }],
    [new URL("../auth/feature-access.ts", import.meta.url), {
      requireFeatureSession: async () => {
        if (!allowed) throw new PublicApiError("AIC-AUTH-2009");
        return { user: { id: "test-admin" } };
      },
    }],
    [new URL("../billing/service.ts", import.meta.url), {
      getWallet: async () => ({ totalPoints: balance }),
      createAgentUsage: async () => "test-usage",
      finalizeAgentUsage: async (input: Record<string, unknown>) => { settled.push(input); },
    }],
    [new URL("./gateway-runtime.ts", import.meta.url), {
      agentGatewayEnabled: () => automatic,
      gatewaySettings: () => ({ model: "group/riic-agent" }),
    }],
    [new URL("./gateway-chat.ts", import.meta.url), {
      gatewayChat: async (_request: Request, userId: string) => {
        assert.equal(userId, "test-admin");
        calls.push("gateway");
        return Response.json({ mode: "gateway" });
      },
    }],
    [new URL("./llm.ts", import.meta.url), { getAgentModel: (settings: { provider: string }) => settings.provider }],
    [new URL("./stream-policy.ts", import.meta.url), {
      createAgentStreamPolicy: () => ({ options: {}, transform: new TransformStream() }),
    }],
    [new URL("./persona.ts", import.meta.url), { buildAgentSystemPrompt: async () => "test" }],
    [new URL("./persona-catalog.ts", import.meta.url), {
      listBuiltinAgentPersonas: async () => [], resolveAgentPersonaContent: async () => undefined,
    }],
    [new URL("./tools.ts", import.meta.url), { buildAgentTools: () => ({}) }],
    [new URL("../billing/pricing.ts", import.meta.url), { calculateAgentTokenCost }],
    [new URL("../billing/points.ts", import.meta.url), { splitPoints }],
    [new URL("../billing/agent-accounting.ts", import.meta.url), {
      AgentAccountingError: class extends Error {},
      activeAgentPolicies: async () => { if (!configuredRates) throw new Error("Pricing not configured"); return { rates: structuredClone(rates) }; },
    }],
    [new URL("./filter-policy.ts", import.meta.url), { AgentFilterError: class extends Error {} }],
    [new URL("./message-history.ts", import.meta.url), {
      AgentHistoryError: class extends Error {}, prepareAgentHistory: async (messages: unknown) => messages,
    }],
    [new URL("./answer-boundary.ts", import.meta.url), { withAgentAnswerBoundary: (model: unknown) => model }],
    [new URL("./resources.ts", import.meta.url), { activeAgentResources: async () => null }],
    [new URL("../../agent-page-context.ts", import.meta.url), {
      agentPageContextPrompt: () => "", normalizeAgentPageContext: () => null,
    }],
  ];
  for (const [specifier, namedExports] of mocks) await t.mock.module(specifier, { namedExports });
  const { GET, POST } = await import("../../app/api/agent/chat/route.ts");
  const post = (model?: unknown, extra: Record<string, unknown> = {}) => POST(new Request("https://riic.test/api/agent/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model, conversationId: "test-conversation", attemptId: "test-attempt-0001",
      messages: [{ id: "question", role: "user", parts: [{ type: "text", text: "hello" }] }],
      ...extra,
    }),
  }));

  await t.test("gateway-only metadata with a null provider can be sent back by an existing client", async () => {
    const metadata = await (await GET(new Request("https://riic.test/api/agent/chat"))).json();
    assert.equal(metadata.data.enabled, true);
    assert.equal(metadata.data.automatic, true);
    assert.equal(metadata.data.provider, null);
    assert.deepEqual(metadata.data.models, []);
    calls.length = 0;
    const response = await post(metadata.data.provider);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { mode: "gateway" });
    assert.deepEqual(calls, ["rate", "gateway"]);
  });

  await t.test("gateway mode ignores missing and stale client model selections, including retries", async () => {
    for (const model of [undefined, "deepseek", "glm", "group/riic-agent", "stale-model"]) {
      calls.length = 0;
      const response = await post(model, { attemptId: "test-retry-attempt-0002" });
      assert.equal(response.status, 200);
      assert.deepEqual(calls, ["rate", "gateway"]);
    }
  });

  await t.test("gateway requests still require access, credit, origin and valid messages", async () => {
    calls.length = 0;
    allowed = false;
    assert.equal((await post(null)).status, 403);
    allowed = true;
    balance = 0;
    assert.equal((await post(null)).status, 402);
    balance = 1;
    sameOrigin = false;
    assert.equal((await post(null)).status, 403);
    sameOrigin = true;
    assert.equal((await post(null, { messages: [] })).status, 400);
    assert.equal((await post(null, { pageContext: { invalid: true } })).status, 400);
    assert.ok(!calls.includes("gateway"));
  });

  await t.test("direct mode rejects unsupported model selections", async () => {
    automatic = false;
    for (const model of [null, "group/riic-agent", "stale-model", 42, {}]) {
      calls.length = 0;
      const response = await post(model);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "AIC-REQ-1001");
      assert.deepEqual(calls, []);
    }
  });

  await t.test("direct mode still requires credentials and selects the configured provider", async () => {
    assert.equal((await post("deepseek")).status, 503);
    process.env.AGENT_LLM_PROVIDER = "deepseek";
    process.env.AGENT_LLM_DEEPSEEK_API_KEY = "test-deepseek-key";
    process.env.AGENT_LLM_GLM_API_KEY = "test-glm-key";
    process.env.AGENT_LLM_DEEPSEEK_MODEL = "deepseek-v4.1-flash";
    process.env.AGENT_LLM_GLM_MODEL = "glm-5.3-flash";
    for (const model of [undefined, "deepseek", "glm"]) {
      calls.length = 0;
      const response = await post(model);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { mode: "direct" });
      assert.deepEqual(calls, [`direct:${model ?? "deepseek"}`]);
    }
  });

  const responseEvent = (model = "deepseek-v4.1-flash", usage: Record<string, unknown> = { inputTokens: 1000, outputTokens: 100, inputTokenDetails: { cacheReadTokens: 100 } }) => ({
    model: { modelId: "deepseek-v4.1-flash" }, response: { modelId: model }, totalUsage: usage,
    toolResults: [], steps: [{ response: { modelId: model } }], finishReason: "stop",
  });

  await t.test("direct billing uses the published multiplier and keeps its snapshot across a publication", async () => {
    for (const row of rates.policy.models) delete row.peak;
    settled.length = 0;
    assert.equal((await post("deepseek")).status, 200);
    const originalFinish = finish;
    rates = { id: "rates:test-2", policy: { ...rates.policy, markup: "2" } };
    await originalFinish(responseEvent());
    assert.equal(settled[0].chargedPoints, 0.0195);
    assert.equal((settled[0].metadata as Record<string, unknown>).rateVersion, "rates:test-1");
    assert.equal((await post("deepseek")).status, 200);
    await finish(responseEvent());
    assert.equal(settled[1].chargedPoints, 0.026);
    assert.equal((settled[1].metadata as Record<string, unknown>).rateVersion, "rates:test-2");
  });

  await t.test("missing policy and an unpriced model stop before the upstream request", async () => {
    calls.length = 0;
    configuredRates = false;
    assert.notEqual((await post("deepseek")).status, 200);
    configuredRates = true;
    process.env.AGENT_LLM_DEEPSEEK_MODEL = "deepseek-unpriced";
    assert.notEqual((await post("deepseek")).status, 200);
    process.env.AGENT_LLM_DEEPSEEK_MODEL = "deepseek-v4.1-flash";
    assert.ok(!calls.some(call => call.startsWith("direct:")));
  });

  await t.test("unknown returned model and missing usage remain unconfirmed", async () => {
    const mixedModels = responseEvent();
    mixedModels.steps.unshift({ response: { modelId: "unexpected-model" } });
    const missingModel = responseEvent();
    missingModel.steps = [];
    for (const event of [responseEvent("unexpected-model"), mixedModels, missingModel, responseEvent("deepseek-v4.1-flash", { outputTokens: 10 })]) {
      settled.length = 0;
      assert.equal((await post("deepseek")).status, 200);
      await finish(event);
      assert.equal(settled[0].chargedPoints, undefined);
      assert.equal((settled[0].metadata as Record<string, unknown>).usageConfirmed, false);
    }
    assert.equal(settled[0].inputTokens, undefined);
  });
});
