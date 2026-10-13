import type {
  BaseBlueprint,
  BlueprintRoom,
  MaaJson,
  MaaOperatorSlot,
  MaaPeriod,
  MaaRoom,
  MaaRooms,
  OperBoxEntry,
  RoomKind,
  TrainingRoomShift,
} from "./types.ts";
import {
  DEFAULT_MANUAL_SHIFT_DURATIONS,
  DEFAULT_MANUAL_SHIFT_START_TIME,
  MANUAL_SCHEDULE_STORAGE_KEY,
  MAX_MANUAL_SHIFT_COUNT,
  MIN_MANUAL_SHIFT_COUNT,
} from "./manual-schedule-config.ts";
import { factoryRecipeFromMaaProduct, normalizeProductForLevel } from "./factory-recipes.ts";
import { droneTargetShiftIndex } from "./drone-plan-mapping.ts";
import { manualEditableRooms, type EditableRoom } from "./recycling-room.ts";

export {
  DEFAULT_MANUAL_SHIFT_DURATIONS,
  DEFAULT_MANUAL_SHIFT_START_TIME,
  MANUAL_SCHEDULE_STORAGE_KEY,
  MAX_MANUAL_SHIFT_COUNT,
  MIN_MANUAL_SHIFT_COUNT,
} from "./manual-schedule-config.ts";

export interface ManualRoomAssignment {
  operators: Array<string | null>;
  autofill?: boolean;
  /** User-entered paper skill efficiency in percentage points, per shift and room. */
  manualSkillEfficiencyPct?: number;
}

export interface ManualShift {
  durationHours: number;
  rooms: Record<string, ManualRoomAssignment>;
  fiammettaTarget: string | null;
  droneTargetRoomId: string | null;
}

export interface ManualScheduleSource {
  kind: "calculator";
  variant: "baseline" | "progression-adjusted";
  createdAt: string;
}

export interface ManualScheduleDraft {
  version: 3;
  scheduleMode: ManualScheduleMode;
  externalOperatorNames: string[];
  startTime: string;
  activeShift: number;
  fiammettaEnabled: boolean;
  shifts: ManualShift[];
  source?: ManualScheduleSource;
}

export type ManualScheduleMode = "sequential" | "period";

export interface ManualOperatorConflict {
  roomId: string;
  slotIndex: number;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const MAA_GROUP_BY_ROOM_KIND: Partial<Record<RoomKind, keyof MaaRooms>> = {
  control_center: "control",
  trade_post: "trading",
  factory: "manufacture",
  power_plant: "power",
  dormitory: "dormitory",
  office: "hire",
  meeting_room: "meeting",
  workshop: "processing",
};

const MINUTES_PER_DAY = 24 * 60;

const IMPORTED_LAYOUT_GROUPS: ReadonlyArray<{
  group: keyof MaaRooms;
  kind: RoomKind;
  idPrefix: string;
  level: number;
}> = [
  { group: "control", kind: "control_center", idPrefix: "control", level: 5 },
  { group: "trading", kind: "trade_post", idPrefix: "trade", level: 3 },
  { group: "manufacture", kind: "factory", idPrefix: "manu", level: 3 },
  { group: "power", kind: "power_plant", idPrefix: "power", level: 3 },
  { group: "dormitory", kind: "dormitory", idPrefix: "dorm", level: 5 },
  { group: "meeting", kind: "meeting_room", idPrefix: "meeting", level: 3 },
  { group: "hire", kind: "office", idPrefix: "office", level: 3 },
  { group: "processing", kind: "workshop", idPrefix: "workshop", level: 3 },
];

function importedRoomProduct(
  maa: MaaJson,
  group: keyof MaaRooms,
  kind: RoomKind,
  roomIndex: number,
): BlueprintRoom["product"] | undefined {
  for (const plan of maa.plans) {
    const product = plan.rooms[group]?.[roomIndex]?.product;
    if (typeof product !== "string") continue;
    if (kind === "factory") {
      const recipe = product === "all" ? "all" : factoryRecipeFromMaaProduct(product);
      if (recipe) return { factory: { recipe } };
    }
    if (kind === "trade_post") {
      if (["LMD", "Gold", "gold", "龙门商法"].includes(product)) return { trade: { order: "gold" } };
      if (["Orundum", "Originium Shard", "originium", "开采协力"].includes(product)) return { trade: { order: "originium" } };
    }
  }
  return undefined;
}

export interface ManualShiftTimeRange {
  startTime: string;
  endTime: string;
  durationMinutes: number;
}

function parseTime(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours! < 0 || hours! > 23 || minutes! < 0 || minutes! > 59) return null;
  return hours! * 60 + minutes!;
}

