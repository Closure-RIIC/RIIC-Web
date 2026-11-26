import type {
  BaseBlueprint,
  BoxSource,
  MaaJson,
  OperBoxEntry,
  PublicPlanData,
  RotationProfile,
  UserProfile,
} from "./types";
import { stripInternalFields } from "./internal-field-safety.ts";
import { TELEMETRY_SESSION_STORAGE_KEY } from "./telemetry-contract.ts";
import { parseTrainingAdviceReport } from "./training-advice-contract.ts";
import { parseTrainingRoomSchedule } from "./training-room-contract.ts";
import { sanitizeMaaJson } from "./maa-safety.ts";
import {
  DEFAULT_CUSTOM_ROTATION,
  DEFAULT_ROTATION_PROFILE,
  ROTATION_TOPOLOGY_SHIFTS,
  decodeRotationKey,
  isRotationProfile,
  normalizeRotationProfile,
  type CustomRotation,
} from "./rotation-settings.ts";
import { normalizeRotationResult } from "./rotation-result.ts";
import { autoRotationFromKey, DEFAULT_AUTO_ROTATION_HOURS, encodeAutoRotationKey } from "./rotation-settings.ts";

/**
 * 会话存储键：与结构版本解耦，永远不变。
 * 结构版本写在数据里（`version` 字段），升级只改 `SESSION_VERSION`，不动这个键。
 */
export const SESSION_KEY = "arknights-infra-calc-session";
/** 结构版本。提升后，本地存储里版本不匹配的会话在读取时直接删除，不做迁移。 */
export const SESSION_VERSION = 6;
/**
 * 早期版本把版本号写进了键名，前缀也换过一次（`-beta-session` → `-session`）。
 * 这些历史键不在这里逐个列举，改为按特征清理：只要长得像别的代次会话键，就删掉。
 */
const SESSION_KEY_PATTERN = /^arknights-infra-calc-(?:beta-)?session(?:-v\d+)?$/;
export const RESULT_CLEAR_WARNING_DISMISSED_KEY = "arknights-infra-calc-result-clear-warning-dismissed";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CLIENT_SKLAND_ENABLED = process.env.APP_CLIENT_SKLAND_ENABLED !== "0";
const SKLAND_SOURCE_NAME = CLIENT_SKLAND_ENABLED ? "森空岛同步" : "已保存的干员数据";

export interface PersistedSessionV6 {
  version: typeof SESSION_VERSION;
  savedAt: string;
  expiresAt: string;
  presetLabel: string;
  layout: BaseBlueprint;
  operbox: OperBoxEntry[] | null;
  sourceName: string | null;
  boxSource: BoxSource;
  layoutDirty: boolean;
  layoutSource: "local" | "skland";
  localLayoutBackup: BaseBlueprint | null;
  rotationProfile: RotationProfile;
  /** 换班方式的字符串 key：named profile、自定义定时或 auto_24_12。 */
  rotationSelection?: string;
  /** 自定义二/三班时长，仅当 rotationSelection 为 "custom" 时生效。 */
  customRotation?: CustomRotation;
  fiammettaEnabled?: boolean;
  result: PublicPlanData | null;
  activeShift: number;
}

export interface SourceAwareLayoutState {
  layout: BaseBlueprint;
  layoutSource: "local" | "skland";
  localLayoutBackup: BaseBlueprint | null;
}

