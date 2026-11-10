import type { RoomEfficiency, RoomKind } from "./types.ts";

export type AutoRotationHours = [number, number];

export interface AutoRotationState {
  operators: string[];
  evaluationHours: number;
  missingSeats: number;
  complete: boolean;
  /** Decimal efficiency where 1 is 100%, matching the solver wire value. */
  productionEfficiency?: number;
  /** Evaluated breakdown, in the same units as timed-plan room lines. */
  efficiency?: RoomEfficiency;
  /** Static queue's evaluated output per 24h; gold is value, records are EXP, originium is shards. */
  productionPerDay?: number;
  /** Decimal efficiency where 1 is 100%, matching the solver wire value. */
  powerChargeEfficiency?: number;
  /** Percentage points, matching the solver wire value. */
  supportSpeedBonusPct?: number;
  /** Decimal efficiency where 1 is 100%, matching the solver wire value. */
  recycleEfficiency?: number;
  firstRedFace?: string;
}

export interface AutoRotationRoom {
  roomId: string;
  kind: RoomKind;
  main: AutoRotationState;
  backup: AutoRotationState;
}

export interface AutoRotationResult {
  mode: "auto";
  hours: AutoRotationHours;
  complete: boolean;
  rooms: AutoRotationRoom[];
  dormSupport: Array<{ roomId: string; operators: string[] }>;
  fiammetta: {
    enabled: boolean;
    available: boolean;
    targets: Array<{ target: string; roomId: string }>;
  } | null;
  warnings: string[];
  durationMs: number;
  diagnosticId: string;
}

export const DEFAULT_AUTO_ROTATION_HOURS: AutoRotationHours = [32, 32];

function isAutoRotationHour(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 1 / 60;
}

export function isAutoRotationHours(value: unknown): value is AutoRotationHours {
  return Array.isArray(value)
    && value.length === 2
    && isAutoRotationHour(value[0])
    && isAutoRotationHour(value[1]);
}

export function encodeAutoRotationKey(hours: AutoRotationHours): string {
  if (!isAutoRotationHours(hours)) throw new TypeError("Invalid automatic rotation hours.");
  return `auto_${hours[0]}_${hours[1]}`;
}

export function autoRotationFromKey(value: string): AutoRotationHours | null {
  const match = /^auto_([^_]+)_([^_]+)$/.exec(value);
  if (!match) return null;
  const hours: AutoRotationHours = [Number(match[1]), Number(match[2])];
  return isAutoRotationHours(hours) ? hours : null;
}
