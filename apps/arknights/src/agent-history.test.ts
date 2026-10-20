import assert from "node:assert/strict";
import { test } from "node:test";
import type { UIMessage } from "ai";
import { emptyAgentHistory, mergeAgentHistories, parseAgentHistory, restoreAgentMessages, updateAgentConversation } from "./agent-history.ts";

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
