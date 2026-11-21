import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";
import { prepareAgentHistory } from "./message-history.ts";
import { defaultModelPolicy, type AgentModelSelection } from "./model-policy.ts";

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

const selection: AgentModelSelection = { ...defaultModelPolicy().models[2], enabled: true, imageTokensPerImage: 5000,
  provider: "riic-gpt", model: "gpt-6.1-sol", vision: true, protocol: "responses", policyVersion: "models:2" };
const fileMessage = (mediaType: string, bytes: Buffer): UIMessage[] => [{ id: "u1", role: "user", parts: [
  { type: "text", text: "read this" }, { type: "file", mediaType, url: `data:${mediaType};base64,${bytes.toString("base64")}` },
] }];
test("image history validates real encoding, dimensions and model capability before upstream", async () => {
  const { default: sharp } = await import("sharp");
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: "red" } }).png().toBuffer();
  await assert.rejects(prepareAgentHistory(fileMessage("image/png", png), async () => {}), /不支持图片/);
  const prepared = await prepareAgentHistory(fileMessage("image/png", png), async () => {}, { selection });
  assert.equal(prepared[0].parts[1].type, "file");
  await assert.rejects(prepareAgentHistory(fileMessage("image/jpeg", png), async () => {}, { selection }), /无法读取/);
  await assert.rejects(prepareAgentHistory(fileMessage("image/png", Buffer.from("not an image")), async () => {}, { selection }), /无法读取/);
  await assert.rejects(prepareAgentHistory(fileMessage("image/png", png), async () => {}, { selection: { ...selection, maxImagePixels: 1000 } }), /无法读取/);
  const excluded = await prepareAgentHistory(fileMessage("image/png", png), async () => {}, { images: "exclude" });
  assert.equal(excluded[0].parts.length, 1);
  await assert.rejects(prepareAgentHistory(fileMessage("image/png", png), async () => {}, { images: "forged" }));
});

test("Markdown is decoded and filtered as text; Word and PDF are rejected", async () => {
  const checked: string[] = [];
  const prepared = await prepareAgentHistory(fileMessage("text/markdown", Buffer.from("# 技能\n生产力 +30%")), async text => { checked.push(text); });
  assert.ok(checked.includes("# 技能\n生产力 +30%"));
  assert.equal(prepared[0].parts[1].type, "text");
  for (const mediaType of ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]) {
    await assert.rejects(prepareAgentHistory(fileMessage(mediaType, Buffer.from("document")), async () => {}), /仅支持/);
  }
});

test("shared input mode admits validated images without inventing a per-image token bound", async () => {
  const { default: sharp } = await import("sharp");
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: "red" } }).png().toBuffer();
  const shared: AgentModelSelection = { ...selection, imageBudgetMode: "shared-input-limit", imageTokensPerImage: 0 };
  const messages = fileMessage("image/png", png);
  const prepared = await prepareAgentHistory(messages, async () => {}, { selection: shared });
  assert.equal(prepared[0].parts[1].type, "file");
  await assert.rejects(prepareAgentHistory(messages, async () => {}, { selection: { ...shared, imageBudgetMode: "per-image" } }), /不支持图片/);
  await assert.rejects(prepareAgentHistory(messages, async () => {}, { selection: { ...shared, vision: false } }), /不支持图片/);
  await assert.rejects(prepareAgentHistory(messages, async () => {}, { selection: { ...shared, maxImages: 0 } }), /不支持图片/);
  messages[0].parts.push(messages[0].parts[1]);
  await assert.rejects(prepareAgentHistory(messages, async () => {}, { selection: { ...shared, maxImages: 1 } }), /超过模型限制/);
  await assert.rejects(prepareAgentHistory(fileMessage("image/png", Buffer.from("invalid")), async () => {}, { selection: shared }), /无法读取/);
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
