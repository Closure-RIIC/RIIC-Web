/** Small, bounded text policy shared by the API and the gateway configuration exporter. */
export type FilterRule = { id: string; text: string; kind: "word" | "pattern"; enabled: boolean };
export type FilterPolicy = { rules: FilterRule[]; allow: string[] };
export const DEFAULT_FILTER_POLICY: FilterPolicy = {
  rules: [
    { id: "riic-filter-probe", text: "RIIC_FILTER_BLOCK_TEST", kind: "word", enabled: true },
    { id: "explicit-csam", text: "未成年人色情", kind: "word", enabled: true },
    { id: "explicit-csam-en", text: "child pornography", kind: "word", enabled: true },
  ],
  allow: [],
};
const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
export function normalizeFilterText(text: string) {
  return text.normalize("NFKC").toLowerCase().replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
}
export class AgentFilterError extends Error {
  readonly ruleIds: string[];
  constructor(ruleIds: string[] = []) { super("请求包含不允许的内容，请调整后重试。"); this.name = "AgentFilterError"; this.ruleIds = ruleIds; }
}
export function parseFilterPolicy(value: unknown): FilterPolicy {
  if (!value || typeof value !== "object") throw new Error("Invalid filter policy");
  const input = value as FilterPolicy;
  if (!Array.isArray(input.rules) || input.rules.length > 500 || !Array.isArray(input.allow) || input.allow.length > 200) throw new Error("Filter policy is too large");
  const ids = new Set<string>();
  for (const rule of input.rules) {
    if (!rule || typeof rule.id !== "string" || !/^[a-z0-9_-]{1,64}$/i.test(rule.id) || ids.has(rule.id)
      || typeof rule.text !== "string" || !normalizeFilterText(rule.text).trim() || rule.text.length > 128
      || !["word", "pattern"].includes(rule.kind) || typeof rule.enabled !== "boolean") throw new Error("Invalid filter rule");
    // Pattern syntax deliberately has only '?' (one character), never unbounded regex.
    if (rule.kind === "pattern" && (/[\]{}()*+|\\^$]/.test(rule.text) || rule.text.includes("[") || !rule.text.replaceAll("?", "").trim())) throw new Error("Patterns support literals and ? only");
    ids.add(rule.id);
  }
  for (const word of input.allow) if (typeof word !== "string" || !word.trim() || word.length > 128) throw new Error("Invalid allow phrase");
  return structuredClone(input);
}
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function gatewayFilterOptions(policy: FilterPolicy) {
  // Allow phrases need span-aware evaluation in RIIC; do not reject them in the secondary guard.
  const rules = policy.allow.length ? [] : policy.rules.filter(rule => rule.enabled);
  return { action: "reject", check: "all", message: "Content rejected by site policy.",
    words: rules.filter(rule => rule.kind === "word").map(rule => rule.text),
    patterns: rules.filter(rule => rule.kind === "pattern").map(rule => rule.text.split("?").map(escapeRegex).join("[\\s\\S]")) };
}
export function compileFilterPolicy(value: unknown) {
  const policy = parseFilterPolicy(value);
  const rules = policy.rules.filter(rule => rule.enabled).map(rule => ({ id: rule.id,
    regex: new RegExp(rule.kind === "pattern" ? normalizeFilterText(rule.text).split("?").map(escapeRegex).join("[\\s\\S]") : escapeRegex(normalizeFilterText(rule.text)), "gu") }));
  const allowed = policy.allow.map(normalizeFilterText);
  const maxLength = Math.max(1, ...policy.rules.map(rule => normalizeFilterText(rule.text).length), ...allowed.map(word => word.length));
  function inspect(text: string) {
    if (text.length > 1_000_000) throw new Error("Filter text limit exceeded");
    const map: Array<{ start: number; end: number }> = [];
    let normalized = "";
    for (const item of segmenter.segment(text)) {
      if (item.segment.length > 256) throw new Error("Filter grapheme limit exceeded");
      const fragment = normalizeFilterText(item.segment);
      normalized += fragment;
      for (let i = 0; i < fragment.length; i++) map.push({ start: item.index, end: item.index + item.segment.length });
    }
    const allowSpans = allowed.flatMap(word => {
      const result: Array<[number, number]> = [];
      for (let at = normalized.indexOf(word); at >= 0; at = normalized.indexOf(word, at + 1)) result.push([at, at + word.length]);
      return result;
    });
    const hits: Array<{ id: string; start: number; end: number }> = [];
    for (const rule of rules) {
      rule.regex.lastIndex = 0;
      for (const match of normalized.matchAll(rule.regex)) {
        const start = match.index; const end = start + match[0].length;
        if (!allowSpans.some(([a, b]) => start >= a && end <= b)) hits.push({ id: rule.id, start: map[start].start, end: map[end - 1].end });
      }
    }
    return hits.sort((a, b) => a.start - b.start || b.end - a.end);
  }
  function mask(text: string) {
    const hits = inspect(text); let out = ""; let offset = 0;
    for (const hit of hits) { if (hit.end <= offset) continue; out += text.slice(offset, Math.max(offset, hit.start)) + "***"; offset = hit.end; }
    return { text: out + text.slice(offset), ruleIds: [...new Set(hits.map(hit => hit.id))] };
  }
  return { policy, maxLength, inspect, mask, assert(text: string) { const hits = inspect(text); if (hits.length) throw new AgentFilterError([...new Set(hits.map(hit => hit.id))]); } };
}
export type CompiledFilter = ReturnType<typeof compileFilterPolicy>;

/** Keep whole graphemes and every possible incomplete match; never flush an abnormal ending. */
export function createFilteredTextBuffer(filter: CompiledFilter, onHit: (ids: string[]) => void = () => {}) {
  let pending = "";
  return {
    push(delta: string, final = false) {
      pending += delta;
      if (pending.length > 32_768) throw new Error("Filter buffer limit exceeded");
      const segments = [...segmenter.segment(pending)];
      let boundary = final ? pending.length : 0;
      if (!final) {
        let kept = 0;
        for (let i = segments.length - 1; i >= 0; i--) {
          kept += normalizeFilterText(segments[i].segment).length;
          if (kept >= filter.maxLength + 2) { boundary = segments[i].index; break; }
        }
      }
      // A full match intersecting the send boundary must be handled as one span.
      const hits = filter.inspect(pending);
      for (const hit of hits) if (hit.start < boundary && hit.end > boundary) boundary = hit.start;
      const emitted = hits.filter(hit => hit.end <= boundary);
      let text = ""; let offset = 0;
      for (const hit of emitted) { if (hit.end <= offset) continue; text += pending.slice(offset, Math.max(offset, hit.start)) + "***"; offset = hit.end; }
      text += pending.slice(offset, boundary);
      if (emitted.length) onHit([...new Set(emitted.map(hit => hit.id))]);
      pending = pending.slice(boundary);
      return text;
    },
    discard() { pending = ""; },
  };
}
