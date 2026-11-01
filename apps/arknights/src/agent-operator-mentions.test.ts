import assert from "node:assert/strict";
import test from "node:test";
import catalogue from "@riic/arknights-domain/generated/arkntools/operator-catalog.json" with { type: "json" };
import { findOperatorMentions, MAX_OPERATOR_PORTRAITS } from "./agent-operator-mentions.ts";
import { prepareAgentMarkdown, type InlineToken, type MarkdownNode } from "./agent-markdown.ts";

function tokens(nodes: MarkdownNode<InlineToken[]>[]): InlineToken[] {
  return nodes.flatMap((node) => {
    if (node.kind === "code" || node.kind === "rule") return [];
    if (node.kind === "table") return [...node.headers.flat(), ...node.rows.flat(2)];
    if (node.kind === "ol" || node.kind === "ul") return node.items.flat();
    return node.text;
  });
}
const mentions = (content: string, streaming = false, previousParts: string[] = []) => tokens(prepareAgentMarkdown(content, streaming, previousParts)).flatMap((token) => token.mentions);

test("new operators resolve with content-hashed catalogue portraits", () => {
  const names = ["塔露拉", "国度", "冻河", "奥尔佳", "镜匠", "行铃"];
  const matched = mentions(names.join("、"));
  assert.deepEqual(matched.map(item => item.name), names);
  for (const mention of matched) {
    const operator = catalogue.find(item => item.name === mention.name);
    assert.ok(operator);
    assert.equal(mention.id, operator.id);
    assert.equal(mention.portrait, operator.portrait);
    assert.match(mention.portrait, /\?v=sha256-[a-f0-9]{64}$/);
  }
});

test("full names win over prefixes and aliases share an operator identity", () => {
  assert.deepEqual(findOperatorMentions("红云、红、阿米娅（近卫）、阿米娅、假干员").map((item) => item.name), ["红云", "红", "阿米娅", "阿米娅"]);
  const matched = findOperatorMentions("建议优先培养能天使，再部署银灰。");
  assert.deepEqual(matched.map((item) => item.name), ["能天使", "银灰"]);
  assert.equal(matched[0].start, 6);
  assert.equal(matched[0].end, 9);
  assert.ok(matched.every((item) => item.portrait.startsWith("/images/operator-portraits/") && item.portrait.includes("?v=")));
});

test("short names and Latin boundaries avoid ordinary words", () => {
  assert.deepEqual(findOperatorMentions("今年有空闲，红色和夕阳，爬山时看白雪，给医生留言，四月份。Windows HTTP THRM-EXTRA").map((item) => item.name), []);
  assert.deepEqual(findOperatorMentions("红、年、令、山、W、12F、THRM-EX").map((item) => item.name), ["红", "年", "令", "山", "W", "12F", "THRM-EX"]);
  assert.deepEqual(mentions("**红**的作用；培养银灰到精二；推荐红云，阿米娅。").map((item) => item.name), ["红", "银灰", "红云", "阿米娅"]);
  assert.equal(mentions("**红色**很漂亮；**今年**有空闲。").length, 0);
});

test("empty training slots never become Sora portraits, while explicit Sora mentions still do", () => {
  for (const content of ["训练室：空。学员：空；协助：空。", "训练室：**空**", "| 设施 | 干员 |\n| --- | --- |\n| 训练室 | 空 |", "未安排干员，暂无学员和教官。"]) {
    assert.equal(mentions(content).length, 0, content);
  }
  assert.deepEqual(mentions("干员空的技能；[干员:空]；**[干员:空]**。").map(item => item.name), ["空", "空", "空"]);
  assert.deepEqual(mentions("| 干员 |\n| --- |\n| [干员:空] |").map(item => item.name), ["空"]);
});

test("Markdown excludes code and links without consuming their first occurrence", () => {
  const content = "`能天使` [银灰](https://example.test/阿米娅) https://example.test/红云\n\n```text\n可露希尔\n```\n\n能天使、银灰、阿米娅、红云、可露希尔。";
  assert.deepEqual(mentions(content).map((item) => item.name), ["能天使", "银灰", "阿米娅", "红云", "可露希尔"]);
  const nodes = prepareAgentMarkdown(content);
  assert.equal(nodes.find((node) => node.kind === "code")?.text, "可露希尔");
  assert.equal(tokens(nodes).find((token) => token.kind === "link")?.href, "https://example.test/%E9%98%BF%E7%B1%B3%E5%A8%85");
  assert.equal(mentions("[能天使](javascript:alert) [银灰](/images/x)").length, 0);
});

