import type { SkillEffect } from "@riic/endfield-solver/simulation.mjs";

/** 步进模拟里的一间隔舱室。key 与求解器 Result/manualTemplate 的 key 完全一致。 */
export type StepRoomKey = "中枢" | "会客室" | "制造舱1" | "制造舱2" | "培养舱";
export type StepRoomKind = "center" | "guest" | "mfg" | "grow";
export type StepRound = "round1" | "round2";
export type StepShift = "a" | "b";

export interface StepRoom {
  key: StepRoomKey;
  label: string;
  kind: StepRoomKind;
  slots: number;
  /** A 班 00:00–hour，B 班 hour–24:00；single 时忽略。 */
  hour: number;
  /** 单班循环：没有 B 班，名单只有 crewA 有效。 */
  single: boolean;
  /** 本舱追踪的产物类别；中枢为空。 */
  products: string[];
  enabled: boolean;
  crewA: (string | null)[];
  crewB: (string | null)[];
}

export interface StepBoostEntry {
  hour: number;
  minute: number;
  target: string | null;
}

export interface StepBoostDay {
  list: StepBoostEntry[];
}

export interface StepBoostConfig {
  dailyCount: 0 | 1 | 2;
  currentDay: number;
  days: StepBoostDay[];
}

export interface StepConfig {
  rooms: StepRoom[];
  moods: Record<string, number>;
  work: Record<string, boolean>;
  boost: StepBoostConfig;
}

/** 某干员在某舱室聚合后的效果（与 solver 的 crewStats 口径一致）。 */
export interface RoomEffects {
  reduce: number;
  restore: number;
  effMap: Record<string, number>;
}

export type EffectTable = Record<string, SkillEffect[]>;
export type RoomEffectResolver = (name: string, roomKey: StepRoomKey) => RoomEffects;

export interface SimOp {
  name: string;
  roomKey: StepRoomKey;
  round: StepRound;
  mood: number;
  working: boolean;
  wantWork: boolean;
  reduce: number;
  restore: number;
  effMap: Record<string, number>;
}

export interface SimRoomState {
  activeRound: StepRound;
  shiftEnabled: boolean;
  shiftABSec: number;
  shiftBASec: number;
  nextSwitchAtSec: number | null;
}

export interface StepSample {
  tSec: number;
  moods: Record<string, number>;
  workings: Record<string, boolean>;
  rates: Record<string, Record<string, number>>;
  activeRounds: Record<string, StepRound>;
}

export type StepEventType = "start" | "switch" | "boost" | "mood-zero" | "mood-full" | "end" | "pause";

/** Keep simulation identity and values independent of the display language. */
export type StepLogMessage =
  | { kind: "start"; startHour: number; duration: number; sampleSec: number }
  | { kind: "crew"; room: StepRoomKey; round: StepRound; names: string[]; shiftHours?: [number, number] }
  | { kind: "boost"; room: StepRoomKey; name: string; amount: number; before: number; after: number }
  | { kind: "mood-zero" | "mood-full"; room: StepRoomKey; name: string }
  | { kind: "switch"; room: StepRoomKey; from: StepRound; to: StepRound }
  | { kind: "end" | "pause" };

export type StepProblem =
  | { kind: "invalid-hour"; room: StepRoomKey }
  | { kind: "unknown-operator"; room: StepRoomKey; shift: string; name: string }
  | { kind: "duplicate-operator"; name: string };

export interface StepLogEntry {
  type: StepEventType;
  tSec: number;
  message: StepLogMessage;
  room?: StepRoomKey;
}

export interface StepView {
  tSec: number;
  maxTSec: number;
  startHour: number;
  ended: boolean;
  ops: SimOp[];
  rooms: Record<string, SimRoomState>;
  output: Record<string, number | Record<string, number>>;
  workTimeSec: Record<string, number>;
  history: StepSample[];
  log: StepLogEntry[];
}

export interface SimRates {
  work: number;
  rest: number;
  head: number;
  assist: number;
}

export interface SimOptions {
  startHour: number;
  maxHours: number;
  sampleSec: number;
}
