import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import test from "node:test";

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
  const calls: string[] = [];
  class PublicApiError extends Error {
    code: string;
    constructor(code: string, options?: { message?: string }) {
      super(options?.message ?? code);
      this.code = code;
    }
  }
  const unexpected = () => { throw new Error("Unexpected billing operation"); };
  const mocks: Array<[string | URL, Record<string, unknown>]> = [
    ["node:fs/promises", { appendFile: async () => {} }],
    ["ai", {
      convertToModelMessages: async (messages: unknown) => messages,
      stepCountIs: () => () => false,
      streamText: ({ model }: { model: string }) => {
        calls.push(`direct:${model}`);
        return { toUIMessageStream: () => new ReadableStream({ start(controller) { controller.close(); } }) };
      },
      createUIMessageStreamResponse: () => Response.json({ mode: "direct" }),
    }],
    [new URL("../api-contract.ts", import.meta.url), {
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
      createAgentUsage: unexpected, finalizeAgentUsage: unexpected,
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
    [new URL("../billing/pricing.ts", import.meta.url), { calculateAgentTokenCost: unexpected }],
    [new URL("../billing/points.ts", import.meta.url), { splitPoints: unexpected }],
    [new URL("../billing/agent-accounting.ts", import.meta.url), { AgentAccountingError: class extends Error {} }],
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
    for (const model of [undefined, "deepseek", "glm"]) {
      calls.length = 0;
      const response = await post(model);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { mode: "direct" });
      assert.deepEqual(calls, [`direct:${model ?? "deepseek"}`]);
    }
  });
});