function formatTime(totalMinutes: number): string {
  const normalized = ((Math.round(totalMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function normalizedDurationMinutes(durations: readonly number[]): number[] {
  const source = durations.length ? durations : DEFAULT_MANUAL_SHIFT_DURATIONS;
  const minutes = source.slice(0, MAX_MANUAL_SHIFT_COUNT).map((duration) => (
    Math.max(1, Math.round(finitePositive(duration, 1) * 60))
  ));
  if (minutes.length === 1) return [MINUTES_PER_DAY];
  const total = minutes.reduce((sum, duration) => sum + duration, 0);
  if (total === MINUTES_PER_DAY) return minutes;
  if (total < MINUTES_PER_DAY) {
    minutes[minutes.length - 1] = minutes[minutes.length - 1]! + MINUTES_PER_DAY - total;
    return minutes;
  }
  const available = MINUTES_PER_DAY - minutes.length;
  const scaled = minutes.map((duration) => 1 + Math.floor(duration / total * available));
  let remainder = MINUTES_PER_DAY - scaled.reduce((sum, duration) => sum + duration, 0);
  for (let index = 0; remainder > 0; index = (index + 1) % scaled.length) {
    scaled[index] = scaled[index]! + 1;
    remainder -= 1;
  }
  return scaled;
}

export function normalizeManualShiftDurations(durations: readonly number[]): number[] {
  return normalizedDurationMinutes(durations).map((minutes) => minutes / 60);
}

/** Quantize an explicitly edited timeline, retaining one hour for every shift. */
export function snapManualShiftDurationsToHours(durations: readonly number[]): number[] {
  const minutes = normalizedDurationMinutes(durations);
  let elapsed = 0;
  let previous = 0;
  return minutes.map((duration, index) => {
    elapsed += duration;
    const boundary = index === minutes.length - 1 ? 24
      : Math.max(previous + 1, Math.min(24 - (minutes.length - index - 1), Math.round(elapsed / 60)));
    const hours = boundary - previous;
    previous = boundary;
    return hours;
  });
}

export function moveManualShiftBoundaryByHour(durations: readonly number[], index: number, hour: number): number[] {
  if (!Number.isFinite(hour) || !Number.isInteger(index) || index < 0 || index >= durations.length - 1) return [...durations];
  const next = snapManualShiftDurationsToHours(durations);
  const previous = next.slice(0, index).reduce((sum, duration) => sum + duration, 0);
  const end = previous + next[index]! + next[index + 1]!;
  const boundary = Math.max(previous + 1, Math.min(end - 1, Math.round(hour)));
  next[index] = boundary - previous;
  next[index + 1] = end - boundary;
  return next;
}

export function manualShiftTimeRanges(
  startTime: string,
  durations: readonly number[],
): ManualShiftTimeRange[] {
  const firstStart = parseTime(startTime) ?? parseTime(DEFAULT_MANUAL_SHIFT_START_TIME)!;
  let elapsed = 0;
  return normalizedDurationMinutes(durations).map((durationMinutes) => {
    const range = {
      startTime: formatTime(firstStart + elapsed),
      endTime: formatTime(firstStart + elapsed + durationMinutes - 1),
      durationMinutes,
    };
    elapsed += durationMinutes;
    return range;
  });
}

export function updateManualShiftBoundary(
  startTime: string,
  durations: readonly number[],
  shiftIndex: number,
  endTime: string,
): number[] | null {
  const ranges = manualShiftTimeRanges(startTime, durations);
  if (shiftIndex < 0 || shiftIndex >= ranges.length - 1) return null;
  const firstStart = parseTime(startTime) ?? parseTime(DEFAULT_MANUAL_SHIFT_START_TIME)!;
  const selected = parseTime(endTime);
  if (selected === null) return null;
  let selectedOffset = selected - firstStart + 1;
  if (selectedOffset <= 0) selectedOffset += MINUTES_PER_DAY;
  const previousOffset = ranges.slice(0, shiftIndex).reduce((sum, range) => sum + range.durationMinutes, 0);
  const nextOffset = previousOffset + ranges[shiftIndex]!.durationMinutes + ranges[shiftIndex + 1]!.durationMinutes;
  if (selectedOffset <= previousOffset || selectedOffset >= nextOffset) return null;
  const nextMinutes = ranges.map((range) => range.durationMinutes);
  nextMinutes[shiftIndex] = selectedOffset - previousOffset;
  nextMinutes[shiftIndex + 1] = nextOffset - selectedOffset;
  return nextMinutes.map((minutes) => minutes / 60);
}

export function resizeManualShiftDurations(durations: readonly number[], count: number): number[] {
  const target = Math.max(MIN_MANUAL_SHIFT_COUNT, Math.min(MAX_MANUAL_SHIFT_COUNT, Math.trunc(count || 1)));
  const minutes = normalizedDurationMinutes(durations);
  while (minutes.length < target) {
    const last = minutes.pop() ?? MINUTES_PER_DAY;
    const firstHalf = Math.max(1, Math.floor(last / 2));
    minutes.push(firstHalf, Math.max(1, last - firstHalf));
  }
  while (minutes.length > target) {
    const removed = minutes.pop()!;
    minutes[minutes.length - 1] = (minutes[minutes.length - 1] ?? 0) + removed;
  }
  return minutes.map((duration) => duration / 60);
}

export function formatManualShiftDuration(minutes: number, en: boolean): string {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (en) return `${hours ? `${hours}h` : ""}${remainingMinutes ? `${hours ? " " : ""}${remainingMinutes}m` : ""}`;
  return `${hours ? `${hours}小时` : ""}${remainingMinutes ? `${remainingMinutes}分钟` : ""}`;
}

function finitePositive(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : fallback;
}

export function manualRoomCapacity(room: EditableRoom): number {
  if (room.kind === "recycling") return 2;
  if (room.kind === "control_center") return Math.max(1, Math.min(5, room.level));
  if (room.kind === "trade_post" || room.kind === "factory") return Math.max(1, Math.min(3, room.level));
  if (room.kind === "meeting_room" || room.kind === "training_room") return 2;
  if (room.kind === "dormitory") return Math.max(1, Math.min(5, room.dorm_beds ?? 5));
  return 1;
}

function emptyShift(durationHours: number): ManualShift {
  return { durationHours, rooms: {}, fiammettaTarget: null, droneTargetRoomId: null };
}

export function createManualScheduleDraft(
  durations: readonly number[] = DEFAULT_MANUAL_SHIFT_DURATIONS,
  startTime = DEFAULT_MANUAL_SHIFT_START_TIME,
  scheduleMode: ManualScheduleMode = "sequential",
): ManualScheduleDraft {
  const normalized = normalizeManualShiftDurations(durations);
  return {
    version: 3,
    scheduleMode,
    externalOperatorNames: [],
    startTime: formatTime(parseTime(startTime) ?? parseTime(DEFAULT_MANUAL_SHIFT_START_TIME)!),
    activeShift: 0,
    fiammettaEnabled: false,
    shifts: normalized.slice(0, MAX_MANUAL_SHIFT_COUNT).map((duration) => emptyShift(finitePositive(duration, 12))),
  };
}

function maaOperatorName(
  operator: string | MaaOperatorSlot | null,
  groups?: ReadonlyMap<string, readonly string[]>,
  owned?: ReadonlySet<string>,
): string | null {
  const name = typeof operator === "string"
    ? operator.trim()
    : operator && typeof operator.name === "string"
      ? operator.name.trim()
      : "";
  if (!name) return null;
  const candidates = groups?.get(name);
  if (!candidates?.length) return name;
  return candidates.find((candidate) => owned?.has(candidate)) ?? candidates[0] ?? null;
}

function maaPeriodDurationMinutes(period: MaaPeriod[] | undefined): number | null {
  if (!Array.isArray(period) || period.length === 0) return null;
  let total = 0;
  for (const range of period) {
    if (!Array.isArray(range) || range.length !== 2) return null;
    const start = parseTime(range[0]);
    const end = parseTime(range[1]);
    if (start === null || end === null) return null;
    total += ((end - start + MINUTES_PER_DAY) % MINUTES_PER_DAY) + 1;
  }
  return total > 0 && total <= MINUTES_PER_DAY ? total : null;
}

export function parseMaaScheduleText(text: string): MaaJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("排班 JSON 无法解析，请确认文件内容完整。");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("排班文件顶层必须是 JSON 对象。");
  }
  const candidate = parsed as Partial<MaaJson>;
  if (!Array.isArray(candidate.plans) || candidate.plans.length === 0) {
    throw new Error("排班文件缺少非空的 plans 数组。");
  }
  candidate.plans.forEach((plan, index) => {
    if (!plan || typeof plan !== "object" || Array.isArray(plan) || !plan.rooms || typeof plan.rooms !== "object" || Array.isArray(plan.rooms)) {
      throw new Error(`第 ${index + 1} 个班次缺少有效的 rooms 对象。`);
    }
    for (const [roomKind, rooms] of Object.entries(plan.rooms)) {
      if (!Array.isArray(rooms)) throw new Error(`第 ${index + 1} 个班次的 ${roomKind} 必须是房间数组。`);
      rooms.forEach((room, roomIndex) => {
        if (!room || typeof room !== "object" || Array.isArray(room)) {
          throw new Error(`第 ${index + 1} 个班次的 ${roomKind}[${roomIndex}] 不是有效房间。`);
        }
        if ("operators" in room && !Array.isArray(room.operators)) {
          throw new Error(`第 ${index + 1} 个班次的 ${roomKind}[${roomIndex}].operators 必须是数组。`);
        }
      });
    }
  });
  return parsed as MaaJson;
}

function periodForSegment(start: number, duration: number): MaaPeriod[] {
  if (duration >= MINUTES_PER_DAY) return [["00:00", "23:59"]];
  const end = (start + duration - 1) % MINUTES_PER_DAY;
  return start <= end
    ? [[formatTime(start), formatTime(end)]]
    : [[formatTime(start), "23:59"], ["00:00", formatTime(end)]];
}

/**
 * 将 MAA 的时间选择规则展开成编辑器可表示的连续 24 小时时间线。
 * 同一计划的跨午夜相邻区间会合并；真正不连续的重复区间会复制为不同班次。
 */
export function normalizeMaaScheduleForManualImport(maa: MaaJson): MaaJson {
  const timedPlans = maa.plans.filter((plan) => Array.isArray(plan.period) && plan.period.length > 0);
  if (timedPlans.length === 0) return structuredClone(maa);
  if (timedPlans.length !== maa.plans.length) {
    throw new Error("排班文件混合了有时间区间和无时间区间的班次，无法自动判断执行顺序。");
  }

  const coverage = new Int16Array(MINUTES_PER_DAY).fill(-1);
  maa.plans.forEach((plan, planIndex) => {
    for (const range of plan.period ?? []) {
      const start = parseTime(range[0]);
      const end = parseTime(range[1]);
      if (start === null || end === null) throw new Error(`第 ${planIndex + 1} 个班次包含无效时间区间。`);
      const duration = ((end - start + MINUTES_PER_DAY) % MINUTES_PER_DAY) + 1;
      for (let offset = 0; offset < duration; offset += 1) {
        const minute = (start + offset) % MINUTES_PER_DAY;
        if (coverage[minute] !== -1) throw new Error(`排班时间在 ${formatTime(minute)} 发生重叠。`);
        coverage[minute] = planIndex;
      }
    }
  });
  const gap = coverage.findIndex((planIndex) => planIndex === -1);
  if (gap >= 0) throw new Error(`排班时间在 ${formatTime(gap)} 存在空档，时间区间模式必须覆盖完整 24 小时。`);

  const preferredStart = parseTime(maa.plans[0]?.period?.[0]?.[0]) ?? 0;
  let cycleStart = preferredStart;
  if (coverage[cycleStart] === coverage[(cycleStart + MINUTES_PER_DAY - 1) % MINUTES_PER_DAY]) {
    const boundary = Array.from({ length: MINUTES_PER_DAY }, (_, minute) => minute).find((minute) => (
      coverage[minute] !== coverage[(minute + MINUTES_PER_DAY - 1) % MINUTES_PER_DAY]
    ));
    if (boundary !== undefined) cycleStart = boundary;
  }

  const segments: Array<{ planIndex: number; start: number; duration: number }> = [];
  for (let elapsed = 0; elapsed < MINUTES_PER_DAY;) {
    const start = (cycleStart + elapsed) % MINUTES_PER_DAY;
    const planIndex = coverage[start]!;
    let duration = 1;
    while (elapsed + duration < MINUTES_PER_DAY && coverage[(start + duration) % MINUTES_PER_DAY] === planIndex) duration += 1;
    segments.push({ planIndex, start, duration });
    elapsed += duration;
  }
  if (segments.length > MAX_MANUAL_SHIFT_COUNT) {
    throw new Error(`排班文件展开后共有 ${segments.length} 个时间班次，超过页面支持的 ${MAX_MANUAL_SHIFT_COUNT} 班。`);
  }

  return {
    ...structuredClone(maa),
    plans: segments.map((segment, index) => ({
      ...structuredClone(maa.plans[segment.planIndex]!),
      name: `班次 ${index + 1}`,
      period: periodForSegment(segment.start, segment.duration),
      duration: segment.duration,
    })),
  };
}

/** 用排班文件明确给出的房间数组和产物覆盖对应设施；文件未涉及的设施沿用当前布局。 */
export function layoutFromMaaSchedule(maa: MaaJson, current: BaseBlueprint): BaseBlueprint {
  const rooms: BlueprintRoom[] = [];
  for (const definition of IMPORTED_LAYOUT_GROUPS) {
    const specifiedPlans = maa.plans.filter((plan) => Object.prototype.hasOwnProperty.call(plan.rooms, definition.group));
    if (specifiedPlans.length === 0) {
      rooms.push(...current.rooms.filter((room) => room.kind === definition.kind).map((room) => structuredClone(room)));
      continue;
    }
    const count = Math.max(0, ...specifiedPlans.map((plan) => plan.rooms[definition.group]?.length ?? 0));
    const existing = current.rooms.filter((room) => room.kind === definition.kind);
    for (let index = 0; index < count; index += 1) {
      const previous = existing[index];
      const room: BlueprintRoom = previous
        ? structuredClone(previous)
        : {
            id: definition.kind === "control_center" ? "control" : `${definition.idPrefix}_${index + 1}`,
            kind: definition.kind,
            level: definition.level,
            ...(definition.kind === "dormitory" ? { dorm_beds: 5 } : {}),
            ...(definition.kind === "trade_post" ? { product: { trade: { order: "gold" as const } } } : {}),
            ...(definition.kind === "factory" ? { product: { factory: { recipe: "gold" as const } } } : {}),
          };
      const importedProduct = importedRoomProduct(maa, definition.group, definition.kind, index);
      rooms.push(importedProduct
        ? {
            ...room,
            product: "trade" in importedProduct
              ? { trade: { order: normalizeProductForLevel(room.level, importedProduct.trade.order) } }
              : importedProduct,
          }
        : room);
    }
  }
  rooms.push(...current.rooms.filter((room) => room.kind === "training_room").map((room) => structuredClone(room)));
  const trading = rooms.filter((room) => room.kind === "trade_post").length;
  const manufacture = rooms.filter((room) => room.kind === "factory").length;
  const power = rooms.filter((room) => room.kind === "power_plant").length;
  return {
    ...structuredClone(current),
    template: trading > 0 && manufacture > 0 && power > 0 ? `${trading}${manufacture}${power}` : "imported",
    rooms,
  };
}

export function createManualScheduleDraftFromCalculator(input: {
  layout: BaseBlueprint;
  maa?: MaaJson | null;
  fallbackDurations: readonly number[];
  fiammettaEnabled: boolean;
  trainingRoomShifts?: readonly TrainingRoomShift[];
  source?: ManualScheduleSource;
  ownedOperatorNames?: readonly string[];
  preferMaaTiming?: boolean;
  timingOverride?: { scheduleMode: ManualScheduleMode; startTime?: string };
  preserveExternalOperators?: boolean;
}): ManualScheduleDraft {
  const planCount = input.maa?.plans.length ?? 0;
  const durations = Array.from(
    { length: Math.max(planCount, input.fallbackDurations.length, MIN_MANUAL_SHIFT_COUNT) },
    (_, index) => {
      const plan = input.maa?.plans[index];
      const periodMinutes = maaPeriodDurationMinutes(plan?.period);
      const maaDuration = finitePositive(
        periodMinutes === null ? undefined : periodMinutes / 60,
        finitePositive(
          typeof plan?.duration === "number" ? plan.duration / 60 : undefined,
          12,
        ),
      );
      return input.preferMaaTiming
        ? maaDuration
        : finitePositive(input.fallbackDurations[index], maaDuration);
    },
  );
  const scheduleMode: ManualScheduleMode = input.timingOverride?.scheduleMode
    ?? (input.maa?.plans.some((plan) => Array.isArray(plan.period) && plan.period.length > 0)
      ? "period"
      : "sequential");
  const startTime = input.timingOverride?.startTime ?? input.maa?.plans[0]?.period?.[0]?.[0];
  const draft = createManualScheduleDraft(durations, startTime, scheduleMode);
  draft.fiammettaEnabled = input.fiammettaEnabled;
  if (input.source) draft.source = { ...input.source };
  const owned = input.ownedOperatorNames ? new Set(input.ownedOperatorNames) : undefined;

  input.maa?.plans.forEach((plan, shiftIndex) => {
    const shift = draft.shifts[shiftIndex];
    if (!shift) return;
    const groups = new Map((plan.groups ?? []).map((group) => [group.name, group.operators]));
    const groupIndexes: Partial<Record<keyof MaaRooms, number>> = {};
    for (const room of input.layout.rooms) {
      const group = MAA_GROUP_BY_ROOM_KIND[room.kind];
      if (!group) continue;
      const roomIndex = groupIndexes[group] ?? 0;
      groupIndexes[group] = roomIndex + 1;
      const sourceRoom = plan.rooms?.[group]?.[roomIndex];
      if (!sourceRoom) continue;
      const sourceOperators = sourceRoom.use_operator_groups
        ? sourceRoom.operators
            .map((operator) => typeof operator === "string" ? operator : operator?.name)
            .flatMap((groupName) => groupName ? [groups.get(groupName)] : [])
            .find((operators) => operators && (!owned || operators.every((name) => owned.has(name))))
          ?? sourceRoom.operators
            .map((operator) => typeof operator === "string" ? operator : operator?.name)
            .flatMap((groupName) => groupName ? [groups.get(groupName)] : [])
            .find(Boolean)
          ?? []
        : sourceRoom.operators;
      shift.rooms[room.id] = {
        operators: Array.from(
          { length: manualRoomCapacity(room) },
          (_, slotIndex) => maaOperatorName(sourceOperators[slotIndex] ?? null),
        ),
        ...(room.kind === "dormitory" ? { autofill: sourceRoom.autofill ?? true } : {}),
      };
    }
    const target = plan.Fiammetta?.target;
    shift.fiammettaTarget = plan.Fiammetta?.enable
      ? (Array.isArray(target) ? target.find(Boolean) : target) ?? null
      : null;
    const drones = plan.drones;
    if (drones && drones.enable !== false && (drones.room === "trading" || drones.room === "manufacture")) {
      const targetShift = draft.shifts[droneTargetShiftIndex(shiftIndex, draft.shifts.length)];
      if (!targetShift) return;
      targetShift.droneTargetRoomId = input.layout.rooms.filter(
        (room) => MAA_GROUP_BY_ROOM_KIND[room.kind] === drones.room,
      )[drones.index - 1]?.id ?? null;
    }
  });

  if (input.preserveExternalOperators) {
    draft.externalOperatorNames = [...new Set(draft.shifts.flatMap((shift) => [
      ...Object.values(shift.rooms).flatMap((room) => room.operators.flatMap((name) => name ? [name] : [])),
      ...(shift.fiammettaTarget ? [shift.fiammettaTarget] : []),
    ]))];
  }

  const trainingRoom = input.layout.rooms.find((room) => room.kind === "training_room");
  if (trainingRoom) {
    input.trainingRoomShifts?.forEach((trainingShift, shiftIndex) => {
      const shift = draft.shifts[shiftIndex];
      if (!shift) return;
      shift.rooms[trainingRoom.id] = { operators: [trainingShift.trainee, trainingShift.trainer] };
    });
  }
  return draft;
}

export function loadManualScheduleDraft(storage: StorageLike): ManualScheduleDraft | null {
  try {
    const value = JSON.parse(storage.getItem(MANUAL_SCHEDULE_STORAGE_KEY) ?? "null") as unknown;
    if (!value || typeof value !== "object" || !("shifts" in value) || !Array.isArray(value.shifts)) return null;
    const rawShifts = value.shifts.slice(0, MAX_MANUAL_SHIFT_COUNT);
    if (rawShifts.length < MIN_MANUAL_SHIFT_COUNT) return null;
    const parsedShifts = rawShifts.map((raw): ManualShift => {
      const candidate = raw && typeof raw === "object" ? raw as Partial<ManualShift> : {};
      const rooms = candidate.rooms && typeof candidate.rooms === "object" && !Array.isArray(candidate.rooms)
        ? Object.fromEntries(Object.entries(candidate.rooms).flatMap(([roomId, assignment]) => {
          if (!assignment || typeof assignment !== "object" || !Array.isArray((assignment as ManualRoomAssignment).operators)) return [];
          const manualSkillEfficiencyPct = Number((assignment as ManualRoomAssignment).manualSkillEfficiencyPct);
          return [[roomId, {
            operators: (assignment as ManualRoomAssignment).operators.map((name) => typeof name === "string" ? name : null),
            ...(typeof (assignment as ManualRoomAssignment).autofill === "boolean"
              ? { autofill: (assignment as ManualRoomAssignment).autofill }
              : {}),
            ...(Number.isFinite(manualSkillEfficiencyPct) && manualSkillEfficiencyPct >= 0
              ? { manualSkillEfficiencyPct: Math.round(manualSkillEfficiencyPct * 100) / 100 }
              : {}),
          }]];
        }))
        : {};
      return {
        durationHours: finitePositive(candidate.durationHours, 12),
        rooms,
        fiammettaTarget: typeof candidate.fiammettaTarget === "string" ? candidate.fiammettaTarget : null,
        droneTargetRoomId: typeof candidate.droneTargetRoomId === "string" ? candidate.droneTargetRoomId : null,
      };
    });
    const normalizedDurations = normalizeManualShiftDurations(parsedShifts.map((shift) => shift.durationHours));
    const shifts = parsedShifts.map((shift, index) => ({ ...shift, durationHours: normalizedDurations[index]! }));
    const activeShift = "activeShift" in value && Number.isInteger(value.activeShift)
      ? Math.max(0, Math.min(shifts.length - 1, Number(value.activeShift)))
      : 0;
    const rawSource = "source" in value && value.source && typeof value.source === "object"
      ? value.source as Partial<ManualScheduleSource>
      : null;
    const source = rawSource?.kind === "calculator"
      && (rawSource.variant === "baseline" || rawSource.variant === "progression-adjusted")
      && typeof rawSource.createdAt === "string"
      && Number.isFinite(Date.parse(rawSource.createdAt))
      ? {
          kind: "calculator" as const,
          variant: rawSource.variant,
          createdAt: new Date(rawSource.createdAt).toISOString(),
        }
      : undefined;
    return {
      version: 3,
      scheduleMode: "scheduleMode" in value && value.scheduleMode === "period" ? "period" : "sequential",
      externalOperatorNames: "externalOperatorNames" in value && Array.isArray(value.externalOperatorNames)
        ? value.externalOperatorNames.filter((name): name is string => typeof name === "string" && name.trim().length > 0)
        : [],
      startTime: formatTime(parseTime("startTime" in value ? value.startTime : null) ?? parseTime(DEFAULT_MANUAL_SHIFT_START_TIME)!),
      activeShift,
      fiammettaEnabled: "fiammettaEnabled" in value && value.fiammettaEnabled === true,
      shifts,
      ...(source ? { source } : {}),
    };
  } catch {
    return null;
  }
}

export function persistManualScheduleDraft(storage: StorageLike, draft: ManualScheduleDraft): void {
  storage.setItem(MANUAL_SCHEDULE_STORAGE_KEY, JSON.stringify(draft));
}

export function resizeManualScheduleDraft(
  draft: ManualScheduleDraft,
  durations: readonly number[],
  startTime = draft.startTime,
): ManualScheduleDraft {
  const normalizedDurations = normalizeManualShiftDurations(durations);
  const count = normalizedDurations.length;
  const shifts = Array.from({ length: count }, (_, index) => ({
    ...(draft.shifts[index] ?? emptyShift(normalizedDurations[index]!)),
    durationHours: normalizedDurations[index]!,
  }));
  return {
    version: 3,
    scheduleMode: draft.scheduleMode,
    externalOperatorNames: [...draft.externalOperatorNames],
    startTime: formatTime(parseTime(startTime) ?? parseTime(DEFAULT_MANUAL_SHIFT_START_TIME)!),
    activeShift: Math.min(draft.activeShift, shifts.length - 1),
    fiammettaEnabled: draft.fiammettaEnabled,
    shifts,
    ...(draft.source ? { source: { ...draft.source } } : {}),
  };
}

export function reconcileManualScheduleDraft(
  draft: ManualScheduleDraft,
  layout: BaseBlueprint,
  operbox?: OperBoxEntry[] | null,
): ManualScheduleDraft {
  const owned = operbox ? new Set([
    ...operbox.filter((entry) => entry.own).map((entry) => entry.name),
    ...draft.externalOperatorNames,
  ]) : null;
  const normalizedDurations = normalizeManualShiftDurations(draft.shifts.map((shift) => shift.durationHours));
  return {
    version: 3,
    scheduleMode: draft.scheduleMode === "period" ? "period" : "sequential",
    externalOperatorNames: [...new Set(draft.externalOperatorNames)],
    startTime: formatTime(parseTime(draft.startTime) ?? parseTime(DEFAULT_MANUAL_SHIFT_START_TIME)!),
    activeShift: Math.min(Math.max(0, draft.activeShift), Math.max(0, draft.shifts.length - 1)),
    fiammettaEnabled: draft.fiammettaEnabled === true,
    ...(draft.source ? { source: { ...draft.source } } : {}),
    shifts: draft.shifts.map((shift, shiftIndex) => {
      const assigned = new Set<string>();
      return {
        durationHours: normalizedDurations[shiftIndex]!,
        fiammettaTarget: shift.fiammettaTarget && (!owned || owned.has(shift.fiammettaTarget))
          ? shift.fiammettaTarget
          : null,
        droneTargetRoomId: layout.rooms.some((room) => (
          room.id === shift.droneTargetRoomId && (room.kind === "trade_post" || room.kind === "factory")
        )) ? shift.droneTargetRoomId : null,
        rooms: Object.fromEntries(manualEditableRooms(layout).map((room) => {
          const assignment = shift.rooms[room.id];
          const operators = Array.from(
            { length: manualRoomCapacity(room) },
            (_, index) => {
              const name = assignment?.operators[index];
              if (typeof name !== "string" || name.length === 0 || (owned && !owned.has(name)) || assigned.has(name)) return null;
              assigned.add(name);
              return name;
            },
          );
          const manualSkillEfficiencyPct = Number(assignment?.manualSkillEfficiencyPct);
          const isProductionRoom = room.kind === "trade_post" || room.kind === "factory" || room.kind === "power_plant";
          return [room.id, {
            operators,
            ...(room.kind === "dormitory" ? { autofill: assignment?.autofill ?? true } : {}),
            ...(isProductionRoom && Number.isFinite(manualSkillEfficiencyPct) && manualSkillEfficiencyPct >= 0
              ? { manualSkillEfficiencyPct: Math.round(manualSkillEfficiencyPct * 100) / 100 }
              : {}),
          } satisfies ManualRoomAssignment];
        })),
      };
    }),
  };
}

export function manualScheduleDraftContentEqual(
  left: ManualScheduleDraft,
  right: ManualScheduleDraft,
): boolean {
  return JSON.stringify({
    scheduleMode: left.scheduleMode,
    startTime: left.startTime,
    fiammettaEnabled: left.fiammettaEnabled,
    shifts: left.shifts,
  }) === JSON.stringify({
    scheduleMode: right.scheduleMode,
    startTime: right.startTime,
    fiammettaEnabled: right.fiammettaEnabled,
    shifts: right.shifts,
  });
}

export function findManualOperatorConflict(
  shift: ManualShift,
  operator: string,
  targetRoomId: string,
  targetSlotIndex: number,
): ManualOperatorConflict | null {
  for (const [roomId, assignment] of Object.entries(shift.rooms)) {
    const slotIndex = assignment.operators.findIndex((name, index) => (
      name === operator && (roomId !== targetRoomId || index !== targetSlotIndex)
    ));
    if (slotIndex >= 0) return { roomId, slotIndex };
  }
  return null;
}

export function assignManualOperator(input: {
  draft: ManualScheduleDraft;
  layout: BaseBlueprint;
  shiftIndex: number;
  roomId: string;
  slotIndex: number;
  operator: string | null;
  moveExisting?: boolean;
}): { draft: ManualScheduleDraft; conflict: ManualOperatorConflict | null } {
  const { layout, shiftIndex, roomId, slotIndex, operator } = input;
  const room = manualEditableRooms(layout).find((candidate) => candidate.id === roomId);
  const shift = input.draft.shifts[shiftIndex];
  if (!room || !shift || slotIndex < 0 || slotIndex >= manualRoomCapacity(room)) {
    return { draft: input.draft, conflict: null };
  }
  const currentAssignment = shift.rooms[roomId];
  const currentOperator = currentAssignment?.operators[slotIndex] ?? null;
  if (operator !== null && operator === currentOperator) return { draft: input.draft, conflict: null };

  const conflict = operator ? findManualOperatorConflict(shift, operator, roomId, slotIndex) : null;
  if (conflict?.roomId === roomId) {
    const next = structuredClone(input.draft);
    const operators = next.shifts[shiftIndex]!.rooms[roomId]!.operators;
    operators[slotIndex] = operator;
    operators[conflict.slotIndex] = currentOperator;
    return { draft: next, conflict: null };
  }
  if (conflict && !input.moveExisting) return { draft: input.draft, conflict };

  const next = structuredClone(input.draft);
  const nextShift = next.shifts[shiftIndex]!;
  if (conflict) {
    const previous = nextShift.rooms[conflict.roomId];
    if (previous) previous.operators[conflict.slotIndex] = null;
  }
  const assignment = nextShift.rooms[roomId] ?? {
    operators: Array.from({ length: manualRoomCapacity(room) }, () => null),
    ...(room.kind === "dormitory" ? { autofill: true } : {}),
  };
  assignment.operators = Array.from(
    { length: manualRoomCapacity(room) },
    (_, index) => index === slotIndex ? operator : assignment.operators[index] ?? null,
  );
  if (room.kind === "dormitory" && operator === null) assignment.autofill = false;
  nextShift.rooms[roomId] = assignment;
  return { draft: next, conflict };
}

export function swapManualOperators(
  draft: ManualScheduleDraft,
  layout: BaseBlueprint,
  shiftIndex: number,
  roomId: string,
  firstSlotIndex: number,
  secondSlotIndex: number,
): ManualScheduleDraft {
  const room = manualEditableRooms(layout).find((candidate) => candidate.id === roomId);
  const assignment = draft.shifts[shiftIndex]?.rooms[roomId];
  if (!room || !assignment || firstSlotIndex === secondSlotIndex) return draft;
  if (
    !Number.isInteger(firstSlotIndex)
    || !Number.isInteger(secondSlotIndex)
    || firstSlotIndex < 0
    || secondSlotIndex < 0
    || firstSlotIndex >= manualRoomCapacity(room)
    || secondSlotIndex >= manualRoomCapacity(room)
  ) return draft;
  const next = structuredClone(draft);
  const operators = next.shifts[shiftIndex]!.rooms[roomId]!.operators;
  [operators[firstSlotIndex], operators[secondSlotIndex]] = [operators[secondSlotIndex], operators[firstSlotIndex]];
  return next;
}

export function setManualRoomSkillEfficiency(
  draft: ManualScheduleDraft,
  layout: BaseBlueprint,
  shiftIndex: number,
  roomId: string,
  value: number | null,
): ManualScheduleDraft {
  const room = layout.rooms.find((candidate) => candidate.id === roomId);
  if (!room || !draft.shifts[shiftIndex] || (room.kind !== "trade_post" && room.kind !== "factory" && room.kind !== "power_plant")) return draft;
  const next = structuredClone(draft);
  const shift = next.shifts[shiftIndex]!;
  const assignment = shift.rooms[roomId] ?? {
    operators: Array.from({ length: manualRoomCapacity(room) }, () => null),
  };
  if (value === null || !Number.isFinite(value) || value < 0) {
    delete assignment.manualSkillEfficiencyPct;
  } else {
    assignment.manualSkillEfficiencyPct = Math.round(value * 100) / 100;
  }
  shift.rooms[roomId] = assignment;
  return next;
}

export function setManualDormAutofill(
  draft: ManualScheduleDraft,
  layout: BaseBlueprint,
  shiftIndex: number,
  roomId: string,
  enabled: boolean,
): ManualScheduleDraft {
  const room = layout.rooms.find((candidate) => candidate.id === roomId && candidate.kind === "dormitory");
  if (!room || !draft.shifts[shiftIndex]) return draft;
  const next = structuredClone(draft);
  const shift = next.shifts[shiftIndex]!;
  const assignment = shift.rooms[roomId] ?? {
    operators: Array.from({ length: manualRoomCapacity(room) }, () => null),
  };
  assignment.autofill = enabled;
  shift.rooms[roomId] = assignment;
  return next;
}

export function setManualDroneTarget(
  draft: ManualScheduleDraft,
  layout: BaseBlueprint,
  shiftIndex: number,
  roomId: string | null,
): ManualScheduleDraft {
  const room = roomId ? layout.rooms.find((candidate) => candidate.id === roomId) : null;
  if (!draft.shifts[shiftIndex] || (room && room.kind !== "trade_post" && room.kind !== "factory")) return draft;
  const next = structuredClone(draft);
  next.shifts[shiftIndex]!.droneTargetRoomId = room?.id ?? null;
  return next;
}

export function clearManualRoom(
  draft: ManualScheduleDraft,
  layout: BaseBlueprint,
  shiftIndex: number,
  roomId: string,
): ManualScheduleDraft {
  const room = manualEditableRooms(layout).find((candidate) => candidate.id === roomId);
  if (!room || !draft.shifts[shiftIndex]) return draft;
  const next = structuredClone(draft);
  next.shifts[shiftIndex]!.rooms[roomId] = {
    operators: Array.from({ length: manualRoomCapacity(room) }, () => null),
    ...(room.kind === "dormitory" ? { autofill: false } : {}),
  };
  return next;
}

export function clearManualShift(
  draft: ManualScheduleDraft,
  layout: BaseBlueprint,
  shiftIndex: number,
): ManualScheduleDraft {
  if (!draft.shifts[shiftIndex]) return draft;
  const next = structuredClone(draft);
  const shift = next.shifts[shiftIndex]!;
  shift.droneTargetRoomId = null;
  shift.rooms = Object.fromEntries(layout.rooms.map((room) => [room.id, {
    operators: Array.from({ length: manualRoomCapacity(room) }, () => null),
    ...(room.kind === "dormitory" ? { autofill: false } : {}),
  } satisfies ManualRoomAssignment]));
  return next;
}

function maaProduct(room: BlueprintRoom): string | undefined {
  if (room.kind === "trade_post") {
    const order = room.product && "trade" in room.product ? room.product.trade.order : "gold";
    return order === "originium" ? "Orundum" : "LMD";
  }
  if (room.kind !== "factory") return undefined;
  const recipe = room.product && "factory" in room.product ? room.product.factory.recipe : "gold";
  if (recipe === "battle_record") return "Battle Record";
  if (recipe === "originium") return "Originium Shard";
  if (recipe === "all") return "all";
  return "Pure Gold";
}

function maaRoom(room: BlueprintRoom, assignment: ManualRoomAssignment | undefined): MaaRoom {
  const operators = (assignment?.operators ?? []).slice(0, manualRoomCapacity(room)).filter(
    (operator): operator is string => typeof operator === "string" && operator.length > 0,
  );
  const product = maaProduct(room);
  return {
    operators,
    sort: true,
    skip: false,
    autofill: room.kind === "dormitory" ? assignment?.autofill ?? true : false,
    ...(product ? { product } : {}),
  };
}

export function manualScheduleToMaa(
  draft: ManualScheduleDraft,
  layout: BaseBlueprint,
  fiammettaEnabled: boolean,
): MaaJson {
  const ranges = manualShiftTimeRanges(draft.startTime, draft.shifts.map((shift) => shift.durationHours));
  return {
    title: `手动排班 · ${layout.template}`,
    description: "由可露希尔基建终端手动排班生成",
    planTimes: `${draft.shifts.length}班`,
    plans: draft.shifts.map((shift, shiftIndex) => {
      const range = ranges[shiftIndex]!;
      const start = parseTime(range.startTime)!;
      const period: MaaPeriod[] = range.durationMinutes >= MINUTES_PER_DAY
        ? [["00:00", "23:59"]]
        : start + range.durationMinutes <= MINUTES_PER_DAY
          ? [[range.startTime, range.endTime]]
          : [[range.startTime, "23:59"], ["00:00", range.endTime]];
      const droneTargetShift = draft.shifts[droneTargetShiftIndex(shiftIndex, draft.shifts.length)];
      const droneRoom = layout.rooms.find((room) => room.id === droneTargetShift?.droneTargetRoomId);
      const droneGroup = droneRoom ? MAA_GROUP_BY_ROOM_KIND[droneRoom.kind] : undefined;
      const droneIndex = droneGroup === "trading" || droneGroup === "manufacture"
        ? layout.rooms.filter((room) => MAA_GROUP_BY_ROOM_KIND[room.kind] === droneGroup).findIndex((room) => room.id === droneRoom?.id) + 1
        : 0;
      const rooms: MaaRooms = {};
      for (const room of layout.rooms) {
        const group = MAA_GROUP_BY_ROOM_KIND[room.kind];
        if (!group) continue;
        const groupRooms = rooms[group] ?? [];
        groupRooms.push(maaRoom(room, shift.rooms[room.id]));
        rooms[group] = groupRooms;
      }
      return {
        name: `班次 ${shiftIndex + 1}`,
        ...(draft.scheduleMode === "period" ? { period } : {}),
        duration: range.durationMinutes,
        rooms,
        Fiammetta: fiammettaEnabled && shift.fiammettaTarget
          ? { enable: true, target: shift.fiammettaTarget, order: "pre" as const }
          : { enable: false, target: "", order: "pre" as const },
        ...(droneIndex > 0 && (droneGroup === "trading" || droneGroup === "manufacture") ? {
          drones: { enable: true, room: droneGroup, index: droneIndex, rule: "all", order: "pre" as const },
        } : {}),
      };
    }),
  };
}
