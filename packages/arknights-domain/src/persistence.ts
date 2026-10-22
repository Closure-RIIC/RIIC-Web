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
import { normalizeRotationProfile } from "./rotation-settings.ts";
import { normalizeRotationResult } from "./rotation-result.ts";

export const SESSION_KEY_V4 = "arknights-infra-calc-session-v4";
export const SESSION_KEY_V5 = "arknights-infra-calc-session-v5";
export const SESSION_KEY_V3 = "arknights-infra-calc-beta-session-v3";
export const SESSION_KEY_V2 = "arknights-infra-calc-beta-session-v2";
export const RESULT_CLEAR_WARNING_DISMISSED_KEY = "arknights-infra-calc-result-clear-warning-dismissed";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CLIENT_SKLAND_ENABLED = process.env.APP_CLIENT_SKLAND_ENABLED !== "0";
const SKLAND_SOURCE_NAME = CLIENT_SKLAND_ENABLED ? "森空岛同步" : "已保存的干员数据";

export interface PersistedSessionV5 {
  version: 5;
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

export function normalizePersistedPlanData(value: unknown, fallbackProfile: RotationProfile): PublicPlanData | null {
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
      fallbackProfile,
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

function normalizeSession(value: unknown, now: number): PersistedSessionV5 | null {
  if (!isObject(value)) return null;
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
    typeof value.sourceName === "string"
      ? value.sourceName.slice(0, 80)
      : typeof value.fileName === "string"
        ? value.fileName.slice(0, 80)
        : null;
  const hasLegacySklandIdentity = boxSource === "skland" && rawSourceName?.startsWith("skland:");
  const rotationProfile = normalizeRotationProfile(value.rotationProfile);
  const result = hasLegacySklandIdentity ? null : normalizePersistedPlanData(value.result, rotationProfile);
  const layoutDirty = Boolean(value.layoutDirty);
  return {
    version: 5,
    savedAt: new Date(savedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    presetLabel:
      typeof value.presetLabel === "string"
        ? value.presetLabel
        : isObject(value.preset) && typeof value.preset.label === "string"
          ? value.preset.label
          : layout.template,
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
    fiammettaEnabled: Boolean(value.fiammettaEnabled),
    result,
    activeShift: clampActiveShift(value.activeShift, result),
  };
}

export function loadPersistedSession(storage: StorageLike, now = Date.now()): PersistedSessionV5 | null {
  const currentRaw = storage.getItem(SESSION_KEY_V5);
  const current = normalizeSession(parseJson(currentRaw), now);
  if (current) {
    if (currentRaw && currentRaw !== JSON.stringify(current)) {
      try { storage.setItem(SESSION_KEY_V5, JSON.stringify(current)); } catch {
        // Reading valid data must not depend on storage being writable.
      }
    }
    return current;
  }
  if (currentRaw) storage.removeItem(SESSION_KEY_V5);

  for (const legacyKey of [SESSION_KEY_V4, SESSION_KEY_V3, SESSION_KEY_V2]) {
    const legacyRaw = storage.getItem(legacyKey);
    if (!legacyRaw) continue;
    const migrated = normalizeSession(parseJson(legacyRaw), now);
    if (!migrated) {
      storage.removeItem(legacyKey);
      continue;
    }
    try {
      storage.setItem(SESSION_KEY_V5, JSON.stringify(migrated));
      storage.removeItem(legacyKey);
    } catch {
      // Keep the original and restore in memory; normal autosave reports write failures.
    }
    return migrated;
  }
  return null;
}

export function persistSession(
  storage: StorageLike,
  input: Omit<PersistedSessionV5, "version" | "savedAt" | "expiresAt" | "localLayoutBackup"> & {
    localLayoutBackup?: BaseBlueprint | null;
  },
  now = Date.now()
): PersistedSessionV5 {
  const hasLegacySklandIdentity =
    input.boxSource === "skland" && input.sourceName?.startsWith("skland:");
  const result = hasLegacySklandIdentity ? null : normalizePersistedPlanData(input.result, input.rotationProfile);
  const value: PersistedSessionV5 = {
    ...input,
    localLayoutBackup: input.localLayoutBackup ? structuredClone(input.localLayoutBackup) : null,
    sourceName: input.boxSource === "skland" ? SKLAND_SOURCE_NAME : input.sourceName,
    version: 5,
    savedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    result,
    activeShift: clampActiveShift(input.activeShift, result),
  };
  storage.setItem(SESSION_KEY_V5, JSON.stringify(value));
  storage.removeItem(SESSION_KEY_V4);
  storage.removeItem(SESSION_KEY_V3);
  storage.removeItem(SESSION_KEY_V2);
  return value;
}

export function clearLocalProductData(storage: StorageLike, extraKeys: string[] = []): void {
  [
    SESSION_KEY_V2,
    SESSION_KEY_V3,
    SESSION_KEY_V4,
    SESSION_KEY_V5,
    RESULT_CLEAR_WARNING_DISMISSED_KEY,
    TELEMETRY_SESSION_STORAGE_KEY,
    ...extraKeys,
  ].forEach((key) => storage.removeItem(key));
}
