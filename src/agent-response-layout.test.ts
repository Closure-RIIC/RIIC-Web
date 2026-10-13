import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";
import { buildAgentDisplayTurns, hasActiveAgentContent, snapshotAgentReplyPersona } from "./agent-response-layout.ts";
import { BUILTIN_AGENT_PERSONAS } from "./agent-personas.ts";
import { emptyAgentHistory, parseAgentHistory, restoreAgentMessages, updateAgentConversation } from "./agent-history.ts";

test("persona switches preserve old replies through history restoration and retries", () => {
  const original = { ...user, metadata: { replyPersona: snapshotAgentReplyPersona(null) } };
  const next = { ...user, id: "new-question", metadata: { replyPersona: snapshotAgentReplyPersona(BUILTIN_AGENT_PERSONAS[0]) } };
  const messages = [original, assistant([{ type: "text", text: "旧回答" }]), next, { ...assistant([{ type: "text", text: "新回答" }]), id: "new-answer" }];
  const saved = parseAgentHistory(updateAgentConversation(emptyAgentHistory(), "chat", messages));
  const replies = buildAgentDisplayTurns(restoreAgentMessages(saved.conversations[0].messages), false).filter(turn => turn.kind === "response");
  assert.deepEqual(replies.map(turn => turn.persona), [{ name: undefined, avatarUrl: undefined, mascot: undefined }, { name: "银灰", avatarUrl: undefined, mascot: "silverash" }]);
  const retry = buildAgentDisplayTurns([next], true).find(turn => turn.kind === "response");
  assert.equal(retry?.persona.mascot, "silverash");
  const legacy = buildAgentDisplayTurns([user, assistant([{ type: "text", text: "旧版回答" }])], false).find(turn => turn.kind === "response");
  assert.deepEqual(legacy?.persona, {});
});

test("uploaded avatar snapshots survive replacing or clearing the local card", () => {
  const card = { id: "upload", kind: "upload" as const, name: "自定义", description: "", content: "prompt", avatarUrl: "/images/old.png" };
  const snapshot = snapshotAgentReplyPersona(card);
  card.avatarUrl = "/images/new.png";
  assert.deepEqual(snapshot, { name: "自定义", avatarUrl: "/images/old.png" });
  const question = { ...user, metadata: { replyPersona: snapshot } };
  const reply = buildAgentDisplayTurns([question], true).find(turn => turn.kind === "response");
  assert.equal(reply?.persona.avatarUrl, "/images/old.png");
});

const user: UIMessage = { id: "question", role: "user", parts: [{ type: "text", text: "你好" }] };
const assistant = (parts: UIMessage["parts"] = []): UIMessage => ({ id: "answer", role: "assistant", parts });

test("waiting, empty stream and populated response keep the same response key", () => {
  for (const messages of [[user], [user, assistant()], [user, assistant([{ type: "text", text: "你好", state: "streaming" }])]]) {
    const turns = buildAgentDisplayTurns(messages, true);
    assert.equal(turns.length, 2);
    assert.equal(turns[1].key, "response:question");
    assert.equal(turns[1].kind === "response" && turns[1].pending, true);
  }
  assert.equal(buildAgentDisplayTurns([user, assistant()], false).length, 1);
  assert.equal(buildAgentDisplayTurns([user, assistant([{ type: "reasoning", text: "", state: "done" }])], false).length, 1);
});

test("empty text keeps the loader; thinking, visible text and active tools replace it", () => {
  assert.equal(hasActiveAgentContent(assistant([{ type: "text", text: " \n", state: "streaming" }])), false);
  assert.equal(hasActiveAgentContent(assistant([{ type: "reasoning", text: "", state: "streaming" }])), true);
  assert.equal(hasActiveAgentContent(assistant([{ type: "text", text: "答复", state: "streaming" }])), true);
  assert.equal(hasActiveAgentContent(assistant([{ type: "text", text: "答复", state: "done" }])), false);
  assert.equal(hasActiveAgentContent(assistant([{ type: "tool-diagnose_account", toolCallId: "tool", state: "input-available", input: {} }])), true);
  assert.equal(hasActiveAgentContent(assistant([{ type: "tool-diagnose_account", toolCallId: "tool", state: "output-available", input: {}, output: {} }])), false);
});

test("consecutive assistant messages share a turn; later questions have separate stable turns", () => {
  const first = assistant([{ type: "text", text: "已查询", state: "done" }]);
  const second = { ...assistant([{ type: "text", text: "结论", state: "done" }]), id: "answer-2" };
  const turns = buildAgentDisplayTurns([user, first, second, { ...user, id: "question-2" }], true);
  assert.deepEqual(turns.map((turn) => turn.key), ["question", "response:question", "question-2", "response:question-2"]);
  assert.equal(turns[1].kind === "response" && turns[1].messages.length, 2);
  assert.equal(turns[1].kind === "response" && turns[1].pending, false);
  assert.equal(turns[3].kind === "response" && turns[3].pending, true);
});
