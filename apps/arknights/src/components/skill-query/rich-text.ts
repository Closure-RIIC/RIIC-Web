export type RichTextNode =
  | { type: "text"; text: string }
  | { type: "style"; className: string; children: RichTextNode[] }
  | { type: "term"; id: string; children: RichTextNode[] };

/** 与工具箱 richText2HTML 相同：`@cc.vup` → `cc-vup`。 */
export function richTextClassName(tag: string): string {
  return tag.replace(/^[^0-9a-zA-Z]/, "").replace(/[^0-9a-zA-Z]/g, "-");
}

/** 与工具箱 richText2HTML 相同：`$cc.bd_A_1` → `cc_bd_A_1`。 */
export function richTextTermId(tag: string): string {
  return tag.replace(/^\W/, "").replace(/\W/g, "_");
}

/** 从上游富文本生成稳定的搜索和纯文本展示内容。 */
export function richTextPlainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 复刻工具箱 richText2HTML 的语义：样式标签紧跟词条标签时先交换为词条在前，
 * 使 `<$cc.x>` 与其后的 `</>` 配对成词条节点并包裹内部样式内容。
 * 返回节点树；未知/脏标签按原文保留为文本。
 */
export function parseRichText(text: string): RichTextNode[] {
  const normalized = text
    .replace(/<<\$/g, "<$")
    .replace(/(<@[^<>]+>)(<\$[^<>]+>)/g, "$2$1");
  const root: RichTextNode[] = [];
  const stack: RichTextNode[] = [];
  let buffer = "";
  let index = 0;

  const flush = () => {
    if (!buffer) return;
    const parent = stack[stack.length - 1];
    (parent && "children" in parent ? parent.children : root).push({ type: "text", text: buffer });
    buffer = "";
  };

  while (index < normalized.length) {
    if (normalized[index] !== "<") {
      buffer += normalized[index];
      index += 1;
      continue;
    }
    const close = normalized.indexOf(">", index);
    if (close < 0) {
      buffer += normalized.slice(index);
      break;
    }
    const tag = normalized.slice(index + 1, close);
    flush();
    if (tag === "/") {
      stack.pop();
    } else if (tag.startsWith("@cc.")) {
      const node: RichTextNode = { type: "style", className: richTextClassName(tag), children: [] };
      const parent = stack[stack.length - 1];
      (parent && "children" in parent ? parent.children : root).push(node);
      stack.push(node);
    } else if (tag.startsWith("$cc.")) {
      const node: RichTextNode = { type: "term", id: richTextTermId(tag), children: [] };
      const parent = stack[stack.length - 1];
      (parent && "children" in parent ? parent.children : root).push(node);
      stack.push(node);
    } else {
      // 兜底保留：把未知/异常标签当原文，避免桑葚等技能页露出脏文本。
      buffer += normalized.slice(index, close + 1);
    }
    index = close + 1;
  }
  flush();
  return root;
}
