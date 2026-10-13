import { droneStoragePlanIndex } from "./drone-plan-mapping.ts";
import type { BaseBlueprint, MaaJson, MaaPlan, MaaRoom, RotationJson, RotationShift } from "./types.ts";

export type PowerStationContribution = {
  equivalentEfficiency: number;
  working: boolean;
};

/** All production fields use their calculator value domain; pure_gold is gold value, not gold pieces. */
export type DroneDailyProduction = {
  lmd: number;
  pure_gold: number;
  battle_records: number;
};

export type DroneTradeTarget =
  | { kind: "normal"; level: 1 | 2 | 3 }
  | { kind: "dantshu"; level: 1 | 2 | 3 }
  | { kind: "tequila" }
  | { kind: "closure" };

export type DroneOutputTarget =
  | { room: "trading"; index: number; profile: DroneTradeTarget }
  | { room: "manufacture"; index: number; product: "gold" | "experience" };

const NORMAL_TRADE_DAILY: Record<1 | 2 | 3, number> = { 1: 10_000, 2: 10_141, 3: 10_265 };
const DANTSHU_DAILY: Record<1 | 2 | 3, number> = { 1: 20_000, 2: 18_591.55, 3: 15_929.2 };
const SPECIAL_TRADE_DAILY = {
  tequila: { lmd: 12_739.73, gold: 2_328.77 },
  closure: { lmd: 12_000, gold: 2_000 },
};

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function operatorName(operator: MaaRoom["operators"][number]): string {
  return typeof operator === "string" ? operator : operator?.name ?? "";
}

export function droneTradeTarget(level: number, operators: MaaRoom["operators"]): DroneTradeTarget {
  const names = operators.map(operatorName).filter(Boolean);
  const normalizedLevel = level === 1 || level === 2 ? level : 3;
  if (names.includes("但书")) return { kind: "dantshu", level: normalizedLevel };
  if (names.includes("龙舌兰")) return { kind: "tequila" };
  if (names.includes("可露希尔")) return { kind: "closure" };
  return { kind: "normal", level: normalizedLevel };
}

export function powerEfficiencyForShift(powerStations: readonly PowerStationContribution[]): number {
  return 1 + powerStations.reduce(
    (sum, station) => sum
      + (station.working ? 0.05 : 0)
      + (positive(station.equivalentEfficiency) ? station.equivalentEfficiency : 0),
    0,
  );
}

export function droneProductionForShift(input: {
  powerStations: readonly PowerStationContribution[];
  durationHours: number;
}): { drones: number; equivalentEfficiency: number } {
  const durationHours = positive(input.durationHours) ? input.durationHours : 0;
  const drones = powerEfficiencyForShift(input.powerStations) / 6 * durationHours * 60;
  return { drones, equivalentEfficiency: drones / 480 };
}

export function droneTradeOutputForEfficiency(target: DroneTradeTarget, equivalentEfficiency: number): DroneDailyProduction {
  if (target.kind === "normal") return { lmd: equivalentEfficiency * NORMAL_TRADE_DAILY[target.level], pure_gold: 0, battle_records: 0 };
  if (target.kind === "dantshu") return { lmd: equivalentEfficiency * DANTSHU_DAILY[target.level], pure_gold: 0, battle_records: 0 };
  const output = SPECIAL_TRADE_DAILY[target.kind];
  return { lmd: equivalentEfficiency * output.lmd, pure_gold: equivalentEfficiency * output.gold, battle_records: 0 };
}

/** Converts one actual shift's drone quantity into output using the automatic allocator's target rules. */
export function droneDailyProductionForActualShift(input: {
  powerStations: readonly PowerStationContribution[];
  durationHours: number;
  target: DroneOutputTarget;
}): DroneDailyProduction & { drones: number; equivalentEfficiency: number } {
  const quantity = droneProductionForShift(input);
  const output = input.target.room === "trading"
    ? droneTradeOutputForEfficiency(input.target.profile, quantity.equivalentEfficiency)
    : {
        lmd: 0,
        pure_gold: input.target.product === "gold" ? quantity.equivalentEfficiency * 10_000 : 0,
        battle_records: input.target.product === "experience" ? quantity.equivalentEfficiency * 8_000 : 0,
      };
  return { ...quantity, ...output };
}

export function normalizeDroneDailyProduction(cycle: DroneDailyProduction, totalDurationHours: number): DroneDailyProduction {
  const scale = totalDurationHours > 0 ? 24 / totalDurationHours : 1;
  return {
    lmd: cycle.lmd * scale,
    pure_gold: cycle.pure_gold * scale,
    battle_records: cycle.battle_records * scale,
  };
}

