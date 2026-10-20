import assert from "node:assert/strict";
import test from "node:test";

import { parseRichText, richTextClassName, richTextPlainText, richTextTermId } from "./rich-text.ts";

test("maps toolbox tag names and term ids", () => {
  assert.equal(richTextClassName("@cc.vup"), "cc-vup");
  assert.equal(richTextClassName("@cc.miu"), "cc-miu");
  assert.equal(richTextTermId("$cc.bd_A_1"), "cc_bd_A_1");
  assert.equal(richTextTermId("$cc.g.abyssal"), "cc_g_abyssal");
});

test("derives plain searchable text without duplicating it in the generated catalog", () => {
  assert.equal(
    richTextPlainText("进驻时，生产力<@cc.vup>+10%</>。\n&amp; 协同"),
    "进驻时，生产力+10%。 & 协同",
  );
});

test("parses style pairs into styled spans", () => {
  const nodes = parseRichText("进驻时，生产力<@cc.vup>+10%</>。");
  assert.equal(nodes.length, 3);
  assert.equal(nodes[0].type, "text");
  assert.equal(nodes[1].type, "style");
  assert.equal(nodes[1].type === "style" && nodes[1].className, "cc-vup");
  assert.equal(nodes[1].type === "style" && nodes[1].children[0].type, "text");
  assert.equal(nodes[2].type, "text");
});

test("wraps term refs around their styled content like the toolbox", () => {
  // 工具箱会把 `<@cc.kw><$cc.angel>能天使</></>` 解析成词条包住样式。
  const nodes = parseRichText("当与<@cc.kw><$cc.angel>能天使</></>在同一个贸易站时");
  const term = nodes.find((node) => node.type === "term");
  assert.equal(term?.type === "term" && term.id, "cc_angel");
  const kw = term?.type === "term" ? term.children.find((node) => node.type === "style") : undefined;
  assert.equal(kw?.type === "style" && kw.className, "cc-kw");
});

test("parses standalone term ref with following styled text", () => {
  const nodes = parseRichText("控制中枢内<$cc.bd_mujica><@cc.rem>热情值</></>+1");
  const term = nodes.find((node) => node.type === "term");
  assert.equal(term?.type === "term" && term.id, "cc_bd_mujica");
  assert.equal(term?.type === "term" && term.children[0].type, "style");
});

test("修复桑葚基建技能异常：兼容并清理脏标签", () => {
  const malformed = parseRichText("值<<$cc.bd_b1>内容</>");
  assert.equal(malformed[0].type, "text");
  assert.equal(malformed[1].type === "term" && malformed[1].id, "cc_bd_b1");
  const nodes = parseRichText("未知<@cc.unknown>x</>标签");
  assert.equal(nodes[1].type === "style" && nodes[1].className, "cc-unknown");
});

test("preserves newlines as text", () => {
  const nodes = parseRichText("第一行\n第二行");
  assert.equal(nodes[0].type === "text" && nodes[0].text, "第一行\n第二行");
});
