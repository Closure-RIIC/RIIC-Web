import { useCallback, useReducer } from "react";
import { draftHistoryReducer, type DraftUpdate } from "../manual-editing.ts";
import type { ManualScheduleDraft } from "../manual-schedule.ts";

export function useManualDraftHistory(initial: () => ManualScheduleDraft) {
  const [state, dispatch] = useReducer(draftHistoryReducer, initial, create => ({ present: create(), past: [] }));
  const setDraft = useCallback((update: DraftUpdate) => dispatch({ type: "edit", update }), []);
  const syncDraft = useCallback((update: DraftUpdate) => dispatch({ type: "sync", update }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const resetHistory = useCallback(() => dispatch({ type: "reset" }), []);
  return { draft: state.present, setDraft, syncDraft, undo, resetHistory, canUndo: state.past.length > 0 };
}
