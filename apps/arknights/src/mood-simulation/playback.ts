import { segmentAt } from "./presentation.ts";
import type { MoodSimulationInput, MoodSimulationResult } from "./types.ts";

export interface MoodPlaybackInput {
  calculationKey: string;
  scheduleKey: string;
  activeShift: number;
}

export function moodPlaybackInput(input: MoodSimulationInput): MoodPlaybackInput {
  const normalized = { ...input, draft: { ...input.draft, activeShift: 0, startTime: "00:00" } };
  return {
    calculationKey: JSON.stringify(normalized),
    scheduleKey: JSON.stringify({ ...normalized, settings: undefined }),
    activeShift: Math.max(0, Math.min(input.draft.activeShift, input.draft.shifts.length - 1)),
  };
}

export interface MoodPlaybackState {
  input: MoodPlaybackInput;
  result: MoodSimulationResult | null;
  status: "pending" | "ready" | "error";
  error: string | null;
  cursor: number;
  playing: boolean;
  /** Resolve against the latest selected shift when the current calculation completes. */
  awaitingShift: boolean;
}

export function createMoodPlayback(input: MoodPlaybackInput): MoodPlaybackState {
  return { input, result: null, status: "pending", error: null, cursor: 0, playing: false, awaitingShift: true };
}

export type MoodPlaybackAction =
  | { type: "input"; input: MoodPlaybackInput }
  | { type: "result"; calculationKey: string; result: MoodSimulationResult }
  | { type: "error"; calculationKey: string; message: string }
  | { type: "enter" }
  | { type: "pause" }
  | { type: "toggle"; fromEditor: boolean }
  | { type: "seek"; time: number }
  | { type: "tick"; calculationKey: string; time: number };

function clampTime(result: MoodSimulationResult, time: number): number {
  return Math.max(0, Math.min(result.total, time));
}

function shiftStart(result: MoodSimulationResult, shift: number): number {
  return result.segments.find(segment => segment.cycle === 0 && segment.shift === shift)?.start ?? 0;
}

function enterPlayback(state: MoodPlaybackState): MoodPlaybackState {
  const sameShift = state.result && state.cursor < state.result.total
    && segmentAt(state.result, state.cursor)?.shift === state.input.activeShift;
  const align = state.awaitingShift || !sameShift;
  if (state.status !== "ready" || !state.result) return { ...state, playing: false, awaitingShift: align };
  return {
    ...state, playing: false, awaitingShift: false,
    cursor: align ? shiftStart(state.result, state.input.activeShift) : state.cursor,
  };
}

/** Navigation is independent of calculation identity: changing tabs never restarts the worker. */
export function moodPlaybackReducer(state: MoodPlaybackState, action: MoodPlaybackAction, observedCursor = state.cursor): MoodPlaybackState {
  // The UI's external clock can advance without rerendering the navigation owner.
  if (observedCursor !== state.cursor) state = { ...state, cursor: observedCursor };
  switch (action.type) {
    case "input": {
      const calculating = action.input.calculationKey !== state.input.calculationKey;
      const align = state.awaitingShift || action.input.scheduleKey !== state.input.scheduleKey
        || action.input.activeShift !== state.input.activeShift;
      const next = {
        ...state, input: action.input, playing: false, awaitingShift: align,
        ...(calculating ? { status: "pending" as const, error: null } : {}),
      };
      return align && next.status === "ready" ? enterPlayback(next) : next;
    }
    case "result":
      if (action.calculationKey !== state.input.calculationKey) return state;
      return {
        ...state, result: action.result, status: "ready", error: null, playing: false, awaitingShift: false,
        cursor: state.awaitingShift ? shiftStart(action.result, state.input.activeShift) : clampTime(action.result, state.cursor),
      };
    case "error":
      if (action.calculationKey !== state.input.calculationKey) return state;
      return { ...state, status: "error", error: action.message, playing: false };
    case "enter":
      return enterPlayback(state);
    case "pause":
      return state.playing ? { ...state, playing: false } : state;
    case "toggle": {
      if (state.status !== "ready" || !state.result) return state;
      const next = action.fromEditor ? enterPlayback(state) : state;
      return { ...next, playing: !next.playing, cursor: next.cursor >= state.result.total ? 0 : next.cursor };
    }
    case "seek":
      if (state.status !== "ready" || !state.result) return state;
      return { ...state, cursor: clampTime(state.result, action.time), playing: false, awaitingShift: false };
    case "tick":
      if (action.calculationKey !== state.input.calculationKey || !state.playing || state.status !== "ready" || !state.result) return state;
      return { ...state, cursor: clampTime(state.result, action.time), playing: action.time < state.result.total };
  }
}
