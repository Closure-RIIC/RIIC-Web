import type { StepBoostConfig, StepConfig } from "./step-types.ts";
import { STEP_STORAGE_KEY } from "./step-keys.ts";
import { SIM_HOURS, SIM_SAMPLE_SECONDS, SIM_SPEEDS } from "../mood-simulation/constants.ts";

/** 只保存模拟参数；人员、设施和换班时间始终来自手动排班。 */
export { STEP_STORAGE_KEY };

export interface StepControls {
  startHour: number;
  maxHours: number;
  sampleSec: number;
  speed: number;
}

export const DEFAULT_STEP_CONTROLS: StepControls = { startHour: 8, maxHours: 24, sampleSec: SIM_SAMPLE_SECONDS, speed: 100 };

export interface StoredStep {
  version: 2;
  controls: StepControls;
  moods: Record<string, number>;
  work: Record<string, boolean>;
  boost?: StepBoostConfig;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function storageOf(kind: "local" | "session"): Storage | undefined {
  try {
    if (kind === "local") return typeof localStorage === "undefined" ? undefined : localStorage;
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

function sanitizeControls(value: unknown): StepControls {
  if (!isRecord(value)) return { ...DEFAULT_STEP_CONTROLS };
  const choice = (input: unknown, options: readonly number[], fallback: number) =>
    typeof input === "number" && options.includes(input) ? input : fallback;
  return {
    startHour: typeof value.startHour === "number" && Number.isFinite(value.startHour)
      ? Math.min(23, Math.max(0, Math.round(value.startHour))) : DEFAULT_STEP_CONTROLS.startHour,
    maxHours: choice(value.maxHours, SIM_HOURS, DEFAULT_STEP_CONTROLS.maxHours),
    sampleSec: choice(value.sampleSec, [10, 30, 60, 300, 900], DEFAULT_STEP_CONTROLS.sampleSec),
    speed: choice(value.speed, SIM_SPEEDS, DEFAULT_STEP_CONTROLS.speed),
  };
}

function sanitizeNumbers(value: unknown, min: number, max: number): Record<string, number> {
  if (!isRecord(value)) return {};
  const numbers: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) continue;
    numbers[key] = Math.min(max, Math.max(min, Math.round(entry)));
  }
  return numbers;
}

function sanitizeBooleans(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {};
  const booleans: Record<string, boolean> = {};
  for (const [key, entry] of Object.entries(value)) if (typeof entry === "boolean") booleans[key] = entry;
  return booleans;
}

function sanitizeBoost(value: unknown): StepBoostConfig | undefined {
  if (!isRecord(value) || !Array.isArray(value.days)) return undefined;
  const dailyCount: 0 | 1 | 2 = value.dailyCount === 1 ? 1 : value.dailyCount === 2 ? 2 : 0;
  const days = value.days.slice(0, 5).flatMap(day => {
    if (!isRecord(day) || !Array.isArray(day.list)) return [];
    const list = day.list.slice(0, 2).flatMap(entry => {
      if (!isRecord(entry)) return [];
      const hour = typeof entry.hour === "number" && Number.isFinite(entry.hour) ? Math.min(23, Math.max(0, Math.round(entry.hour))) : 12;
      const minute = typeof entry.minute === "number" && Number.isFinite(entry.minute) ? Math.min(59, Math.max(0, Math.round(entry.minute))) : 0;
      const target = typeof entry.target === "string" && entry.target ? entry.target : null;
      return [{ hour, minute, target }];
    });
    return [{ list }];
  });
  if (!days.length) return undefined;
  const currentDay = typeof value.currentDay === "number" && Number.isFinite(value.currentDay) ? Math.min(days.length - 1, Math.max(0, Math.round(value.currentDay))) : 0;
  return { dailyCount, currentDay, days };
}

export function loadStepConfig(storage: Pick<Storage, "getItem"> | undefined = storageOf("local")): StoredStep | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STEP_STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || (value.version !== 1 && value.version !== 2)) return null;
    return {
      version: 2,
      controls: sanitizeControls(value.controls),
      moods: sanitizeNumbers(value.moods, 0, 100),
      work: sanitizeBooleans(value.work),
      ...(value.boost ? { boost: sanitizeBoost(value.boost) } : {}),
    };
  } catch {
    return null;
  }
}

export function saveStepConfig(value: StoredStep, storage: Pick<Storage, "setItem"> | undefined = storageOf("local")): void {
  if (!storage) return;
  try { storage.setItem(STEP_STORAGE_KEY, JSON.stringify(value)); }
  catch { /* 存储不可用时仅影响刷新后的恢复，当前会话仍可用。 */ }
}

export function clearStepConfig(storage: Pick<Storage, "removeItem"> | undefined = storageOf("local")): void {
  try { storage?.removeItem(STEP_STORAGE_KEY); }
  catch { /* 忽略：清理失败不影响页面。 */ }
}

export function toStored(config: StepConfig, controls: StepControls = DEFAULT_STEP_CONTROLS): StoredStep {
  return { version: 2, controls: { ...controls }, moods: { ...config.moods }, work: { ...config.work }, boost: config.boost };
}

/** 兼容旧存档的心情与助力，但不允许旧 rooms 覆盖共享排班。 */
export function applyStored(config: StepConfig, stored: StoredStep | null): StepConfig {
  if (!stored) return config;
  return {
    rooms: config.rooms,
    moods: { ...config.moods, ...stored.moods },
    work: { ...config.work, ...stored.work },
    boost: stored.boost ? { ...stored.boost, days: stored.boost.days.map(day => ({ list: day.list.map(entry => ({ ...entry })) })) } : config.boost,
  };
}

export { storageOf as stepStorage };
