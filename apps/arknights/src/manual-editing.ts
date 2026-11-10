import type { BaseBlueprint, OperBoxEntry } from "@riic/arknights-domain/types";
import type { ManualScheduleDraft } from "./manual-schedule.ts";
import type { ManualPlanResult } from "./manual-plan-result.ts";
import { createManualProductionPresentation } from "./production-summary-adapters.ts";

export type ManualCalculationMode = "native" | "manual";

/** View-only changes do not invalidate a daily-production calculation. */
export function manualEvaluationInputKey(layout: BaseBlueprint, draft: ManualScheduleDraft, operbox: readonly OperBoxEntry[] | null, mode: ManualCalculationMode) {
  return JSON.stringify([layout, { ...draft, activeShift: 0, startTime: "00:00" }, operbox, mode]);
}

export type DraftHistory = { present: ManualScheduleDraft; past: ManualScheduleDraft[] };
export type DraftUpdate = ManualScheduleDraft | ((draft: ManualScheduleDraft) => ManualScheduleDraft);
export type DraftHistoryAction = { type: "edit" | "sync"; update: DraftUpdate } | { type: "undo" } | { type: "reset" };
const draftKey = (draft: ManualScheduleDraft) => JSON.stringify({ ...draft, activeShift: 0 });

/** Bounded, immutable history. Restoration and external reconciliation are not user edits. */
export function draftHistoryReducer(state: DraftHistory, action: DraftHistoryAction): DraftHistory {
  if (action.type === "reset") return state.past.length ? { ...state, past: [] } : state;
  if (action.type === "undo") {
    const previous = state.past.at(-1);
    return previous ? { present: previous, past: state.past.slice(0, -1) } : state;
  }
  const next = typeof action.update === "function" ? action.update(state.present) : action.update;
  if (next === state.present) return state;
  const changed = draftKey(next) !== draftKey(state.present);
  return { present: next, past: action.type === "edit" && changed ? [...state.past.slice(-49), state.present] : state.past };
}

/** Compare displayed values, including drones, equivalent gold and the shared gold unit conversion. */
export function manualProductionDeltas(current: ManualPlanResult, baseline: ManualPlanResult): Record<string, number | null> {
  const values = (result: ManualPlanResult) => new Map(createManualProductionPresentation(result).groups.flatMap(group =>
    [group.primary, ...(group.supporting ? [group.supporting] : [])].map(product => [product.id, product.amount.value] as const)));
  const previous = values(baseline);
  return Object.fromEntries([...values(current)].map(([id, value]) => {
    const before = previous.get(id);
    return [id, value === null || before == null || !Number.isFinite(value) || !Number.isFinite(before) ? null : value - before];
  }));
}
