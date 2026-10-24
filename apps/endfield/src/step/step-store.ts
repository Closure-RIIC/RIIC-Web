import type { StepBoostConfig, StepConfig, StepRoomKey } from "./step-types.ts";
import { clampHour } from "./step-model.ts";
import { STEP_STORAGE_KEY } from "./step-keys.ts";

/** 步进页专属配置；名单与换班时刻每次都从 Workspace 重新导入，不在这里保存。 */
export { STEP_STORAGE_KEY };

export interface StoredStepRoom {
  enabled?: boolean;
  hour?: number;
}

export interface StoredStep {
  version: 1;
  rooms: Record<string, StoredStepRoom>;
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

function sanitizeRooms(value: unknown): Record<string, StoredStepRoom> {
  if (!isRecord(value)) return {};
  const rooms: Record<string, StoredStepRoom> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    const room: StoredStepRoom = {};
    if (typeof entry.enabled === "boolean") room.enabled = entry.enabled;
    if (typeof entry.hour === "number" && Number.isFinite(entry.hour)) room.hour = Math.min(23, Math.max(1, Math.round(entry.hour)));
    rooms[key] = room;
  }
  return rooms;
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
    if (!isRecord(value) || value.version !== 1) return null;
    return {
      version: 1,
      rooms: sanitizeRooms(value.rooms),
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

export function toStored(config: StepConfig): StoredStep {
  const rooms: Record<string, StoredStepRoom> = {};
  for (const room of config.rooms) rooms[room.key] = { enabled: room.enabled, hour: room.hour };
  return { version: 1, rooms, moods: { ...config.moods }, work: { ...config.work }, boost: config.boost };
}

/** 把持久化的“模拟专属”字段盖到刚导入的配置上；局内名单始终以 Workspace 为准。 */
export function applyStored(config: StepConfig, stored: StoredStep | null): StepConfig {
  if (!stored) return config;
  const rooms = config.rooms.map(room => {
    const saved = stored.rooms[room.key as StepRoomKey];
    if (!saved) return room;
    return {
      ...room,
      enabled: typeof saved.enabled === "boolean" ? saved.enabled : room.enabled,
      hour: typeof saved.hour === "number" ? clampHour(saved.hour, room.hour) : room.hour,
    };
  });
  return {
    rooms,
    moods: { ...config.moods, ...stored.moods },
    work: { ...config.work, ...stored.work },
    boost: stored.boost ? { ...stored.boost, days: stored.boost.days.map(day => ({ list: day.list.map(entry => ({ ...entry })) })) } : config.boost,
  };
}

export { storageOf as stepStorage };
