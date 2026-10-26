import manifest from "./defense-portraits.json" with { type: "json" };
import pinyin from "@riic/arknights-domain/generated/arkntools/operator-pinyin.json" with { type: "json" };

export const DEFENSE_PORTRAITS = ["default", "portrait-1", "portrait-2"] as const;
export type DefensePortrait = (typeof DEFENSE_PORTRAITS)[number] | `char_${string}`;
export const DEFENSE_OPERATOR_PORTRAITS = manifest.portraits;
const byId = new Map(manifest.portraits.map((entry) => [entry.id, entry]));
const searchNames = pinyin as Record<string, string[]>;
const searchable = manifest.portraits.map((entry) => ({
  entry,
  search: [entry.name, entry.id, ...(searchNames[entry.name] ?? [])].join(" ").toLowerCase(),
}));

export function isDefensePortrait(value: unknown): value is DefensePortrait {
  return typeof value === "string" &&
    ((DEFENSE_PORTRAITS as readonly string[]).includes(value) || byId.has(value));
}

export function findDefensePortrait(value: string | undefined) {
  return value ? byId.get(value) : undefined;
}

export function searchDefensePortraits(query: string) {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, "");
  return normalized
    ? searchable.filter(({ search }) => search.includes(normalized)).map(({ entry }) => entry)
    : DEFENSE_OPERATOR_PORTRAITS;
}

export function defensePortraitUrl(value: DefensePortrait | undefined, seat = 0) {
  const operator = findDefensePortrait(value);
  if (operator) return `/images/defense-operators/${operator.id}.webp?v=${operator.sha256.slice(0, 12)}`;
  const second = value === "portrait-2" || ((!value || value === "default") && seat % 2 === 1);
  return `/images/defense-reference/${second ? "waiting-portrait-2.png" : "waiting-portrait.png"}`;
}
