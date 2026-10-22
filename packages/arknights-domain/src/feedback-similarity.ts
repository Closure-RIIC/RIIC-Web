import catalog from "./generated/arkntools/operator-catalog.json" with { type: "json" };
import english from "./generated/operator-english-names.json" with { type: "json" };
const nicknames: Record<string, string[]> = { "玛恩纳": ["叔叔"], "银灰": ["银老板"], "能天使": ["能天使姐"], "菲亚梅塔": ["肥鸭"], "令": ["令姐"], "焰尾": ["红松鼠"] };
const aliases = new Map<string, string>();
for (const operator of catalog) {
  for (const name of [operator.name, (english as Record<string, string>)[operator.name], ...(nicknames[operator.name] ?? [])]) if (name) aliases.set(name.toLocaleLowerCase(), operator.name);
}
const ordered = [...aliases.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b));
export function normalizeFeedbackOperator(name: string) { return aliases.get(name.trim().toLocaleLowerCase()) ?? name.trim(); }
export function feedbackOperators(room: { operators: string[] } | null, note: string) {
  const found = new Set((room?.operators ?? []).map(normalizeFeedbackOperator));
  let text = note.toLocaleLowerCase();
  for (const alias of ordered) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(/^[a-z0-9]/i.test(alias) ? `(?<![a-z0-9])${escaped}(?![a-z0-9])` : escaped, "g");
    if (pattern.test(text)) { found.add(aliases.get(alias)!); text = text.replace(pattern, " "); }
  }
  return [...found].sort();
}
export type SimilarityInput = { id: string; diagnosticId: string; facility: string; operators: string[]; inputFingerprint: string | null; errorCode: string | null };
export function feedbackMatch(left: SimilarityInput, right: SimilarityInput) {
  if (left.id === right.id) return null;
  if (left.diagnosticId === right.diagnosticId) return { rank: 0, reason: "same_diagnostic", operators: [] };
  if (left.inputFingerprint && left.inputFingerprint === right.inputFingerprint) return { rank: 1, reason: "same_input", operators: [] };
  if (left.facility !== right.facility || left.facility === "unknown") return null;
  const shared = left.operators.filter((name) => right.operators.includes(name));
  if (shared.length) return { rank: 2, reason: "shared_room_operators", operators: shared };
  if (left.errorCode && left.errorCode === right.errorCode) return { rank: 3, reason: "same_facility_error", operators: [] };
  return null;
}
