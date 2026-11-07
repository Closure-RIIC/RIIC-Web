import { manualLevelFor, maxEliteForRarity } from "@riic/arknights-domain/manual-operbox";
import { OPERATOR_CATALOG } from "./operatorPortraits.ts";
import type { SchedulePosterDocument } from "./schedule-poster-document.ts";
import type { OperBoxEntry } from "@riic/arknights-domain/types";

/** Keep manual scheduling defaults independent of poster validation and sample data. */
export function defaultPosterOperator(name: string): OperBoxEntry | undefined {
  const operator = OPERATOR_CATALOG.find(operator => operator.name === name);
  if (!operator) return;
  const elite = maxEliteForRarity(operator.rarity);
  return { id: operator.id, name, elite, level: manualLevelFor(operator.rarity, elite), rarity: operator.rarity, own: true, potential: 1 };
}

/** Preserve the complete working Box; only missing schedule references need a fallback. */
export function posterOperators(doc: SchedulePosterDocument, fallbackOperators: readonly OperBoxEntry[] = []): OperBoxEntry[] {
  const operators = doc.operators.map(operator => ({ ...operator }));
  const known = new Set(operators.map(operator => operator.name));
  const names = new Set(doc.draft.shifts.flatMap(shift => Object.values(shift.rooms).flatMap(room => room.operators).concat(shift.fiammettaTarget)).concat(doc.presentation.dormHangerOperators));
  if (doc.draft.fiammettaEnabled) names.add("菲亚梅塔");
  for (const name of names) {
    if (!name || known.has(name)) continue;
    const reference = fallbackOperators.find(operator => operator.name === name);
    const entry = reference ? { ...reference, own: false } : defaultPosterOperator(name);
    if (entry) { operators.push(entry); known.add(name); }
  }
  return operators;
}
