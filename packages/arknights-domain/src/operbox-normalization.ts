import type { OperBoxEntry } from "./types";

const UNSUPPORTED_OPERATOR_VARIANT_NAMES = new Set([
  "阿米娅（近卫）",
  "阿米娅（医疗）",
]);

function isStrongerEntry(candidate: OperBoxEntry, current: OperBoxEntry): boolean {
  const candidateScore = [
    Number(candidate.own),
    candidate.elite,
    candidate.level,
    candidate.potential,
    candidate.rarity,
  ];
  const currentScore = [
    Number(current.own),
    current.elite,
    current.level,
    current.potential,
    current.rarity,
  ];

  for (const [index, value] of candidateScore.entries()) {
    if (value !== currentScore[index]) return value > currentScore[index];
  }
  return false;
}

/**
 * Produces the unique-name operbox required by infra-cli.
 *
 * Skland can return multiple class forms with different IDs but the same
 * display name. infra-cli resolves operators by name, so keeping more than
 * one form is ambiguous. Preserve the strongest record and keep the original
 * order stable for all non-duplicates.
 */
export function normalizeOperboxEntries(entries: readonly OperBoxEntry[]): OperBoxEntry[] {
  const normalized: OperBoxEntry[] = [];
  const indexByName = new Map<string, number>();

  for (const entry of entries) {
    const importedName = entry.name.trim();
    if (!importedName || UNSUPPORTED_OPERATOR_VARIANT_NAMES.has(importedName)) continue;

    const id = entry.id.trim();
    const name = importedName;

    const candidate = id === entry.id && name === entry.name ? entry : { ...entry, id, name };
    const existingIndex = indexByName.get(name);
    if (existingIndex === undefined) {
      indexByName.set(name, normalized.length);
      normalized.push(candidate);
      continue;
    }

    if (isStrongerEntry(candidate, normalized[existingIndex])) {
      normalized[existingIndex] = candidate;
    }
  }

  return normalized;
}
