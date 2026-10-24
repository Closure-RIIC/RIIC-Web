import { useMemo } from "react";
import type { Result, Workspace } from "@riic/endfield-solver/model.mjs";
import { SIM_RATES } from "@riic/endfield-solver/simulation.mjs";
import { StepSimulation } from "../step/step-engine.ts";
import { defaultBoost, effectTable, ensureBoostDays, maxBoostDays, roomEffectResolver, roomsFromManual } from "../step/step-model.ts";
import type { SimOp, SimRates, StepRoomKey, StepSample, StepView } from "../step/step-types.ts";
import { SIM_HOURS, SIM_SAMPLE_SECONDS } from "./constants.ts";

const RATES: SimRates = { work: SIM_RATES.work, rest: SIM_RATES.rest, head: SIM_RATES.head, assist: SIM_RATES.assist };

/** 一次算到最长时长，切换时长时只裁剪显示范围，不重算。 */
const MAX_HOURS = Math.max(...SIM_HOURS);

/** 手动草稿里是否真的有排班；没有就不显示模拟。 */
export function hasManualCrew(workspace: Workspace): boolean {
  return (workspace.manual ?? []).some(room => room.a.some(Boolean) || room.b.some(Boolean));
}

/**
 * 用当前手动草稿跑完最长时长。
 * 配置全部来自排班页（换班整点、一班/二班名单、设施等级），这里不保存任何模拟设置。
 */
export function simulateMood(workspace: Workspace, result: Result | null): StepView | null {
  const rooms = roomsFromManual(workspace).filter(room =>
    room.enabled && (room.crewA.some(Boolean) || room.crewB.some(Boolean)));
  if (!rooms.length) return null;
  const days = maxBoostDays(8, MAX_HOURS);
  const boost = ensureBoostDays(defaultBoost(workspace, result), days);
  const simulation = new StepSimulation(
    { rooms, moods: {}, work: {}, boost },
    roomEffectResolver(effectTable(workspace)),
    RATES,
    { startHour: 0, maxHours: MAX_HOURS, sampleSec: SIM_SAMPLE_SECONDS },
  );
  simulation.runToEnd();
  return simulation.view;
}

/** 组件里按 workspace/result 记忆化；`hours` 不参与，避免切换时长重算。 */
export function useMoodSimulation(workspace: Workspace, result: Result | null): StepView | null {
  return useMemo(() => simulateMood(workspace, result), [workspace, result]);
}

/** 把一次跑到 96 小时的视图裁剪到 `hours`，供图表与统计使用。 */
export interface MoodWindow {
  view: StepView;
  hours: number;
  history: StepSample[];
  ops: SimOp[];
  rooms: StepRoomKey[];
  totalSec: number;
}

export function windowOf(view: StepView | null, hours: number): MoodWindow | null {
  if (!view) return null;
  const totalSec = Math.min(view.maxTSec, hours * 3600);
  return {
    view,
    hours,
    history: view.history.filter(sample => sample.tSec <= totalSec),
    ops: view.ops,
    rooms: Object.keys(view.rooms) as StepRoomKey[],
    totalSec,
  };
}

/** 某时刻各干员的状态（给状态列表用）。 */
export interface OperatorState {
  name: string;
  room: StepRoomKey;
  mood: number;
  status: "work" | "rest" | "zero";
}

export function operatorsAt(window: MoodWindow, tSec: number): OperatorState[] {
  const sample = window.history.find(item => item.tSec >= tSec) ?? window.history[window.history.length - 1];
  if (!sample) return [];
  return window.ops.map(op => {
    const mood = sample.moods?.[op.name] ?? 0;
    const working = sample.workings?.[op.name] ?? false;
    return { name: op.name, room: op.roomKey, mood, status: mood <= 0.01 ? "zero" : working ? "work" : "rest" };
  });
}

/** 图表与统计需要的聚合结果。 */
export interface MoodSummary {
  rooms: StepRoomKey[];
  zeroEvents: number;
  switches: number;
  products: Record<string, number>;
  workHours: Record<string, number>;
}

export function summarize(window: MoodWindow | null): MoodSummary | null {
  if (!window) return null;
  const limit = window.totalSec;
  const scale = limit / Math.max(1, window.view.maxTSec);
  const products: Record<string, number> = {};
  for (const value of Object.values(window.view.output)) {
    if (typeof value === "number") continue;
    for (const [name, amount] of Object.entries(value)) products[name] = (products[name] ?? 0) + amount * scale;
  }
  return {
    rooms: window.rooms,
    zeroEvents: window.view.log.filter(entry => entry.type === "mood-zero" && entry.tSec <= limit).length,
    switches: window.view.log.filter(entry => entry.type === "switch" && entry.tSec <= limit).length,
    products,
    workHours: Object.fromEntries(Object.entries(window.view.workTimeSec).map(([key, seconds]) => [key, (seconds * scale) / 3600])),
  };
}
