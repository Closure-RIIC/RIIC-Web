import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV4, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { jsonSchema, stepCountIs, streamText, tool, type UIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { AGENT_INTERRUPTED_ERROR, AGENT_UNAVAILABLE_ERROR, AGENT_TIMEOUT_ERROR, agentChatErrorMessage } from "../../agent-chat-errors.ts";
import { createAgentStreamPolicy, withAgentModelTimeout } from "./stream-policy.ts";

const limits = { firstChunkMs: 60, chunkMs: 60, totalMs: 2_000 };
const finish = (reason: "stop" | "tool-calls" = "stop"): LanguageModelV4StreamPart => ({
  type: "finish", finishReason: { unified: reason, raw: reason },
  usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
});

function waitingModel(parts: LanguageModelV4StreamPart[] = []) {
  return new MockLanguageModelV4({ doStream: async ({ abortSignal }) => ({
    stream: new ReadableStream<LanguageModelV4StreamPart>({ start(controller) {
      controller.enqueue({ type: "stream-start", warnings: [] });
      parts.forEach((part) => controller.enqueue(part));
      // Provider metadata/keepalives must not extend the semantic-output timer.
      const timer = setInterval(() => controller.enqueue({ type: "raw", rawValue: ": keep-alive" }), 5);
      abortSignal!.addEventListener("abort", () => {
        clearInterval(timer);
        controller.error(abortSignal!.reason);
      }, { once: true });
    } }),
  }) });
}

async function collect(model: LanguageModelV4, signal = new AbortController().signal, timeout = limits) {
  const policy = createAgentStreamPolicy(signal, timeout);
  const result = streamText({ model: withAgentModelTimeout(model, timeout), prompt: "test", ...policy.options, onError() {} });
  return readChunks(result.toUIMessageStream({ onError: policy.errorText }).pipeThrough(policy.transform));
}

async function readChunks(stream: ReadableStream<UIMessageChunk>) {
  const chunks: UIMessageChunk[] = [];
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return chunks;
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
}

test("keepalives without content time out, cancel upstream, and become one retryable error", { timeout: 5_000 }, async () => {
  const model = waitingModel();
  const chunks = await collect(model);
  assert.deepEqual(chunks.filter((chunk) => chunk.type === "error"), [{ type: "error", errorText: AGENT_TIMEOUT_ERROR }]);
  assert.equal(chunks.some((chunk) => chunk.type === "abort"), false);
  assert.equal(model.doStreamCalls.length, 1);
  assert.equal(model.doStreamCalls[0].abortSignal?.aborted, true);
});

test("a stalled answer preserves emitted text and ends with a timeout error", { timeout: 5_000 }, async () => {
  const chunks = await collect(waitingModel([{ type: "text-start", id: "text" }, { type: "text-delta", id: "text", delta: "partial answer" }]));
  assert.ok(chunks.some((chunk) => chunk.type === "text-delta" && chunk.delta === "partial answer"));
  assert.ok(chunks.some((chunk) => chunk.type === "error" && chunk.errorText === AGENT_TIMEOUT_ERROR));
});

test("user cancellation stays a normal stop instead of a timeout error", { timeout: 5_000 }, async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20);
  try {
    const chunks = await collect(waitingModel(), controller.signal);
    assert.ok(chunks.some((chunk) => chunk.type === "abort"));
    assert.equal(chunks.some((chunk) => chunk.type === "error"), false);
  } finally { clearTimeout(timer); }
});

test("stopping a partial reply is not misreported as an upstream interruption", { timeout: 5_000 }, async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30);
  try {
    const chunks = await collect(waitingModel([{ type: "text-start", id: "text" }, { type: "text-delta", id: "text", delta: "partial" }]), controller.signal);
    assert.ok(chunks.some((chunk) => chunk.type === "abort"));
    assert.equal(chunks.some((chunk) => chunk.type === "error"), false);
  } finally { clearTimeout(timer); }
});

test("the overall request deadline also becomes a retryable timeout", { timeout: 5_000 }, async () => {
  const chunks = await collect(waitingModel(), new AbortController().signal, { ...limits, firstChunkMs: 1_000, totalMs: 30 });
  assert.ok(chunks.some((chunk) => chunk.type === "error" && chunk.errorText === AGENT_TIMEOUT_ERROR));
  assert.equal(chunks.some((chunk) => chunk.type === "abort"), false);
});