export function equivalentGoldForRotation(rotation: RotationJson): number {
  const totalHours = rotation.shifts.reduce((sum, shift) => sum + (positive(shift.duration_hours) ? shift.duration_hours : 0), 0);
  if (totalHours <= 0) return 0;
  const cycleValue = rotation.shifts.reduce((sum, shift) => {
    const efficiency = shift.scores.room_lines.reduce(
      (roomSum, line) => roomSum + (positive(line.gold_equivalent_efficiency) ? line.gold_equivalent_efficiency : 0),
      0,
    );
    return sum + efficiency * 10_000 * shift.duration_hours / 24;
  }, 0);
  return cycleValue * 24 / totalHours;
}

export function powerStationsFromRotation(layout: BaseBlueprint, shift: RotationShift, plan?: MaaPlan): PowerStationContribution[] {
  const powerRooms = layout.rooms.filter((room) => room.kind === "power_plant");
  return powerRooms.map((room, index) => {
    const line = shift.scores.room_lines.find((candidate) => candidate.room_id === room.id);
    const equivalentEfficiency = positive(line?.equivalent_efficiency) ? line.equivalent_efficiency : 0;
    const operators = plan?.rooms.power?.[index]?.operators ?? [];
    return { equivalentEfficiency, working: operators.some((operator) => operator !== null) && equivalentEfficiency > 0 };
  });
}

function actualPlanIndex(maa: MaaJson, shift: RotationShift, position: number): number | null {
  if (maa.plans[shift.index]) return shift.index;
  return maa.plans[position] ? position : null;
}

function factoryRecipe(room: MaaRoom | undefined): "gold" | "battle_record" | "originium" | null {
  const value = room?.product;
  if (["Gold", "Pure Gold", "gold", "贵金属"].includes(value ?? "")) return "gold";
  if (["Battle Record", "battle_record", "作战记录"].includes(value ?? "")) return "battle_record";
  if (["Originium Shard", "originium", "源石碎片"].includes(value ?? "")) return "originium";
  return null;
}

function selectedTarget(input: {
  layout: BaseBlueprint;
  actualPlan: MaaPlan;
  drones: NonNullable<MaaPlan["drones"]>;
}): DroneOutputTarget | null {
  const index = input.drones.index - 1;
  if (input.drones.room === "trading") {
    const blueprint = input.layout.rooms.filter((room) => room.kind === "trade_post")[index];
    const room = input.actualPlan.rooms.trading?.[index];
    if (!blueprint || !room) return null;
    return { room: "trading", index: input.drones.index, profile: droneTradeTarget(blueprint.level, room.operators) };
  }
  const recipe = factoryRecipe(input.actualPlan.rooms.manufacture?.[index]);
  if (recipe === "gold") return { room: "manufacture", index: input.drones.index, product: "gold" };
  if (recipe === "battle_record") return { room: "manufacture", index: input.drones.index, product: "experience" };
  return null;
}

/** Calculates drone output for user-selected MAA targets without choosing or rewriting targets. */
export function droneProductionForSelectedMaaTargets(input: {
  layout: BaseBlueprint;
  maa: MaaJson;
  rotation: RotationJson;
}): DroneDailyProduction {
  const totalHours = input.rotation.shifts.reduce((sum, shift) => sum + (positive(shift.duration_hours) ? shift.duration_hours : 0), 0);
  const cycle = { lmd: 0, pure_gold: 0, battle_records: 0 };
  input.rotation.shifts.forEach((shift, position) => {
    const planIndex = actualPlanIndex(input.maa, shift, position);
    const actualPlan = planIndex === null ? undefined : input.maa.plans[planIndex];
    const dronePlanIndex = planIndex === null ? null : droneStoragePlanIndex(planIndex, input.maa.plans.length);
    const drones = dronePlanIndex === null ? undefined : input.maa.plans[dronePlanIndex]?.drones;
    if (!actualPlan || !drones || drones.enable === false) return;
    const target = selectedTarget({ layout: input.layout, actualPlan, drones });
    if (!target) return;
    const powerStations = powerStationsFromRotation(input.layout, shift, actualPlan);
    const output = droneDailyProductionForActualShift({ powerStations, durationHours: shift.duration_hours, target });
    cycle.lmd += output.lmd;
    cycle.pure_gold += output.pure_gold;
    cycle.battle_records += output.battle_records;
  });
  return normalizeDroneDailyProduction(cycle, totalHours);
}
