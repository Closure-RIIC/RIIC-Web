import catalogue from "./generated/arkntools/operator-catalog.json" with { type: "json" };

export const MAX_OPERATOR_PORTRAITS = 128;
export interface OperatorMention { start: number; end: number; id: string; name: string; portrait: string }
interface Operator { id: string; name: string; portrait: string }
interface TrieNode { children: Map<string, TrieNode>; operator?: Operator }
const root: TrieNode = { children: new Map() };
const operatorsByName = new Map<string, Operator>();
function addName(name: string, operator: Operator) {
  operatorsByName.set(name, operator);
  let node = root;
  for (const character of name) {
    if (!node.children.has(character)) node.children.set(character, { children: new Map() });
    node = node.children.get(character)!;
  }
  node.operator = operator;
}
for (const operator of catalogue) {
  if (/^\/images\/operator-portraits\/[a-zA-Z0-9_-]+\.webp\?v=\d+-[a-f0-9]{12}$/.test(operator.portrait)) addName(operator.name, operator);
}
const amiya = catalogue.find((operator) => operator.id === "char_002_amiya");
if (amiya) for (const name of ["阿米娅(近卫)", "阿米娅(医疗)", "阿米娅（近卫）", "阿米娅（医疗）"]) addName(name, amiya);

const boundary = /[\s，。！？、；：,.!?;:()[\]{}「」『』“”‘’"'<>《》]/;
const latinWord = /[A-Za-z0-9_]/;
const cache = new Map<string, readonly OperatorMention[]>();
let cacheCharacters = 0;
const CACHE_CHARACTERS = 256_000;

/** Longest match; ambiguous short names require explicit delimiters or operator context. */
export function findOperatorMentions(text: string, explicit = false): readonly OperatorMention[] {
  const key = `${explicit ? "1" : "0"}:${text}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const mentions: OperatorMention[] = [];
  for (let start = 0; start < text.length && mentions.length < MAX_OPERATOR_PORTRAITS;) {
    let node = root;
    let candidate: OperatorMention | undefined;
    for (let end = start; end < text.length; end++) {
      const next = node.children.get(text[end]);
      if (!next) break;
      node = next;
      if (node.operator) candidate = { start, end: end + 1, id: node.operator.id, name: node.operator.name, portrait: node.operator.portrait };
    }
    if (!candidate) { start++; continue; }
    const label = text.slice(start, candidate.end);
    const before = text[start - 1];
    const after = text[candidate.end];
    const standalone = (!before || boundary.test(before)) && (!after || boundary.test(after));
    const context = /(?:干员|培养|练度|练|精二|专精|招募|部署|编入|推荐|选择|使用|携带)[：:、\s]*$/.test(text.slice(Math.max(0, start - 12), start));
    const latin = /[A-Za-z0-9]/.test(label);
    const boundedLatin = (!before || !latinWord.test(before)) && (!after || !latinWord.test(after));
    const shortName = [...label].length <= 2;
    // “空” alone is also an empty-slot label, including bold text and table cells.
    // Require an operator label here; [干员:空] is resolved separately below.
    const soraContext = /干员[：:、\s]*$/.test(text.slice(Math.max(0, start - 12), start));
    const allowedName = label === "空" ? soraContext && (!after || boundary.test(after) || after === "的")
      : !shortName || standalone || (explicit && text.trim() === label) || (context && (!after || boundary.test(after) || /^(?:的|与|和|及|进行|到|至|升|练)/.test(text.slice(candidate.end))));
    if ((!latin || boundedLatin) && allowedName) {
      mentions.push(candidate);
    }
    // Consume rejected longest names too: never reinterpret 红云 as 红.
    start = candidate.end;
  }
  if (key.length <= CACHE_CHARACTERS) {
    while (cache.size >= 64 || cacheCharacters + key.length > CACHE_CHARACTERS) {
      const oldest = cache.keys().next().value!;
      cacheCharacters -= oldest.length;
      cache.delete(oldest);
    }
    cache.set(key, mentions);
    cacheCharacters += key.length;
  }
  return mentions;
}

/** Tags carry names only; portraits always come from the trusted local catalogue. */
export function prepareOperatorText(source: string, eligible: boolean, explicit = false): { text: string; mentions: OperatorMention[] } {
  let text = "";
  let cursor = 0;
  const mentions: OperatorMention[] = [];
  const appendPlain = (part: string) => {
    if (eligible && mentions.length < MAX_OPERATOR_PORTRAITS) {
      const offset = text.length;
      mentions.push(...findOperatorMentions(part, explicit).slice(0, MAX_OPERATOR_PORTRAITS - mentions.length).map(mention => ({ ...mention, start: mention.start + offset, end: mention.end + offset })));
    }
    text += part;
  };
  for (const tag of source.matchAll(/\[干员[:：]([^\]\r\n]{1,64})\]/g)) {
    appendPlain(source.slice(cursor, tag.index));
    const name = tag[1].trim();
    const operator = operatorsByName.get(name);
    if (eligible && operator && mentions.length < MAX_OPERATOR_PORTRAITS) {
      mentions.push({ ...operator, start: text.length, end: text.length + name.length });
    }
    text += name;
    cursor = tag.index + tag[0].length;
  }
  appendPlain(source.slice(cursor));
  return { text, mentions };
}
