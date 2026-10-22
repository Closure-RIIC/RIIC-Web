import operatorCatalogJson from "./generated/arkntools/operator-catalog.json" with { type: "json" };

import { normalizeOperboxEntries } from "./operbox-normalization.ts";
import type { OperBoxEntry } from "./types.ts";

interface OperatorNameRecord {
  id: string;
  name: string;
}

const SIMPLIFIED_CHINESE_NAME_BY_ID = new Map(
  (operatorCatalogJson as OperatorNameRecord[]).map((operator) => [operator.id, operator.name]),
);

/**
 * Resolves an operator's canonical Simplified Chinese name from its stable
 * game-data ID. MAA exports use the same ID across Chinese, Japanese, English,
 * and Traditional Chinese clients, so the localized display name never needs
 * to reach the planner.
 */
export function simplifiedChineseOperatorNameForId(id: string): string | undefined {
  const normalizedId = id.trim();
  if (!normalizedId) return undefined;
  return SIMPLIFIED_CHINESE_NAME_BY_ID.get(normalizedId)
    ?? (normalizedId.startsWith("char_")
      ? undefined
      : SIMPLIFIED_CHINESE_NAME_BY_ID.get(`char_${normalizedId}`));
}

/**
 * Canonicalizes localized MAA names only on the user-import path. Keeping this
 * helper in the catalog module lets the initial calculator bundle avoid
 * downloading the complete operator-name table.
 */
export function normalizeImportedOperboxEntries(entries: readonly OperBoxEntry[]): OperBoxEntry[] {
  return normalizeOperboxEntries(entries.map((entry) => {
    const canonicalName = simplifiedChineseOperatorNameForId(entry.id);
    return canonicalName && canonicalName !== entry.name
      ? { ...entry, name: canonicalName }
      : entry;
  }));
}
