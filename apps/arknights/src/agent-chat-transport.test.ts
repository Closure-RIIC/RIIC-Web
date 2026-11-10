import "./i18n/test-setup.ts";
import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";
import { agentRequestMessages, createAgentChatTransport, prepareAgentRequest, agentChatFetch } from "./agent-chat-transport.ts";
import { prepareAgentHistory } from "./server/agent/message-history.ts";
import { AGENT_UNAVAILABLE_ERROR } from "./agent-chat-errors.ts";

const question: UIMessage = { id: "follow-up", role: "user", parts: [{ type: "text", text: "按照我的排班，贸易站出售后还剩多少赤金？" }] };
function history(output: object): UIMessage[] {
  return [
    { id: "u1", role: "user", parts: [{ type: "text", text: "帮我生成排班" }] },
    { id: "a1", role: "assistant", parts: [
      { type: "text", text: "内部工具调用前说明" },
      { type: "tool-solve_schedule", toolCallId: "solve-1", state: "output-available", input: {}, output },
      { type: "text", text: "排班已生成，每日赤金产出 103 枚。" },
    ] }, question,
  ];
}
test("oversized local schedule snapshots are removed before encoding the follow-up", async () => {
  const output = { workbenchSession: { result: "x".repeat(17 * 1024 * 1024) } };
  const messages = history(output);
  assert.ok(new TextEncoder().encode(JSON.stringify(messages)).byteLength > 16 * 1024 * 1024);
  const prepared = await prepareAgentRequest({ id: "chat-1", messages, body: { conversationId: "chat-1", attemptId: "attempt-1", persona: { id: "mountain" }, pageContext: null }, trigger: "submit-message", messageId: undefined, api: "/api/agent/chat", requestMetadata: undefined, headers: undefined, credentials: undefined });
  const wire = JSON.stringify(prepared.body);
  assert.ok(wire.length < 1024);
  assert.match(wire, /每日赤金产出 103 枚/); assert.match(wire, /贸易站出售/);
  assert.doesNotMatch(wire, /workbenchSession|toolCallId|内部工具调用前说明/);
  assert.equal((messages[1]!.parts[1] as { output: unknown }).output, output);
  assert.equal((output.workbenchSession.result).length, 17 * 1024 * 1024);
});
test("outgoing history agrees with the server's existing model context policy", async () => {
  const messages = history({ result: "private schedule card" });
  assert.deepEqual(agentRequestMessages(messages), await prepareAgentHistory(messages, async () => {}));
});
test("current text and image attachments survive projection while local metadata stays local", () => {
  const url = "data:image/png;base64,AQID";
  const messages: UIMessage[] = [{ ...question, metadata: { replyPersona: "local avatar" }, parts: [...question.parts, { type: "file", filename: "base.png", mediaType: "image/png", url }] }];
  const projected = agentRequestMessages(messages);
  assert.deepEqual(projected[0]!.parts, messages[0]!.parts);
  assert.ok(!("metadata" in projected[0]!)); assert.ok("metadata" in messages[0]!);
});
test("SDK retries and normal sends both use projected messages and retain request options", async t => {
  const captured: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
    assert.ok(new TextEncoder().encode(String(init?.body)).byteLength < 1024);
    captured.push(JSON.parse(String(init?.body)));
    return new Response('data: {"type":"start","messageId":"answer"}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
  });
  const transport = createAgentChatTransport();
  for (const trigger of ["submit-message", "regenerate-message"] as const) {
    const stream = await transport.sendMessages({ chatId: "chat-1", trigger, abortSignal: undefined, messageId: question.id, messages: history({ largeResult: "x".repeat(17 * 1024 * 1024) }), body: { conversationId: "chat-1", attemptId: trigger, persona: { id: "mountain" } } });
    const reader = stream.getReader(); while (!(await reader.read()).done) { /* consume mock SSE */ }
  }
  assert.equal(captured.length, 2);
  for (const body of captured) {
    assert.equal(body.conversationId, "chat-1"); assert.equal(body.messageId, question.id);
    assert.deepEqual(body.persona, { id: "mountain" }); assert.doesNotMatch(JSON.stringify(body), /largeResult/);
  }
});
test("413 envelopes display the public message and request reference instead of JSON", async t => {
  const requestId = "b5a78b65-998b-48aa-af11-36588bdee27c";
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: false, error: { code: "AIC-REQ-1002", message: "提交的数据过大，请精简后重试。", requestId, retryable: false } }, { status: 413 }));
  await assert.rejects(agentChatFetch("/api/agent/chat"), error => {
    assert.equal((error as Error).message, `提交的数据过大，请精简后重试。 (${requestId})`);
    assert.doesNotMatch((error as Error).message, /"success"|retryable/); return true;
  });
});
test("unstructured proxy failures do not expose response bodies", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>private backend token</html>", { status: 502 }));
  await assert.rejects(agentChatFetch("/api/agent/chat"), { message: AGENT_UNAVAILABLE_ERROR });
});
