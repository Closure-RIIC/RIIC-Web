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

test("configured image count includes history, excludes dropped images, and is separate from text attachments", async () => {
  const { default: sharp } = await import("sharp");
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: "red" } }).png().toBuffer();
  const images = Array.from({ length: 8 }, (_, i) => ({ ...fileMessage("image/png", png)[0], id: `u${i}` }));
  const messages = [...images, ...fileMessage("text/markdown", Buffer.from("notes"))];
  const prepared = await prepareAgentHistory(messages, async () => {}, { selection: { ...selection, maxImages: 8 } });
  assert.equal(prepared.flatMap(message => message.parts).filter(part => part.type === "file").length, 8);
  // Count admission happens before filter callbacks or decoding any input.
  let checked = false;
  await assert.rejects(prepareAgentHistory(messages, async () => { checked = true; }, { selection: { ...selection, maxImages: 7 } }), /超过模型限制/);
  assert.equal(checked, false);
  const excluded = await prepareAgentHistory(messages, async () => {}, { images: "exclude" });
  assert.equal(excluded.flatMap(message => message.parts).filter(part => part.type === "file").length, 0);
  await assert.rejects(prepareAgentHistory(images, async () => {}, { selection: { ...selection, imageTokensPerImage: 0 } }), /不支持图片/);
  await assert.rejects(prepareAgentHistory(Array.from({ length: 5 }, () => fileMessage("text/plain", Buffer.from("notes"))[0]), async () => {}, { selection: { ...selection, maxImages: 8 } }), /文本附件过多/);
});

test("configured pixels can exceed sixteen million while normalization still limits the longest edge", async () => {
  const { default: sharp } = await import("sharp");
  const png = await sharp({ create: { width: 4100, height: 4000, channels: 3, background: "red" } }).png().toBuffer();
  await assert.rejects(prepareAgentHistory(fileMessage("image/png", png), async () => {}, { selection }), /无法读取/);
  const prepared = await prepareAgentHistory(fileMessage("image/png", png), async () => {}, { selection: { ...selection, maxImagePixels: 32_000_000 } });
  const file = prepared[0].parts.find(part => part.type === "file")!;
  assert.equal(file.type, "file");
  const metadata = await sharp(Buffer.from(file.url.split(",")[1], "base64")).metadata();
  assert.equal(metadata.width, 2048);
  assert.ok(metadata.height! <= 2048);
});

test("configured image bytes and aggregate transport exceed the old eight and sixteen MiB limits", async () => {
  const { randomBytes } = await import("node:crypto");
  const { default: sharp } = await import("sharp");
  const png = await sharp(randomBytes(1800 * 1800 * 3), { raw: { width: 1800, height: 1800, channels: 3 } }).png().toBuffer();
  assert.ok(png.length > 8 * 1024 * 1024 && png.length < 10 * 1024 * 1024);
  const messages = fileMessage("image/png", png);
  await assert.rejects(prepareAgentHistory(messages, async () => {}, { selection }), /过大|超过大小/);
  messages[0].parts.push(messages[0].parts[1]);
  assert.ok(Buffer.byteLength(JSON.stringify(messages)) > 16 * 1024 * 1024);
  const prepared = await prepareAgentHistory(messages, async () => {}, { selection: { ...selection, maxImageBytes: 10 * 1024 * 1024 } });
  assert.equal(prepared[0].parts.filter(part => part.type === "file").length, 2);
  await assert.rejects(prepareAgentHistory(fileMessage("image/png", png), async () => {}, { selection: { ...selection, maxImageBytes: png.length - 1 } }), /过大|超过大小/);
  await assert.rejects(prepareAgentHistory(fileMessage("text/plain", Buffer.alloc(8 * 1024 * 1024 + 1, 97)), async () => {}, { selection: { ...selection, maxImageBytes: 10 * 1024 * 1024 } }), /过大/);
  await assert.rejects(prepareAgentHistory([{ id: "u", role: "user", parts: [{ type: "text", text: "x".repeat(16 * 1024 * 1024) }] }], async () => {}, { selection }), /对话过长/);
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
