import type { CaseSummaryV1, RotationProfileName, ShiftSummary, RoomLineSummary } from "./types.ts";

type JsonRecord = Record<string, unknown>;

function isObject(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function extractSummaryV1(payload: {
  profile: JsonRecord;
  rotation: JsonRecord;
  maa: JsonRecord;
}): CaseSummaryV1 {
  const daily = isObject(payload.rotation.daily) ? payload.rotation.daily : {};
  const profileRotation = isObject(payload.profile.rotation) ? payload.profile.rotation : {};

  const trade = finiteNumber(
    daily.trade
    ?? payload.rotation.daily_trade_efficiency
    ?? profileRotation.daily_trade_efficiency
    ?? profileRotation.daily_trade
  );
  const manu = finiteNumber(
    daily.manufacture
    ?? daily.manu
    ?? payload.rotation.daily_manufacture_efficiency
    ?? profileRotation.daily_manufacture_efficiency
    ?? profileRotation.daily_manu
  );
  const power = finiteNumber(
    daily.power
    ?? payload.rotation.daily_power_efficiency
    ?? profileRotation.daily_power_efficiency
    ?? profileRotation.daily_power
  );

  const warnings = nullableStringArray(payload.rotation.warnings);
  const shifts = Array.isArray(payload.rotation.shifts)
    ? payload.rotation.shifts.map((shift, index) => summarizeShift(shift, index))
    : [];

  return {
    schema_version: 1,
    daily: { trade, manu, power },
    warnings,
    shifts,
  };
}

function summarizeShift(shift: unknown, index: number): ShiftSummary {
  const record = isObject(shift) ? shift : {};
  const efficiencies = isObject(record.efficiencies) ? record.efficiencies : {};
  const scores = isObject(record.scores) ? record.scores : {};
  const roomLines = Array.isArray(efficiencies.room_lines)
    ? efficiencies.room_lines
    : Array.isArray(scores.room_lines)
      ? scores.room_lines
      : [];

  const durationHours =
    finiteNumber(record.duration_hours) && finiteNumber(record.duration_hours)! > 0
      ? finiteNumber(record.duration_hours)
      : index === 0
        ? 12
        : 6;

  return {
    index: Number.isInteger(record.index) ? Number(record.index) : index,
    duration_hours: durationHours ?? 6,
    active_teams: nullableStringArray(record.active_teams),
    resting_team: typeof record.resting_team === "string" ? record.resting_team : "",
    trade: finiteNumber(scores.trade_score) ?? finiteNumber(efficiencies.trade_efficiency),
    manu: finiteNumber(scores.manu_prod_sum)
      ?? (finiteNumber(efficiencies.manufacture_efficiency) !== null
        ? finiteNumber(efficiencies.manufacture_efficiency)! * 100
        : null),
    power: finiteNumber(scores.power_charge_sum)
      ?? (finiteNumber(efficiencies.power_efficiency) !== null
        ? finiteNumber(efficiencies.power_efficiency)! * 100
        : null),
    room_lines: roomLines.map(summarizeRoomLine),
  };
}

function summarizeRoomLine(line: unknown): RoomLineSummary {
  const record = isObject(line) ? line : {};
  return {
    room_id: typeof record.room_id === "string" ? record.room_id : "",
    operator_count: finiteNumber(record.operator_count),
    trade: finiteNumber(record.trade_efficiency) ?? finiteNumber(record.trade_score) ?? null,
    manu: finiteNumber(record.manufacture_efficiency) ?? finiteNumber(record.manu_score) ?? null,
    power: finiteNumber(record.power_efficiency) ?? finiteNumber(record.power_score) ?? null,
  };
}

export function extractMaaRoomOperators(maa: JsonRecord, shiftIndex: number): Record<string, string[]> {
  const plans = Array.isArray(maa.plans) ? maa.plans : [];
  const plan = isObject(plans[shiftIndex]) ? plans[shiftIndex] : {};
  const rooms = isObject(plan.rooms) ? plan.rooms : {};
  const result: Record<string, string[]> = {};

  const roomKinds = [
    "trading",
    "manufacture",
    "power",
    "control",
    "dormitory",
    "meeting",
    "hire",
    "processing",
  ];

  for (const kind of roomKinds) {
    const entries = Array.isArray(rooms[kind]) ? rooms[kind] : [];
    for (const [index, room] of entries.entries()) {
      const roomRecord = isObject(room) ? room : {};
      const operators = Array.isArray(roomRecord.operators)
        ? roomRecord.operators
            .map((op) => {
              if (typeof op === "string") return op;
              if (isObject(op) && typeof op.name === "string") return op.name;
              return null;
            })
            .filter((name): name is string => Boolean(name))
        : [];
      result[`${kind}[${index}]`] = operators;
    }
  }

  return result;
}

export function rotationProfileName(value: unknown): RotationProfileName {
  return value === "main_backup_12_12" || value === "fiammetta_8_8_4_4" || value === "abyssal_7_5_7_5"
    ? (value as RotationProfileName)
    : "abc_12_6_6";
}

export function describeSummaryDelta(a: CaseSummaryV1 | null, b: CaseSummaryV1 | null) {
  const dailyDelta = {
    trade: delta(a?.daily.trade ?? null, b?.daily.trade ?? null),
    manu: delta(a?.daily.manu ?? null, b?.daily.manu ?? null),
    power: delta(a?.daily.power ?? null, b?.daily.power ?? null),
  };
  return dailyDelta;
}

function delta(left: number | null, right: number | null): number | null {
  if (left === null || right === null) return null;
  return Math.round((right - left) * 1000) / 1000;
}