test("connection timeout surfaces through the actual provider without automatic retry", { timeout: 5_000 }, async () => {
  let calls = 0;
  const upstream: typeof fetch = async (_input, init) => {
    calls++;
    return new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
    });
  };
  const model = createOpenAICompatible({ name: "test", baseURL: "https://example.test/v1", fetch: upstream }).chatModel("test");
  const chunks = await collect(model);
  assert.ok(chunks.some((chunk) => chunk.type === "error" && chunk.errorText === AGENT_TIMEOUT_ERROR));
  assert.equal(calls, 1);
});

test("tool execution can exceed the content idle limit and resume a successful answer", { timeout: 5_000 }, async () => {
  const model = new MockLanguageModelV4({ doStream: [
    { stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: "tool-call", toolCallId: "lookup", toolName: "lookup", input: "{}" });
      controller.enqueue(finish("tool-calls"));
      controller.close();
    } }) },
    { stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: "text-start", id: "answer" });
      controller.enqueue({ type: "text-delta", id: "answer", delta: "done" });
      controller.enqueue({ type: "text-end", id: "answer" });
      controller.enqueue(finish());
      controller.close();
    } }) },
  ] });
  const policy = createAgentStreamPolicy(new AbortController().signal, limits);
  const result = streamText({ model: withAgentModelTimeout(model, limits), prompt: "test", ...policy.options, stopWhen: stepCountIs(2), tools: {
    lookup: tool({ inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {} }), execute: async () => { await delay(120); return { ok: true }; } }),
  } });
  const chunks = await readChunks(result.toUIMessageStream({ onError: policy.errorText }).pipeThrough(policy.transform));
  assert.equal(chunks.some((chunk) => chunk.type === "error" || chunk.type === "abort"), false);
  assert.ok(chunks.some((chunk) => chunk.type === "text-delta" && chunk.delta === "done"));
  assert.equal(model.doStreamCalls.length, 2);
});

test("timeout text is localized without replacing unrelated failures", () => {
  assert.match(agentChatErrorMessage(AGENT_TIMEOUT_ERROR, false), /超时/);
  assert.match(agentChatErrorMessage(AGENT_TIMEOUT_ERROR, true), /timed out/);
  assert.equal(agentChatErrorMessage("specific failure", false), "specific failure");
});

test("upstream URLs, credentials and raw errors never enter public error text", () => {
  const policy = createAgentStreamPolicy(new AbortController().signal);
  assert.equal(policy.errorText(new Error("https://gateway.test failed with private-api-token")), AGENT_UNAVAILABLE_ERROR);
  assert.equal(policy.errorText({ responseBody: "private-api-token" }), AGENT_UNAVAILABLE_ERROR);
  assert.match(agentChatErrorMessage(AGENT_UNAVAILABLE_ERROR, false), /切换模型/);
});

test("a truncated stream preserves output and reports failure without replaying it", async () => {
  const model = new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({ start(controller) {
    controller.enqueue({ type: "text-start", id: "answer" });
    controller.enqueue({ type: "text-delta", id: "answer", delta: "partial" });
    controller.close();
  } }) }) });
  const chunks = await collect(model);
  assert.equal(model.doStreamCalls.length, 1);
  assert.ok(chunks.some((chunk) => chunk.type === "text-delta" && chunk.delta === "partial"));
  assert.ok(chunks.some((chunk) => chunk.type === "error" && chunk.errorText === AGENT_INTERRUPTED_ERROR));
});

test("transient connection errors retry before output; successful output is emitted once", { timeout: 10_000 }, async () => {
  let calls = 0;
  const upstream: typeof fetch = async () => {
    if (++calls === 1) return new Response(JSON.stringify({ error: { message: "private upstream details" } }), { status: 503, headers: { "content-type": "application/json" } });
    return new Response([
      { choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ].map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  };
  const model = createOpenAICompatible({ name: "test", baseURL: "https://example.test/v1", fetch: upstream }).chatModel("test");
  const chunks = await collect(model, new AbortController().signal, { ...limits, totalMs: 8_000 });
  assert.equal(calls, 2);
  assert.equal(chunks.filter((chunk) => chunk.type === "text-delta").length, 1);
  assert.equal(chunks.some((chunk) => chunk.type === "error"), false);
});