export function applyLocalLayoutPatch(
  state: SourceAwareLayoutState,
  patch: (layout: BaseBlueprint) => BaseBlueprint,
  fallbackLocalLayout: BaseBlueprint
): SourceAwareLayoutState {
  if (state.layoutSource === "skland") {
    return {
      layout: patch(state.layout),
      layoutSource: "skland",
      localLayoutBackup: patch(state.localLayoutBackup ?? fallbackLocalLayout),
    };
  }
  return {
    layout: patch(state.layout),
    layoutSource: "local",
    localLayoutBackup: null,
  };
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeDuration(value: unknown): number {
  const duration = Number(value);
  return Number.isFinite(duration) ? Math.max(0, duration) : 0;
}

function validLayout(value: unknown): value is BaseBlueprint {
  if (!isObject(value) || typeof value.template !== "string" || !Array.isArray(value.rooms) || !isObject(value.scenario)) {
    return false;
  }
  return value.rooms.length <= 64 && value.rooms.every((room) =>
    isObject(room)
    && typeof room.id === "string"
    && typeof room.kind === "string"
    && Number.isInteger(room.level)
  );
}

function validOperbox(value: unknown): value is OperBoxEntry[] {
  return Array.isArray(value)
    && value.length <= 1000
    && value.every((entry) =>
      isObject(entry)
      && typeof entry.id === "string"
      && typeof entry.name === "string"
      && typeof entry.own === "boolean"
    );
}

export function normalizePersistedPlanData(
  value: unknown,
  fallbackProfile: RotationProfile | string,
): PublicPlanData | null {
  if (!isObject(value)) return null;

  const profile = (value.profile ?? value.profileJson) as UserProfile | undefined;
  const maa = (value.maa ?? value.maaJson) as MaaJson | undefined;
  const rotation = value.rotation ?? value.rotationJson;
  if (!isObject(profile) || !isObject(maa) || !isObject(rotation)) return null;
  if (!Array.isArray(maa.plans) || !Array.isArray(rotation.shifts)) return null;

  let trainingAdvice: PublicPlanData["trainingAdvice"];
  if (value.trainingAdvice !== undefined) {
    try {
      trainingAdvice = parseTrainingAdviceReport(value.trainingAdvice);
    } catch {
      trainingAdvice = undefined;
    }
  }

  let trainingRoom: PublicPlanData["trainingRoom"];
  if (value.trainingRoom !== undefined) {
    try {
      trainingRoom = parseTrainingRoomSchedule(value.trainingRoom, maa);
    } catch {
      trainingRoom = undefined;
    }
  }

  return {
    profile: stripInternalFields(structuredClone(profile)),
    maa: sanitizeMaaJson(maa),
    rotation: normalizeRotationResult({
      source: rotation,
      profile,
      // 自定义时长的编码没有 named profile 语义，兜底用默认 profile。
      fallbackProfile: isRotationProfile(fallbackProfile) ? fallbackProfile : DEFAULT_ROTATION_PROFILE,
    }),
    ...(trainingRoom ? { trainingRoom } : {}),
    ...(trainingAdvice ? { trainingAdvice } : {}),
    durationMs: safeDuration(value.durationMs),
    diagnosticId:
      typeof value.diagnosticId === "string"
        ? value.diagnosticId.slice(0, 80)
        : typeof value.runId === "string"
          ? value.runId.slice(0, 80)
          : "migrated-session",
  };
}

function clampActiveShift(value: unknown, result: PublicPlanData | null): number {
  if (!Number.isInteger(value) || !result) return 0;
  const shiftCount = Math.min(result.maa.plans.length, result.rotation.shifts.length);
  return Math.max(0, Math.min(Math.max(0, shiftCount - 1), Number(value)));
}

function normalizeSession(value: unknown, now: number): PersistedSessionV6 | null {
  if (!isObject(value)) return null;
  // 结构版本必须精确匹配。旧版本可能缺少后来新增的设施（例如回收站），
  // 迁移只会把残缺布局继续带到新版本，因此这里直接判废，由调用方删除旧数据。
  if (value.version !== SESSION_VERSION) return null;
  const layout = value.layout;
  const operbox = value.operbox;
  const localLayoutBackup = value.localLayoutBackup;
  if (
    !validLayout(layout)
    || (operbox !== null && operbox !== undefined && !validOperbox(operbox))
    || (localLayoutBackup !== null && localLayoutBackup !== undefined && !validLayout(localLayoutBackup))
  ) return null;

  const savedAt = typeof value.savedAt === "string" ? Date.parse(value.savedAt) : now;
  const expiresAt = typeof value.expiresAt === "string" ? Date.parse(value.expiresAt) : savedAt + SESSION_TTL_MS;
  if (!Number.isFinite(savedAt) || !Number.isFinite(expiresAt) || expiresAt <= now) return null;

  const boxSource = value.boxSource === "skland" || value.boxSource === "maa" || value.boxSource === "sample"
    ? value.boxSource
    : "sample";
  const rawSourceName =
    typeof value.sourceName === "string" ? value.sourceName.slice(0, 80) : null;
  const hasLegacySklandIdentity = boxSource === "skland" && rawSourceName?.startsWith("skland:");
  const rotationProfile = normalizeRotationProfile(value.rotationProfile);
  const customRotation = normalizeStoredCustomRotation(value.customRotation);
  const result = hasLegacySklandIdentity ? null : normalizePersistedPlanData(value.result, rotationProfile);
  // Historical results retain their exact request identity; new automatic calculations use 24/24.
  const rotationSelection = result?.rotation.auto_rotation
    ? encodeAutoRotationKey(result.rotation.auto_rotation.timing.shift_hours)
    : normalizeRotationSelection(value.rotationSelection, rotationProfile);
  const layoutDirty = Boolean(value.layoutDirty);
  return {
    version: SESSION_VERSION,
    savedAt: new Date(savedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    presetLabel: typeof value.presetLabel === "string" ? value.presetLabel : layout.template,
    layout: structuredClone(layout),
    operbox: operbox ? structuredClone(operbox) : null,
    sourceName: boxSource === "skland" ? SKLAND_SOURCE_NAME : rawSourceName,
    boxSource,
    layoutDirty,
    layoutSource: value.layoutSource === "skland" || value.layoutSource === "local"
      ? value.layoutSource
      : boxSource === "skland" && !layoutDirty
        ? "skland"
        : "local",
    localLayoutBackup: localLayoutBackup ? structuredClone(localLayoutBackup) : null,
    rotationProfile,
    rotationSelection,
    customRotation,
    fiammettaEnabled: Boolean(value.fiammettaEnabled),
    result,
    activeShift: clampActiveShift(value.activeShift, result),
  };
}

/** 旧会话没有 rotationSelection 时，跟随已保存的 named profile。 */
function normalizeRotationSelection(value: unknown, fallback: RotationProfile): string {
  if (typeof value !== "string") return fallback;
  const decoded = decodeRotationKey(value);
  if (decoded && typeof decoded !== "string" && decoded.topology === "auto") return encodeAutoRotationKey(DEFAULT_AUTO_ROTATION_HOURS);
  return decoded || autoRotationFromKey(value) ? value : fallback;
}

/** 自定义时长只接受形状与班次数合法的记录；否则退回默认值。 */
function normalizeStoredCustomRotation(value: unknown): CustomRotation {
  if (!isObject(value)) return DEFAULT_CUSTOM_ROTATION;
  const topology = value.topology === "main_backup" || value.topology === "abc" ? value.topology : null;
  if (!topology) return DEFAULT_CUSTOM_ROTATION;
  const hours = Array.isArray(value.hours) ? value.hours : null;
  if (!hours || hours.length !== ROTATION_TOPOLOGY_SHIFTS[topology]) return DEFAULT_CUSTOM_ROTATION;
  if (!hours.every((hour) => typeof hour === "number" && Number.isInteger(hour) && hour > 0)) {
    return DEFAULT_CUSTOM_ROTATION;
  }
  return { topology, hours: [...hours] };
}

export function loadPersistedSession(storage: StorageLike, now = Date.now()): PersistedSessionV6 | null {
  const currentRaw = storage.getItem(SESSION_KEY);
  const current = normalizeSession(parseJson(currentRaw), now);
  if (current) {
    if (currentRaw && currentRaw !== JSON.stringify(current)) {
      try { storage.setItem(SESSION_KEY, JSON.stringify(current)); } catch {
        // Reading valid data must not depend on storage being writable.
      }
    }
    removeObsoleteSessions(storage);
    return current;
  }
  // 版本不匹配、过期或损坏的会话不迁移，直接删除：既避免把残缺布局带进新版本，
  // 也让本地始终只保留一份当前格式的会话，不会历史代次叠加占用额度。
  if (currentRaw) storage.removeItem(SESSION_KEY);
  removeObsoleteSessions(storage);
  return null;
}

/**
 * 删掉所有「其他代次」的会话键，只保留当前的 `SESSION_KEY`。
 * 需要存储实现提供 `length` / `key(i)`（浏览器 localStorage 本身就有）；没有就跳过清理，
 * 版本校验仍然会让旧数据失效，只是无法顺带回收空间。
 */
function removeObsoleteSessions(storage: StorageLike): void {
  const enumerable = storage as StorageLike & Partial<Pick<Storage, "length" | "key">>;
  if (typeof enumerable.length !== "number" || typeof enumerable.key !== "function") return;
  const obsolete: string[] = [];
  for (let index = 0; index < enumerable.length; index += 1) {
    const key = enumerable.key(index);
    if (key && key !== SESSION_KEY && SESSION_KEY_PATTERN.test(key)) obsolete.push(key);
  }
  // 先收集再删除：removeItem 会让后续索引整体前移。
  for (const key of obsolete) storage.removeItem(key);
}

export function persistSession(
  storage: StorageLike,
  input: Omit<PersistedSessionV6, "version" | "savedAt" | "expiresAt" | "localLayoutBackup"> & {
    localLayoutBackup?: BaseBlueprint | null;
  },
  now = Date.now()
): PersistedSessionV6 {
  const hasLegacySklandIdentity =
    input.boxSource === "skland" && input.sourceName?.startsWith("skland:");
  const result = hasLegacySklandIdentity ? null : normalizePersistedPlanData(input.result, input.rotationProfile);
  const value: PersistedSessionV6 = {
    ...input,
    localLayoutBackup: input.localLayoutBackup ? structuredClone(input.localLayoutBackup) : null,
    sourceName: input.boxSource === "skland" ? SKLAND_SOURCE_NAME : input.sourceName,
    version: SESSION_VERSION,
    savedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    result,
    activeShift: clampActiveShift(input.activeShift, result),
  };
  storage.setItem(SESSION_KEY, JSON.stringify(value));
  removeObsoleteSessions(storage);
  return value;
}

export function clearLocalProductData(storage: StorageLike, extraKeys: string[] = []): void {
  storage.removeItem(SESSION_KEY);
  removeObsoleteSessions(storage);
  [RESULT_CLEAR_WARNING_DISMISSED_KEY, TELEMETRY_SESSION_STORAGE_KEY, ...extraKeys]
    .forEach((key) => storage.removeItem(key));
}
