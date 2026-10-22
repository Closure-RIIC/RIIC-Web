import data from "./generated/recruitment-data.json" with { type: "json" };

export const RECRUITMENT_TAGS = data.tags;
export const RECRUITMENT_OPERATORS = data.operators;
export const RECRUITMENT_SOURCE = data.source;
export const RECRUITMENT_TAG_GROUPS = [
  { label: "qualification", ids: [11, 14, 17] },
  { label: "profession", ids: [8, 1, 3, 2, 6, 4, 5, 7] },
  { label: "position", ids: [9, 10] },
  { label: "traits", ids: [28, 12, 13, 15, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 29] },
] as const;

export type RecruitmentOperator = (typeof data.operators)[number];
export type RecruitmentBoxEntry = { id: string; name: string; own: boolean };
export type RecruitmentOwnership = "owned" | "missing" | "unknown";
export interface RecruitmentResult {
  tags: number[];
  operators: (RecruitmentOperator & { ownership: RecruitmentOwnership })[];
  minimumRarity: number;
  missingCount: number | null;
}

/** Null means there is no usable personal Box (including demo data). */
export function recruitmentOwnership(operator: RecruitmentOperator, box: readonly RecruitmentBoxEntry[] | null): RecruitmentOwnership {
  if (box === null) return "unknown";
  return box.some((entry) => entry.own && (entry.id === operator.id || entry.name === operator.name)) ? "owned" : "missing";
}

/** Results assume every effective tag survives; they are not draw probabilities. */
export function calculateRecruitment(
  selectedTags: readonly number[],
  minutes = 540,
  box: readonly RecruitmentBoxEntry[] | null = null,
): RecruitmentResult[] {
  const tags = [...new Set(selectedTags)];
  if (tags.length > 5 || tags.some((id) => !RECRUITMENT_TAGS.some((tag) => tag.id === id))) throw new Error("Invalid recruitment tags");
  if (!Number.isInteger(minutes) || minutes < 60 || minutes > 540 || minutes % 10 !== 0) throw new Error("Invalid recruitment duration");
  const results: RecruitmentResult[] = [];
  const pool = RECRUITMENT_OPERATORS.map((operator) => ({ ...operator, ownership: recruitmentOwnership(operator, box) }));
  function visit(start: number, combination: number[]) {
    if (combination.length > 0) {
      const top = combination.includes(11);
      const senior = combination.includes(14);
      // When both rare tags are selected, the higher rarity takes precedence.
      const effectiveTags = top ? combination.filter((id) => id !== 14) : combination;
      const operators = pool.filter((operator) => {
        if (operator.rarity === 6 && !top) return false;
        if (operator.rarity === 5 && minutes < 240 && !senior && !top) return false;
        if (operator.rarity === 1 && minutes >= 240) return false;
        if (operator.rarity === 2 && minutes >= 460) return false;
        return effectiveTags.every((id) => operator.tags.includes(id));
      }).sort((a, b) => b.rarity - a.rarity || Number(b.ownership === "missing") - Number(a.ownership === "missing") || a.id.localeCompare(b.id));
      if (operators.length) results.push({
        tags: [...combination], operators,
        minimumRarity: Math.min(...operators.map((operator) => operator.rarity)),
        missingCount: box === null ? null : operators.filter((operator) => operator.ownership === "missing").length,
      });
    }
    if (combination.length === 3) return;
    for (let index = start; index < tags.length; index++) visit(index + 1, [...combination, tags[index]]);
  }
  visit(0, []);
  return results.sort((a, b) => b.minimumRarity - a.minimumRarity
    || (b.missingCount ?? 0) - (a.missingCount ?? 0)
    || a.operators.length - b.operators.length || a.tags.length - b.tags.length);
}