test("every occurrence across blocks, formats and tool parts gets a portrait within the message cap", () => {
  const content = "# 能天使\n\n> 银灰\n\n- 阿米娅\n- 红云\n\n| 干员 | 备注 |\n| --- | --- |\n| 可露希尔 | 能天使 |\n\n**红**，阿米娅。";
  const expected = ["能天使", "银灰", "阿米娅", "红云", "可露希尔", "能天使", "红", "阿米娅"];
  assert.deepEqual(mentions(content).map((item) => item.name), expected);
  assert.deepEqual(mentions(content, false, ["能天使。", "银灰，阿米娅（医疗）。"]).map((item) => item.name), expected);
  const allNames = catalogue.map((operator) => operator.name).join("、");
  assert.equal(mentions(allNames).length, MAX_OPERATOR_PORTRAITS);
  assert.equal(mentions(allNames, false, [allNames]).length, 0);
});

test("streaming waits for a closed block and never treats a trailing newline as a blank line", () => {
  for (const content of ["能天", "能天使", "能天使\n", "能天使\n继续说明"]) assert.equal(mentions(content, true).length, 0);
  assert.deepEqual(mentions("能天使\n\n银灰", true).map((item) => item.name), ["能天使"]);
  assert.deepEqual(mentions("能天使\n\n银灰", false).map((item) => item.name), ["能天使", "银灰"]);
  assert.equal(mentions("- 能天使\n", true).length, 0);
  assert.equal(mentions("- 能天使\n\n", true).length, 1);
});

test("source text and cached results are unaffected by the per-message portrait limit", () => {
  const content = "能天使，能天使；阿米娅（近卫）。";
  const first = prepareAgentMarkdown(content);
  assert.equal(tokens(first).map((token) => token.text).join(""), content);
  assert.equal(mentions(content, false, [content]).length, 3);
  assert.equal(mentions(content).length, 3);
  assert.deepEqual(prepareAgentMarkdown(content), first);
  assert.equal(findOperatorMentions("能天使，".repeat(10_000)).length, MAX_OPERATOR_PORTRAITS);
});

test("explicit tags resolve short names, repeated mentions and aliases without changing offsets", () => {
  const source = "让[干员:山]先守住，再由**[干员:红]**支援。[干员:山]的配置和[干员:阿米娅（医疗）]不同。";
  const inline = tokens(prepareAgentMarkdown(source));
  assert.equal(inline.map(token => token.text).join(""), "让山先守住，再由红支援。山的配置和阿米娅（医疗）不同。");
  assert.deepEqual(inline.flatMap(token => token.mentions.map(mention => token.text.slice(mention.start, mention.end))), ["山", "红", "山", "阿米娅（医疗）"]);
  assert.deepEqual(mentions("| 干员 | 对照 |\n| --- | --- |\n| [干员:山] | [干员:山] |").map(item => item.name), ["山", "山"]);
});

test("tags use only catalogue portraits and never transform code, URLs or unknown names", () => {
  const source = "[干员:不存在的银灰]、[干员:https://example.test/avatar.png]、[干员:<img src=x>]、[干员:红色]";
  assert.equal(mentions(source).length, 0);
  const unknown = tokens(prepareAgentMarkdown(source));
  assert.equal(unknown.map(token => token.text).join(""), "不存在的银灰、https://example.test/avatar.png、<img src=x>、红色");
  assert.equal(unknown.some(token => token.kind === "link"), false);
  assert.equal(mentions("[干员:银灰](https://example.test)").length, 0);
  assert.equal(mentions("`[干员:山]`\n\n```text\n[干员:红]\n```\n\n[山](https://example.test/干员) https://example.test/山").length, 0);
  assert.equal(mentions("[干员:山", true).length, 0);
  assert.equal(mentions("[干员:山]", true).length, 0);
  assert.deepEqual(mentions("[干员:山]\n\n[干员:红]", true).map(item => item.name), ["山"]);
  assert.deepEqual(mentions("[干员:山]\n\n[干员:红]").map(item => item.name), ["山", "红"]);
});
