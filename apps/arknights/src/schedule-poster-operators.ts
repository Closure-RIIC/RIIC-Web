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

export function posterOperators(doc: SchedulePosterDocument): OperBoxEntry[] {
  const names = new Set(doc.draft.shifts.flatMap(shift => Object.values(shift.rooms).flatMap(room => room.operators)).concat(doc.presentation.dormHangerOperators));
  if (doc.draft.fiammettaEnabled) names.add("菲亚梅塔");
  return [...names].flatMap(name => {
    if (!name) return [];
    const entry = doc.operators.find(operator => operator.name === name) ?? defaultPosterOperator(name);
    return entry ? [{ ...entry, own: true }] : [];
  });
}
