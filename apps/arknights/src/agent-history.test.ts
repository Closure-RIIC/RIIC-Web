import assert from "node:assert/strict";
import { test } from "node:test";
import type { UIMessage } from "ai";
import { emptyAgentHistory, mergeAgentHistories, parseAgentHistory, restoreAgentMessages, updateAgentConversation, updateAgentConversationPreferences } from "./agent-history.ts";

const question = (text: string): UIMessage[] => [{ id: "user", role: "user", parts: [{ type: "text", text }] }];

test("keeps the latest five nonempty conversations, updating a resumed chat in place", () => {
  let history = emptyAgentHistory();
  assert.equal(updateAgentConversation(history, "empty", []), history);
  for (let i = 1; i <= 6; i++) history = updateAgentConversation(history, `chat-${i}`, question(`问题 ${i}`), i);
  assert.deepEqual(history.conversations.map((entry) => entry.id), [6, 5, 4, 3, 2].map((i) => `chat-${i}`));
  history = updateAgentConversation(history, "chat-2", [...question("问题 2"), { id: "answer", role: "assistant", parts: [{ type: "text", text: "继续回答" }] }], 7);
  assert.equal(history.conversations.length, 5);
  assert.equal(history.conversations[0].id, "chat-2");
  assert.equal(history.conversations[0].title, "问题 2");
  assert.equal(history.conversations[0].messages.length, 2);
});

test("checkpoints own their messages and retain attachment payloads", () => {
  const messages: UIMessage[] = [{ id: "file", role: "user", parts: [{ type: "file", filename: "说明.txt", mediaType: "text/plain", url: "data:text/plain;base64,dGVzdA==" }] }];
  const saved = updateAgentConversation(emptyAgentHistory(), "file-chat", messages);
  messages[0].parts.length = 0;
  assert.equal(saved.conversations[0].title, "说明.txt");
  assert.equal(saved.conversations[0].messages[0].parts.length, 1);
});

test("restoring an interrupted stream resolves incomplete tool calls without changing saved data", () => {
  const messages: UIMessage[] = [{ id: "answer", role: "assistant", parts: [
    { type: "text", text: "已生成内容", state: "streaming" },
    { type: "tool-kb_route", toolCallId: "partial", state: "input-streaming", input: undefined },
    { type: "tool-kb_read", toolCallId: "waiting", state: "input-available", input: { path: "docs/a.md" } },
    { type: "tool-query_skills", toolCallId: "finished", state: "output-available", input: { query: "孑" }, output: { skills: [] } },
  ] }];
  const restored = restoreAgentMessages(messages);
  assert.equal(restored[0].parts.length, 3);
  assert.equal((restored[0].parts[0] as { state: string }).state, "done");
  assert.equal((restored[0].parts[1] as { state: string }).state, "output-error");
  assert.equal((restored[0].parts[2] as { state: string }).state, "output-available");
  assert.equal(messages[0].parts.length, 4);
  assert.equal((messages[0].parts[0] as { state: string }).state, "streaming");
});

test("restoring a saved reply hides thinking split across text parts", () => {
  const prompt = question("<think>这是什么标签？</think>");
  const messages: UIMessage[] = [...prompt, { id: "answer", role: "assistant", parts: [
    { type: "text", text: "<thi" },
    { type: "text", text: "nk>隐藏内容</think>这是回答。" },
  ] }];
  assert.deepEqual(restoreAgentMessages(messages).map(message => message.parts), [
    [{ type: "text", text: "<think>这是什么标签？</think>", state: "done" }],
    [{ type: "text", text: "这是回答。", state: "done" }],
  ]);
});

test("restoring a saved reply confines unclosed thinking to its model step", () => {
  const tool: UIMessage["parts"][number] = { type: "tool-kb_read", toolCallId: "read", state: "output-available", input: {}, output: {} };
  const dynamic: UIMessage["parts"][number] = { type: "dynamic-tool", toolName: "kb_read", toolCallId: "read", state: "output-available", input: {}, output: {} };
  for (const boundary of [[{ type: "step-start" }], [tool], [dynamic], [tool, { type: "step-start" }]] satisfies UIMessage["parts"][]) {
    const messages: UIMessage[] = [{ id: "answer", role: "assistant", parts: [
      { type: "text", text: "<think>先查知识库" }, ...boundary,
      { type: "text", text: "<thi" },
      { type: "text", text: "nk>新一轮思考</think>制造站生产力提升30%。" },
    ] }];
    const saved = structuredClone(messages);
    const restored = restoreAgentMessages(messages);
    assert.deepEqual(restored[0].parts.filter(part => part.type === "text"), [
      { type: "text", text: "制造站生产力提升30%。", state: "done" },
    ]);
    assert.deepEqual(messages, saved);
  }
});

