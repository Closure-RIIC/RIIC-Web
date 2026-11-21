import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";
import { prepareAgentHistory } from "./message-history.ts";

test("a follow-up never turns browser tool snapshots into assistant prose", async () => {
  const messages: UIMessage[] = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "查克莱门莎的技能" }] },
    { id: "a1", role: "assistant", parts: [
      { type: "text", text: "I'll look up her skills." },
      { type: "tool-query_skills", toolCallId: "call-1", state: "output-available", input: { query: "克莱门莎" }, output: { skills: [{ description: "生产力+30%" }] } },
      { type: "text", text: "制造站生产力提升30%。" },
    ] },
    { id: "u2", role: "user", parts: [{ type: "text", text: "说明原因" }] },
  ];
  const prepared = await prepareAgentHistory(messages, async () => {});
  const history = JSON.stringify(prepared);
  assert.doesNotMatch(history, /toolCallId|output-available|客户端提供的历史工具结果|I'll look/);
  assert.match(history, /制造站生产力提升30%/);
});

test("a follow-up preserves the final answer after an unclosed thinking tag in an earlier step", async () => {
  const tool: UIMessage["parts"][number] = { type: "tool-kb_read", toolCallId: "read", state: "output-available", input: {}, output: {} };
  const dynamic: UIMessage["parts"][number] = { type: "dynamic-tool", toolName: "kb_read", toolCallId: "read", state: "output-available", input: {}, output: {} };
  for (const boundary of [[{ type: "step-start" }], [tool], [dynamic], [tool, { type: "step-start" }]] satisfies UIMessage["parts"][]) {
    const messages: UIMessage[] = [
      { id: "a1", role: "assistant", parts: [
        { type: "text", text: "<think>先查知识库" }, ...boundary,
        { type: "text", text: "<thi" },
        { type: "text", text: "nk>新一轮思考</think>制造站生产力提升30%。" },
      ] },
      { id: "u2", role: "user", parts: [{ type: "text", text: "说明原因" }] },
    ];
    const checked: string[] = [];
    const prepared = await prepareAgentHistory(messages, async text => { checked.push(text); });
    assert.deepEqual(prepared, [
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "制造站生产力提升30%。" }] },
      messages[1],
    ]);
    assert.deepEqual(checked, ["制造站生产力提升30%。", "说明原因"]);
  }
});
