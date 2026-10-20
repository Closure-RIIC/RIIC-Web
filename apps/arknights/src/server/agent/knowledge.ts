import "@tanstack/react-start/server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { agentKnowledgeDir } from "./config.ts";
import { resourceKnowledgeFile, type AgentResourcePolicy } from "./resource-policy.ts";

export interface KbCatalogEntry {
  path: string;
  label: string;
}

export interface KbRouteResult {
  query: string;
  matched: KbCatalogEntry[];
  hint: string;
  disambiguation: unknown[];
}

const MAX_DOC_CHARS = 16_000;
const ROUTE_RESULT_LIMIT = 8;

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function queryTerms(query: string): string[] {
  const terms = new Set<string>();
  const trimmed = query.trim();
  if (trimmed) terms.add(normalizeForMatch(trimmed));
  for (const token of trimmed.split(/[\s,，。？?！!、/]+/)) {
    const normalized = normalizeForMatch(token);
    if (normalized.length >= 2) terms.add(normalized);
  }
  // Chinese queries are usually a single run without spaces; 2-grams widen recall.
  const compact = normalizeForMatch(trimmed);
  for (let i = 0; i + 2 <= compact.length; i += 1) terms.add(compact.slice(i, i + 2));
  return [...terms].filter((term) => term.length >= 1);
}

let catalogCache: { entries: KbCatalogEntry[]; loadedAt: number; root: string } | null = null;
const CATALOG_CACHE_TTL_MS = 60_000;

// 知识库文件读取失败时不把系统级错误（含绝对路径的 ENOENT 等）透传给模型，
// 统一替换为不含内部路径的友好提示。
async function readKbFile(relativePath: string, what: string, resources?: AgentResourcePolicy): Promise<string> {
  if (resources) return resourceKnowledgeFile(resources, relativePath);
  try {
    return await readFile(path.join(agentKnowledgeDir(), relativePath), "utf-8");
  } catch {
    throw new Error(`知识库不可用：无法读取${what}，请检查 AGENT_KB_DIR 是否指向有效的 RIIC-knowledge 克隆。`);
  }
}

async function loadCatalog(resources?: AgentResourcePolicy): Promise<KbCatalogEntry[]> {
  if (!resources && !agentKnowledgeDir()) {
    throw new Error("知识库目录未配置：请在环境变量 AGENT_KB_DIR 中指向本地克隆的 RIIC-knowledge 仓库（外部仓库，不随本仓库分发）。");
  }
  if (!resources && catalogCache && catalogCache.root === agentKnowledgeDir() && Date.now() - catalogCache.loadedAt < CATALOG_CACHE_TTL_MS) {
    return catalogCache.entries;
  }
  const text = await readKbFile("index/标题清单.md", "知识库索引", resources);
  const entries: KbCatalogEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^-\s+`([^`]+)`(?:（[^）]*）)?(.*)$/);
    if (!match) continue;
    const [, docPath, rest] = match;
    const label = rest.trim().replace(/\s+/g, " ");
    entries.push({ path: docPath, label: label || docPath });
  }
  if (!resources) catalogCache = { entries, loadedAt: Date.now(), root: agentKnowledgeDir() };
  return entries;
}

export async function searchKnowledgeBase(query: string, resources?: AgentResourcePolicy): Promise<KbRouteResult> {
  const entries = await loadCatalog(resources);
  const dictionary = JSON.parse(await readKbFile("index/消歧字典.json", "消歧字典", resources)) as { normalized_keys?: Record<string, string>; substring_warnings?: Array<{ short: string; long: string; resolution: string }>; [key: string]: unknown };
  const compact = normalizeForMatch(query).replace(/[·・]/g, "");
  const canonical = Object.entries(dictionary.normalized_keys ?? {}).find(([key]) => normalizeForMatch(key) === compact)?.[1];
  const expanded = typeof canonical === "string" ? `${query} ${canonical}` : query;
  const disambiguation: unknown[] = [];
  const additions: string[] = [];
  for (const section of ["combination_aliases", "operator_aliases", "skill_equivalence"]) {
    for (const [alias, raw] of Object.entries((dictionary[section] ?? {}) as Record<string, unknown>)) {
      if (!normalizeForMatch(expanded).includes(normalizeForMatch(alias))) continue;
      const value = raw as { canonical?: string; targets?: string[]; file?: string; groups?: Array<{ equivalent: string[]; holders: string[] }> };
      disambiguation.push({ alias, ...value });
      if (value.canonical) additions.push(value.canonical);
      additions.push(...(value.targets ?? []));
      for (const group of value.groups ?? []) additions.push(...group.equivalent, ...group.holders.map((name) => name.split("☆")[0]));
    }
  }
  disambiguation.push(...(dictionary.substring_warnings ?? []).filter((entry) => expanded.includes(entry.short)));
  const terms = queryTerms([expanded, ...additions].join(" "));
  for (const value of [expanded, ...additions]) terms.push(normalizeForMatch(value));
  const scored = entries
    .map((entry) => {
      const haystack = normalizeForMatch(`${entry.path}${entry.label}`);
      let score = 0;
      for (const term of terms) {
        if (haystack.includes(term)) score += term.length >= 3 ? 3 : 2;
      }
      if (normalizeForMatch(entry.path).includes(terms[0] ?? "\0")) score += 2;
      return { entry, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, ROUTE_RESULT_LIMIT)
    .map((item) => item.entry);
  return {
    query,
    disambiguation,
    matched: scored,
    hint: scored.length
      ? "以上是候选文档（path 为知识库内相对路径）。用 kb_read 读取正文；都不相关时可换关键词重试。"
      : "标题清单中没有匹配项。可换关键词重试，或直接读取 docs/1-基础设定/README.md 等模块导航。",
  };
}

export interface KbReadResult {
  path: string;
  title: string;
  content: string;
  truncated: boolean;
  nextOffset: number | null;
}

export async function readKnowledgeDoc(relativePath: string, offset = 0, resources?: AgentResourcePolicy): Promise<KbReadResult> {
  if (!resources && !agentKnowledgeDir()) throw new Error("知识服务暂不可用。");
  if (!relativePath.startsWith("docs/") || relativePath.includes("\\") || relativePath.split("/").includes("..")) throw new Error("仅可读取知识正文。");
  if (!Number.isInteger(offset) || offset < 0) throw new Error("无效正文偏移。");
  const root = path.resolve(agentKnowledgeDir());
  const target = path.resolve(root, relativePath);
  const withSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (target !== root && !target.startsWith(withSep)) {
    throw new Error("知识库路径越界，已拒绝读取。");
  }
  if (!target.toLowerCase().endsWith(".md")) {
    throw new Error("知识库工具只能读取 .md 文档。");
  }
  let text: string;
  try {
    text = resources ? resourceKnowledgeFile(resources, relativePath) : await readFile(target, "utf-8");
  } catch {
    throw new Error(`读取失败：${relativePath} 不存在或无法读取。可用 kb_route 重新定位。`);
  }
  const frontMatterTitle = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]?.match(/^title:\s*(.+)$/m)?.[1]?.trim();
  const headingTitle = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const truncated = text.length > offset + MAX_DOC_CHARS;
  return {
    path: relativePath,
    title: frontMatterTitle || headingTitle || "知识正文",
    content: text.slice(offset, offset + MAX_DOC_CHARS),
    nextOffset: truncated ? offset + MAX_DOC_CHARS : null,
    truncated,
  };
}