test("parsing rejects unsupported and malformed records and retains collapse preference", () => {
  assert.deepEqual(parseAgentHistory(null), emptyAgentHistory());
  assert.deepEqual(parseAgentHistory({ version: 99, conversations: [] }), emptyAgentHistory());
  const valid = updateAgentConversation(emptyAgentHistory(), "saved", question("保留这条"), 10).conversations[0];
  const parsed = parseAgentHistory({ version: 1, activeId: "saved", expanded: false, conversations: [null, valid, valid, { ...valid, id: "broken", messages: [{ id: "bad", role: "user", parts: [{ type: "text" }] }] }] });
  assert.equal(parsed.conversations.length, 1);
  assert.equal(parsed.activeId, "saved");
  assert.equal(parsed.expanded, false);
});

test("merging concurrent saves preserves other chats and never rolls a newer answer back", () => {
  const stored = updateAgentConversation(updateAgentConversation(emptyAgentHistory(), "other-tab", question("另一个标签页"), 1), "shared", question("新回复"), 3);
  const incoming = updateAgentConversation(updateAgentConversation(emptyAgentHistory(), "shared", question("旧回复"), 2), "unsaved", question("上次存储失败的对话"), 4);
  const merged = mergeAgentHistories(stored, incoming);
  assert.deepEqual(merged.conversations.map((entry) => entry.id), ["unsaved", "shared", "other-tab"]);
  assert.equal(merged.conversations[1].title, "新回复");
});

test("model and image preferences survive checkpoints and history restoration", () => {
  let history = updateAgentConversation(emptyAgentHistory(), "vision", question("看图"), 1, { selectedModel: "gpt", imageMode: "include" });
  history = updateAgentConversationPreferences(history, "vision", { selectedModel: "glm", imageMode: "exclude" }, 2);
  history = updateAgentConversation(history, "vision", [...question("看图"), { id: "reply", role: "assistant", parts: [{ type: "text", text: "已经识别" }], metadata: { replyModel: { id: "gpt", label: "GPT-6.1 Sol" } } }], 3);
  const restored = parseAgentHistory(JSON.parse(JSON.stringify(history))).conversations[0];
  assert.equal(restored.selectedModel, "glm");
  assert.equal(restored.imageMode, "exclude");
  assert.equal(restored.messages.length, 2);
  assert.deepEqual(restored.messages[1].metadata, { replyModel: { id: "gpt", label: "GPT-6.1 Sol" } });
  assert.equal(updateAgentConversationPreferences(history, "missing", { selectedModel: "gpt" }), history);
});

test("malformed stored model preferences cannot replace valid conversation messages", () => {
  const history = updateAgentConversation(emptyAgentHistory(), "saved", question("保留内容"));
  const raw = { ...history, conversations: [{ ...history.conversations[0], selectedModel: "arbitrary-upstream", imageMode: "invalid" }] };
  const restored = parseAgentHistory(raw).conversations[0];
  assert.equal(restored.selectedModel, undefined);
  assert.equal(restored.imageMode, "include");
  assert.equal(restored.messages[0].parts[0].type, "text");
});

test("a preference change from another tab does not overwrite newer messages", () => {
  const original = updateAgentConversation(emptyAgentHistory(), "shared", question("原问题"), 1, { selectedModel: "gpt", imageMode: "include" });
  const newAnswer = updateAgentConversation(original, "shared", [...question("原问题"), { id: "answer", role: "assistant", parts: [{ type: "text", text: "新回答" }] }], 3);
  const changedModel = updateAgentConversationPreferences(original, "shared", { selectedModel: "glm", imageMode: "exclude" }, 4);
  for (const merged of [mergeAgentHistories(newAnswer, changedModel), mergeAgentHistories(changedModel, newAnswer)]) {
    assert.equal(merged.conversations[0].messages.length, 2);
    assert.equal(merged.conversations[0].selectedModel, "glm");
    assert.equal(merged.conversations[0].imageMode, "exclude");
    assert.equal(merged.conversations[0].updatedAt, 3);
    const checkpoint = updateAgentConversation(merged, "shared", newAnswer.conversations[0].messages, 5, { selectedModel: "gpt", imageMode: "include" }, 1);
    assert.equal(checkpoint.conversations[0].selectedModel, "glm");
    assert.equal(checkpoint.conversations[0].preferencesUpdatedAt, 4);
  }
});
