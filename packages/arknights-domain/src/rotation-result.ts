import { normalizeServeRoomEfficiency } from "./efficiency.ts";
import { isRotationProfile, rotationOption } from "./rotation-settings.ts";
import type {
  RoomEfficiency,
  RotationJson,
  RotationProfile,
  RotationRoomLine,
  RotationShift,
  UserProfile,
} from "./types.ts";

type JsonRecord = Record<string, unknown>;

const ROOM_EFFICIENCY_FIELDS = [
  "final_efficiency",
  "gold_equivalent_efficiency",
  "trade_score",
  "trade_pct",
  "trade_skill_pct",
  "trade_display_pct",
  "trade_gold_pct",
  "manu_score",
  "manu_prod_total",
  "manu_prod_skill",
  "manu_display_pct",
  "manu_storage_limit",
  "power_score",
  "power_skill_pct",
  "power_display_pct",
  "power_charge_speed_pct",
] as const satisfies readonly (keyof RoomEfficiency)[];

function isObject(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nullableNumber(value: unknown): number | null {
  return finiteNumber(value) ?? null;
}

function normalizedDailyProduction(value: unknown): RotationJson["daily"]["production"] | undefined {
  if (!isObject(value)) return undefined;
  const lmd = finiteNumber(value.lmd);
  const pureGold = finiteNumber(value.pure_gold);
  const battleRecords = finiteNumber(value.battle_records);
  const originiumShards = finiteNumber(value.originium_shards);
  const orundum = finiteNumber(value.orundum);
  const equivalentGold = finiteNumber(value.equivalent_gold);
  if (
    lmd === undefined || lmd < 0
    || pureGold === undefined || pureGold < 0
    || battleRecords === undefined || battleRecords < 0
    || originiumShards === undefined || originiumShards < 0
    || orundum === undefined || orundum < 0
  ) return undefined;
  return {
    lmd,
    pure_gold: pureGold,
    battle_records: battleRecords,
    originium_shards: originiumShards,
    orundum,
    ...(equivalentGold !== undefined && equivalentGold >= 0 ? { equivalent_gold: equivalentGold } : {}),
  };
}

function normalizedDroneProduction(value: unknown): RotationJson["daily"]["drone_production"] | undefined {
  if (!isObject(value)) return undefined;
  const lmd = finiteNumber(value.lmd);
  const pureGold = finiteNumber(value.pure_gold);
  const battleRecords = finiteNumber(value.battle_records);
  if (lmd === undefined || lmd < 0 || pureGold === undefined || pureGold < 0 || battleRecords === undefined || battleRecords < 0) return undefined;
  return { lmd, pure_gold: pureGold, battle_records: battleRecords };
}

function normalizedRoomLine(value: unknown): RotationRoomLine {
  if (!isObject(value)) return { room_id: "" };

  const usesWorkerFields = [
    "total_efficiency",
    "order_multiplier",
    "base_efficiency",
    "equivalent_efficiency",
    "gold_equivalent_efficiency",
    "global_efficiency",
    "trade_equivalent_efficiency",
    "trade_efficiency",
    "trade_skill_efficiency",
    "trade_display_efficiency",
    "manufacture_efficiency",
    "manufacture_skill_efficiency",
    "manufacture_display_efficiency",
    "power_efficiency",
    "power_skill_efficiency",
    "power_display_efficiency",
  ].some((field) => field in value);
  if (usesWorkerFields) {
    const normalized = normalizeServeRoomEfficiency(value) as unknown as Record<string, unknown>;
    // 幂等：行可能已被归一化过一次（worker 字段已转成 score/pct 旧字段），
    // 二次归一化时把这些旧字段原样保留，避免把 power_skill_pct / trade_skill_pct /
    // manu_prod_skill / power_score 等吞掉。
    for (const field of ROOM_EFFICIENCY_FIELDS) {
      const number = finiteNumber(value[field]);
      if (number !== undefined) (normalized as Record<string, unknown>)[field] = number;
    }
    return normalized as unknown as RotationRoomLine;
  }

  const line: RotationRoomLine = {
    room_id: typeof value.room_id === "string" ? value.room_id : "",
  };
  for (const field of ROOM_EFFICIENCY_FIELDS) {
    const number = finiteNumber(value[field]);
    if (number !== undefined) line[field] = number;
  }
  if (line.final_efficiency === undefined) {
    const tradeBonus = finiteNumber(value.trade_pct) ?? finiteNumber(value.trade_display_pct);
    const manufactureScore = finiteNumber(value.manu_score);
    const manufactureBonus = finiteNumber(value.manu_prod_total);
    const powerScore = finiteNumber(value.power_score);
    const powerBonus = finiteNumber(value.power_charge_speed_pct) ?? finiteNumber(value.power_display_pct);
    const migratedFinal = finiteNumber(value.trade_score)
      ?? (tradeBonus !== undefined ? 1 + tradeBonus / 100 : undefined)
      ?? (manufactureScore !== undefined ? manufactureScore / 100 : undefined)
      ?? (manufactureBonus !== undefined ? 1 + manufactureBonus / 100 : undefined)
      ?? (powerScore !== undefined ? powerScore / 100 : undefined)
      ?? (powerBonus !== undefined ? 1 + powerBonus / 100 : undefined);
    if (migratedFinal !== undefined) line.final_efficiency = migratedFinal;
  }
  return line;
}

function normalizedShift(value: unknown, fallbackIndex: number, fallbackDuration: number): RotationShift {
  const shift = isObject(value) ? value : {};
  const efficiencies = isObject(shift.efficiencies) ? shift.efficiencies : {};
  const scores = isObject(shift.scores) ? shift.scores : {};
  const roomLines = Array.isArray(efficiencies.room_lines)
    ? efficiencies.room_lines
    : Array.isArray(scores.room_lines)
      ? scores.room_lines
      : [];
  const durationHours = finiteNumber(shift.duration_hours);

  return {
    index: Number.isInteger(shift.index) && Number(shift.index) >= 0 ? Number(shift.index) : fallbackIndex,
    duration_hours: durationHours !== undefined && durationHours > 0
      ? durationHours
      : fallbackDuration,
    active_teams: Array.isArray(shift.active_teams)
      ? shift.active_teams.filter((team): team is string => typeof team === "string")
      : [],
    resting_team: typeof shift.resting_team === "string" ? shift.resting_team : "",
    scores: {
      trade_score: finiteNumber(scores.trade_score) ?? finiteNumber(efficiencies.trade_efficiency) ?? 0,
      manu_prod_sum: finiteNumber(scores.manu_prod_sum)
        ?? (finiteNumber(efficiencies.manufacture_efficiency) ?? 0) * 100,
      power_charge_sum: finiteNumber(scores.power_charge_sum)
        ?? (finiteNumber(efficiencies.power_efficiency) ?? 0) * 100,
      room_lines: roomLines.map(normalizedRoomLine),
    },
    weighted_trade: finiteNumber(shift.weighted_trade) ?? 0,
    weighted_manu: finiteNumber(shift.weighted_manu) ?? finiteNumber(shift.weighted_manufacture) ?? 0,
    weighted_power: finiteNumber(shift.weighted_power) ?? 0,
  };
}

function profileRotation(profile: unknown): JsonRecord {
  return isObject(profile) && isObject(profile.rotation) ? profile.rotation : {};
}

export function normalizeRotationResult({
  source,
  shifts,
  profile,
  fallbackProfile,
}: {
  source: unknown;
  shifts?: unknown[];
  profile?: unknown;
  fallbackProfile: RotationProfile;
}): RotationJson {
  const rotation = isObject(source) ? source : {};
  const daily = isObject(rotation.daily) ? rotation.daily : {};
  const profileDaily = profileRotation(profile);
  const rotationProfile = isRotationProfile(rotation.profile)
    ? rotation.profile
    : isRotationProfile(rotation.rotation)
      ? rotation.rotation
      : isObject(profile) && isRotationProfile(profile.rotation_profile)
        ? profile.rotation_profile
        : fallbackProfile;
  const rawShifts = shifts ?? (Array.isArray(rotation.shifts) ? rotation.shifts : []);
  const fallbackDurations = rotationOption(rotationProfile).durations;
  const production = normalizedDailyProduction(daily.production);
  const droneProduction = normalizedDroneProduction(daily.drone_production);

  return {
    profile: rotationProfile,
    shifts: rawShifts.map((shift, index) => normalizedShift(
      shift,
      index,
      fallbackDurations[index] ?? (index === 0 ? 12 : 6)
    )),
    daily: {
      trade: nullableNumber(
        daily.trade
        ?? rotation.daily_trade_efficiency
        ?? profileDaily.daily_trade_efficiency
        ?? profileDaily.daily_trade
      ),
      manufacture: nullableNumber(
        daily.manufacture
        ?? daily.manu
        ?? rotation.daily_manufacture_efficiency
        ?? profileDaily.daily_manufacture_efficiency
        ?? profileDaily.daily_manu
      ),
      power: nullableNumber(
        daily.power
        ?? rotation.daily_power_efficiency
        ?? profileDaily.daily_power_efficiency
        ?? profileDaily.daily_power
      ),
      ...(production ? { production } : {}),
      ...(droneProduction ? { drone_production: droneProduction } : {}),
    },
  };
}

export function rotationFallbackProfile(profile: UserProfile | undefined, fallback: RotationProfile): RotationProfile {
  return isRotationProfile(profile?.rotation_profile) ? profile.rotation_profile : fallback;
}
