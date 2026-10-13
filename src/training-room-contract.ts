import type {
  MaaJson,
  MaaOperatorSlot,
  MaaRoom,
  TrainingRoomSchedule,
  TrainingRoomShift,
} from "./types.ts";

const TRAINING_ROOM_SCHEMA_VERSION = 1;
const MAX_OPERATOR_NAME_LENGTH = 80;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeOperatorName(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`${path} 必须是字符串或 null。`);
  }
  const normalized = value.trim();
  if (!normalized) throw new Error(`${path} 不能为空。`);
  if ([...normalized].length > MAX_OPERATOR_NAME_LENGTH) {
    throw new Error(`${path} 不能超过 ${MAX_OPERATOR_NAME_LENGTH} 个字符。`);
  }
  return normalized;
}

function maaOperatorName(value: string | MaaOperatorSlot | null): string | null {
  if (typeof value === "string") return value.trim() || null;
  return value?.name?.trim() || null;
}

function maaPlanOperatorNames(plan: MaaJson["plans"][number]): Set<string> {
  const names = new Set<string>();
  if (!isRecord(plan.rooms)) return names;

  for (const rooms of Object.values(plan.rooms)) {
    if (!Array.isArray(rooms)) continue;
    for (const room of rooms as MaaRoom[]) {
      if (!Array.isArray(room?.operators)) continue;
      for (const value of room.operators) {
        const name = maaOperatorName(value);
        if (name) names.add(name);
      }
    }
  }
  return names;
}

function parseShift(value: unknown, index: number, maaNames: Set<string>): TrainingRoomShift {
  const path = `training_room.shifts[${index}]`;
  if (!isRecord(value)) throw new Error(`${path} 必须是对象。`);
  if (!("trainee" in value) || !("trainer" in value)) {
    throw new Error(`${path} 必须同时提供 trainee 与 trainer。`);
  }

  const trainee = normalizeOperatorName(value.trainee, `${path}.trainee`);
  const trainer = normalizeOperatorName(value.trainer, `${path}.trainer`);
  if (trainee && trainer && trainee === trainer) {
    throw new Error(`${path} 的训练位和协助位不能使用同一干员。`);
  }
  for (const [position, name] of [["trainee", trainee], ["trainer", trainer]] as const) {
    if (name && maaNames.has(name)) {
      throw new Error(`${path}.${position} 的干员 ${name} 已在该班 MAA 房间中进驻。`);
    }
  }
  return { trainee, trainer };
}

export function parseTrainingRoomSchedule(value: unknown, maa: MaaJson): TrainingRoomSchedule {
  if (!isRecord(value)) throw new Error("training_room 必须是对象。");
  if (value.schema_version !== TRAINING_ROOM_SCHEMA_VERSION) {
    throw new Error(`training_room.schema_version 应为 ${TRAINING_ROOM_SCHEMA_VERSION}。`);
  }
  if (!Array.isArray(value.shifts)) throw new Error("training_room.shifts 必须是数组。");
  if (!Array.isArray(maa.plans)) throw new Error("maa.plans 必须是数组。");
  if (value.shifts.length !== maa.plans.length) {
    throw new Error("training_room.shifts 数量必须与 maa.plans 一致。");
  }

  return {
    schema_version: TRAINING_ROOM_SCHEMA_VERSION,
    shifts: value.shifts.map((shift, index) => (
      parseShift(shift, index, maaPlanOperatorNames(maa.plans[index]!))
    )),
  };
}
