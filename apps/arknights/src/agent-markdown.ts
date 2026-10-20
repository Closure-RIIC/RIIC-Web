import { prepareOperatorText, MAX_OPERATOR_PORTRAITS, type OperatorMention } from "./agent-operator-mentions.ts";

export type MarkdownNode<T = string> = (
  | { kind: "paragraph"; text: T }
  | { kind: "heading"; level: number; text: T }
  | { kind: "quote"; text: T }
  | { kind: "ul"; items: T[] }
  | { kind: "ol"; items: T[] }
  | { kind: "code"; language: string; text: string }
  | { kind: "rule" }
  | { kind: "table"; headers: T[]; rows: T[][] }
) & { complete: boolean };

function splitTableRow(line: string) { return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim()); }
function isTableDivider(line: string) { return splitTableRow(line).every((cell) => /^:?-{3,}:?$/.test(cell)); }

/** Preserve the existing Markdown grammar and identify blocks closed by the incoming stream. */
export function parseMarkdown(source: string): MarkdownNode[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const nodes: MarkdownNode[] = [];
  let paragraph: string[] = [];
  let list: { kind: "ul" | "ol"; items: string[] } | null = null;
  let code: string[] | null = null;
  let codeLanguage = "";
  const flushParagraph = (complete = true) => {
    if (paragraph.length) { nodes.push({ kind: "paragraph", text: paragraph.join(" ").trim(), complete }); paragraph = []; }
  };
  const flushList = (complete = true) => { if (list) nodes.push({ ...list, complete }); list = null; };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (code) {
      if (/^\s*```/.test(line)) { nodes.push({ kind: "code", language: codeLanguage, text: code.join("\n"), complete: true }); code = null; codeLanguage = ""; }
      else code.push(line);
      continue;
    }
    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence) { flushParagraph(); flushList(); code = []; codeLanguage = fence[1] ?? ""; continue; }
    if (!line.trim()) { if (index < lines.length - 1) { flushParagraph(); flushList(); } continue; }
    if (line.includes("|") && isTableDivider(lines[index + 1] ?? "")) {
      flushParagraph(); flushList();
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? "").includes("|") && (lines[index] ?? "").trim()) { rows.push(splitTableRow(lines[index])); index++; }
      nodes.push({ kind: "table", headers, rows, complete: index < lines.length - 1 || Boolean(lines[index]?.trim()) });
      index--;
      continue;
    }
    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) { flushParagraph(); flushList(); nodes.push({ kind: "heading", level: heading[1].length, text: heading[2], complete: index < lines.length - 1 }); continue; }
    if (/^\s*(?:---+|\*\s*\*\s*\*|___+)\s*$/.test(line)) { flushParagraph(); flushList(); nodes.push({ kind: "rule", complete: true }); continue; }
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const kind = unordered ? "ul" : "ol";
      flushParagraph();
      if (!list || list.kind !== kind) { flushList(); list = { kind, items: [] }; }
      list.items.push((unordered ?? ordered)?.[1] ?? "");
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) { flushParagraph(); flushList(); nodes.push({ kind: "quote", text: quote[1], complete: index < lines.length - 1 }); continue; }
    flushList(); paragraph.push(line.trim());
  }
  flushParagraph(false); flushList(false);
  if (code) nodes.push({ kind: "code", language: codeLanguage, text: code.join("\n"), complete: false });
  return nodes;
}

function safeHref(href: string) {
  if (!/^(?:https?:|mailto:)/i.test(href.trim())) return null;
  try { const url = new URL(href); return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null; } catch { return null; }
}
export interface InlineToken { kind: "text" | "strong" | "em" | "code" | "link"; text: string; href?: string; mentions: readonly OperatorMention[] }
function tokenizeInline(text: string, eligible: boolean): InlineToken[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\)|\[干员[:：][^\]\r\n]{1,64}\]|https?:\/\/[^\s<]+)/g).filter(Boolean).map((part) => {
    if (/^`[^`]+`$/.test(part)) return { kind: "code", text: part.slice(1, -1), mentions: [] };
    if (/^\*\*[^*]+\*\*$/.test(part) || /^__[^_]+__$/.test(part)) return { kind: "strong", ...prepareOperatorText(part.slice(2, -2), eligible, true) };
    if (/^\*[^*]+\*$/.test(part) || /^_[^_]+_$/.test(part)) return { kind: "em", ...prepareOperatorText(part.slice(1, -1), eligible, true) };
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    const href = safeHref(link?.[2] ?? part);
    if (href) return { kind: "link", text: link?.[1] ?? part, href, mentions: [] };
    return link ? { kind: "text", text: part, mentions: [] } : { kind: "text", ...prepareOperatorText(part, eligible) };
  });
}

function mapInline(nodes: readonly MarkdownNode[], streaming: boolean): MarkdownNode<InlineToken[]>[] {
  return nodes.map((node) => {
    const inline = (text: string) => tokenizeInline(text, !streaming || node.complete);
    if (node.kind === "code" || node.kind === "rule") return node;
    if (node.kind === "table") return { ...node, headers: node.headers.map(inline), rows: node.rows.map((row) => row.map(inline)) };
    if (node.kind === "ul" || node.kind === "ol") return { ...node, items: node.items.map(inline) };
    return { ...node, text: inline(node.text) };
  });
}

// Cache completed parts only, not every growing stream snapshot. Bound retained source text.
const completedCache = new Map<string, MarkdownNode<InlineToken[]>[]>();
let cachedCharacters = 0;
function tokenizeDocument(content: string, streaming: boolean) {
  if (!streaming && completedCache.has(content)) return completedCache.get(content)!;
  const nodes = mapInline(parseMarkdown(content), streaming);
  if (!streaming && content.length <= 256_000) {
    while (completedCache.size >= 32 || cachedCharacters + content.length > 256_000) {
      const oldest = completedCache.keys().next().value!;
      cachedCharacters -= oldest.length; completedCache.delete(oldest);
    }
    completedCache.set(content, nodes); cachedCharacters += content.length;
  }
  return nodes;
}

function visitInline(nodes: readonly MarkdownNode<InlineToken[]>[], visit: (tokens: InlineToken[]) => InlineToken[]): MarkdownNode<InlineToken[]>[] {
  return nodes.map((node) => {
    if (node.kind === "code" || node.kind === "rule") return node;
    if (node.kind === "table") return { ...node, headers: node.headers.map(visit), rows: node.rows.map((row) => row.map(visit)) };
    if (node.kind === "ul" || node.kind === "ol") return { ...node, items: node.items.map(visit) };
    return { ...node, text: visit(node.text) };
  });
}

export function prepareAgentMarkdown(content: string, streaming = false, previousParts: readonly string[] = []): MarkdownNode<InlineToken[]>[] {
  let count = 0;
  const limitPortraits = (tokens: InlineToken[]) => tokens.map((token) => {
    const mentions = token.mentions.slice(0, Math.max(0, MAX_OPERATOR_PORTRAITS - count));
    count += mentions.length;
    return { ...token, mentions };
  });
  for (const previous of previousParts) {
    visitInline(tokenizeDocument(previous, false), limitPortraits);
    if (count >= MAX_OPERATOR_PORTRAITS) break;
  }
  return visitInline(tokenizeDocument(content, streaming), limitPortraits);
}
