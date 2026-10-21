import type { BaseBlueprint, OperBoxEntry } from "../types.ts";
import type { ManualScheduleDraft } from "../manual-schedule.ts";

export interface FiammettaRule {
  enabled: boolean;
  mode: "specified" | "previous" | "auto";
  wait: boolean;
}
export interface IdleRule { enabled: boolean; target?: string; dorm?: string }
export interface MoodSettings {
  version: 1;
  cycles: number;
  idleEnabled: boolean;
  fiammetta: Record<number, FiammettaRule>;
  /** cycle:shift:operator, all indexes zero based */
  idle: Record<string, IdleRule>;
}
export const defaultMoodSettings = (): MoodSettings => ({
  version: 1, cycles: 1, idleEnabled: true, fiammetta: {}, idle: {},
});
export interface MoodSimulationInput {
  layout: BaseBlueprint;
  operbox: OperBoxEntry[];
  draft: ManualScheduleDraft;
  settings: MoodSettings;
  fiammettaEnabled: boolean;
}
export interface MoodContribution {
  side: "consume" | "recover";
  label: string;
  value: number;
  owner?: string;
  skill?: string;
  group: string;
  applied: boolean;
}
export interface MoodRate { consume: number; recover: number; net: number; items: MoodContribution[] }
export interface MoodPoint { time: number; moods: Record<string, number> }
export interface MoodSegment {
  start: number;
  end: number;
  cycle: number;
  shift: number;
  rooms: Record<string, string[]>;
}
export interface MoodEvent {
  time: number;
  kind: "entry" | "idle" | "skipped";
  operator: string;
  target?: string;
  room?: string;
  reason?: "entry_target_missing" | "dorm_unavailable" | "no_candidate" | "target_not_higher";
}
export interface IdleCandidate {
  cycle: number; shift: number; operator: string; mood: number;
  room: string | null;
  options: { room: string; operators: { name: string; mood: number }[]; free: boolean }[];
}
export interface MoodSimulationResult {
  revision: string;
  names: string[];
  total: number;
  points: MoodPoint[];
  segments: MoodSegment[];
  events: MoodEvent[];
  idleCandidates: IdleCandidate[];
  warnings: string[];
  cycleEnds: Record<string, number>[];
}
export type MoodWorkerRequest =
  | { id: number; type: "simulate"; input: MoodSimulationInput }
  | { id: number; type: "detail"; time: number; name: string };
export type MoodWorkerResponse =
  | { id: number; type: "result"; result: MoodSimulationResult }
  | { id: number; type: "detail"; name: string; time: number; rate: MoodRate }
  | { id: number; type: "error"; message: string };
