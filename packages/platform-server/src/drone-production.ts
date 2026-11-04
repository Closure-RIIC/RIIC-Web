import { droneStoragePlanIndex } from "@riic/arknights-domain/drone-plan-mapping";
import {
  droneDailyProductionForActualShift,
  droneProductionForShift as calculateDroneProductionForShift,
  droneTradeOutputForEfficiency as calculateDroneTradeOutputForEfficiency,
  NORMAL_TRADE_DAILY,
  normalizeDroneDailyProduction,
  powerEfficiencyForShift as calculatePowerEfficiencyForShift,
  powerStationsFromRotation as corePowerStationsFromRotation,
  type DroneDailyProduction,
  type DroneOutputTarget,
  type DroneTradeTarget,
  type PowerStationContribution,
} from "@riic/arknights-domain/drone-production-core";
import type { BaseBlueprint, MaaJson, MaaPlan, RotationJson, RotationShift } from "@riic/arknights-domain/types";

export type { DroneDailyProduction, DroneTradeTarget } from "@riic/arknights-domain/drone-production-core";

export type DroneProduction = {
  drones: number;
  equivalentEfficiency: number;
};

export type DroneTradeOutput = {
  lmd: number;
  goldValue: number;
};

export type DroneRoomTarget = {
  room: "trading" | "manufacture";
  index: number;
  roomId: string;
  product: "lmd" | "gold" | "experience";
};

export type DroneShiftAllocation = {
  shiftIndex: number;
  target: DroneRoomTarget;
  outputTarget: DroneOutputTarget;
  drones: number;
  equivalentEfficiency: number;
  production: DroneDailyProduction;
  lmd: number;
  goldValue: number;
  experience: number;
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positive(value: unknown): value is number {
  return finite(value) && value >= 0;
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

export function powerEfficiencyForShift(input: { powerStations: PowerStationContribution[] }): number {
  return calculatePowerEfficiencyForShift(input.powerStations);
}

export function droneProductionForShift(input: {
  powerStations: PowerStationContribution[];
  durationHours: number;
}): DroneProduction {
  return calculateDroneProductionForShift(input);
}

export function droneTradeOutputForEfficiency(target: DroneTradeTarget, equivalentEfficiency: number): DroneTradeOutput {
  const output = calculateDroneTradeOutputForEfficiency(target, equivalentEfficiency);
  return { lmd: output.lmd, goldValue: output.pure_gold };
}

export function droneTradeOutputForShift(input: {
  powerStations: PowerStationContribution[];
  durationHours: number;
  target: DroneTradeTarget;
}): DroneTradeOutput & DroneProduction {
  const output = droneDailyProductionForActualShift({
    powerStations: input.powerStations,
    durationHours: input.durationHours,
    target: { room: "trading", index: 1, profile: input.target },
  });
  return {
    drones: output.drones,
    equivalentEfficiency: output.equivalentEfficiency,
    lmd: output.lmd,
    goldValue: output.pure_gold,
  };
}

export function powerStationsFromRotation(layout: BaseBlueprint, shift: RotationShift, plan?: MaaPlan) {
  return corePowerStationsFromRotation(layout, shift, plan);
}

/**
 * 由求解器 rotation 的房间行构造无人机目标。
 *
 * 不再按干员名打表：订单倍率直接取求解器的 `order_multiplier`，
 * 赤金系数用 `gold_equivalent_efficiency / total_efficiency` 反推
 * （求解器省略 0 值字段，缺失按 0 处理）。
 */
function evaluatedTradeProfile(
  level: 1 | 2 | 3,
  line: RotationShift["scores"]["room_lines"][number] | undefined,
): DroneTradeTarget {
  const orderMultiplier = positive(line?.order_multiplier) && line.order_multiplier > 0
    ? line.order_multiplier
    : 1;
  const total = positive(line?.total_efficiency) ? line.total_efficiency : 0;
  const goldEquivalent = positive(line?.gold_equivalent_efficiency) ? line.gold_equivalent_efficiency : 0;
  return {
    kind: "evaluated",
    level,
    orderMultiplier,
    goldValuePerBase: total > 0 ? goldEquivalent / total * 10_000 : 0,
  };
}

/** 每单位等效效率的龙门币产量，用于在多座贸易站中挑最优目标。 */
function tradeValuePerBase(profile: DroneTradeTarget): number {
  // bestTradeRoom 只产出 evaluated；normal 分支保留给其它调用形态。
  if (profile.kind === "evaluated") return NORMAL_TRADE_DAILY[profile.level] * profile.orderMultiplier;
  if (profile.kind === "normal") return NORMAL_TRADE_DAILY[profile.level];
  return 0;
}

function bestTradeRoom(
  layout: BaseBlueprint,
  plan: MaaPlan,
  shift: RotationShift,
): { target: DroneRoomTarget; outputTarget: DroneOutputTarget } | null {
  const rooms = layout.rooms.filter((room) => room.kind === "trade_post");
  return rooms.map((room, index) => {
    const level = room.level === 1 || room.level === 2 ? room.level : 3;
    const line = shift.scores.room_lines.find((candidate) => candidate.room_id === room.id);
    const profile = evaluatedTradeProfile(level, line);
    return {
      target: { room: "trading" as const, index: index + 1, roomId: room.id, product: "lmd" as const },
      outputTarget: { room: "trading" as const, index: index + 1, profile },
      priority: tradeValuePerBase(profile),
      level: room.level,
    };
  }).sort((left, right) => right.priority - left.priority || right.level - left.level)[0] ?? null;
}

function bestFactoryRoom(layout: BaseBlueprint, plan: MaaPlan, product: "gold" | "experience"): { target: DroneRoomTarget; outputTarget: DroneOutputTarget } | null {
  const rooms = layout.rooms.filter((room) => room.kind === "factory");
  const wanted = product === "gold"
    ? new Set(["Gold", "Pure Gold", "gold", "贵金属"])
    : new Set(["Battle Record", "battle_record", "作战记录"]);
  return rooms.map((room, index) => ({ room, index, maa: plan.rooms.manufacture?.[index] }))
    .filter(({ room, maa }) => wanted.has(maa?.product ?? "") || (room.product && "factory" in room.product && room.product.factory.recipe === (product === "gold" ? "gold" : "battle_record")))
    .sort((left, right) => right.room.level - left.room.level)
    .map(({ room, index }) => ({
      target: { room: "manufacture" as const, index: index + 1, roomId: room.id, product },
      outputTarget: { room: "manufacture" as const, index: index + 1, product },
    }))[0] ?? null;
}

function allocationForTarget(shift: RotationShift, powerStations: PowerStationContribution[], target: DroneRoomTarget, outputTarget: DroneOutputTarget): DroneShiftAllocation {
  const production = droneDailyProductionForActualShift({ powerStations, durationHours: shift.duration_hours, target: outputTarget });
  return {
    shiftIndex: shift.index,
    target,
    outputTarget,
    drones: production.drones,
    equivalentEfficiency: production.equivalentEfficiency,
    production,
    lmd: production.lmd,
    goldValue: production.pure_gold,
    experience: production.battle_records,
  };
}

export function chooseDroneAllocations(input: {
  layout: BaseBlueprint;
  plans: MaaPlan[];
  shifts: RotationShift[];
  dailyProduction: { lmd: number; pure_gold: number };
}): DroneShiftAllocation[] {
  const candidates = input.shifts.map((shift, position) => {
    const plan = input.plans[shift.index] ?? input.plans[position];
    if (!plan) return [];
    const powerStations = corePowerStationsFromRotation(input.layout, shift, plan);
    const trade = bestTradeRoom(input.layout, plan, shift);
    const gold = bestFactoryRoom(input.layout, plan, "gold");
    const experience = bestFactoryRoom(input.layout, plan, "experience");
    if (input.layout.template === "153") {
      if (experience) return [allocationForTarget(shift, powerStations, experience.target, experience.outputTarget)];
      if (trade) return [allocationForTarget(shift, powerStations, trade.target, trade.outputTarget)];
      return [];
    }
    return [
      ...(trade ? [allocationForTarget(shift, powerStations, trade.target, trade.outputTarget)] : []),
      ...(gold ? [allocationForTarget(shift, powerStations, gold.target, gold.outputTarget)] : []),
    ];
  });
  if (candidates.some((options) => options.length === 0)) return [];
  if (input.layout.template === "153") return candidates.map(([only]) => only);

  const totalHours = input.shifts.reduce((sum, shift) => sum + Math.max(0, shift.duration_hours), 0);
  const dailyScale = totalHours > 0 ? 24 / totalHours : 1;
  let bestAllocations: DroneShiftAllocation[] = [];
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestLmdNotLower = false;
  const visit = (position: number, allocations: DroneShiftAllocation[]) => {
    if (position < candidates.length) {
      for (const candidate of candidates[position]) visit(position + 1, [...allocations, candidate]);
      return;
    }
    const lmd = input.dailyProduction.lmd + allocations.reduce((sum, item) => sum + item.production.lmd, 0) * dailyScale;
    const gold = input.dailyProduction.pure_gold + 5_000 + allocations.reduce((sum, item) => sum + item.production.pure_gold, 0) * dailyScale;
    const balance = lmd - gold;
    const distance = Math.abs(balance);
    const lmdNotLower = balance >= 0;
    if (distance < bestDistance - 1e-9 || (Math.abs(distance - bestDistance) <= 1e-9 && lmdNotLower && !bestLmdNotLower)) {
      bestAllocations = allocations;
      bestDistance = distance;
      bestLmdNotLower = lmdNotLower;
    }
  };
  visit(0, []);
  return bestAllocations;
}

export function applyDroneAllocationsToMaa(input: { layout: BaseBlueprint; maa: MaaJson; rotation: RotationJson }): MaaJson {
  const production = input.rotation.daily.production;
  const maa = structuredClone(input.maa);
  const allocations = chooseDroneAllocations({
    layout: input.layout,
    plans: maa.plans,
    shifts: input.rotation.shifts,
    dailyProduction: { lmd: production?.lmd ?? 0, pure_gold: (production?.pure_gold ?? 0) + (production?.equivalent_gold ?? 0) },
  });
  for (const allocation of allocations) {
    const position = input.rotation.shifts.findIndex((shift) => shift.index === allocation.shiftIndex);
    const sourcePlanIndex = maa.plans[allocation.shiftIndex] ? allocation.shiftIndex : position;
    if (!maa.plans[sourcePlanIndex]) continue;
    const storagePlan = maa.plans[droneStoragePlanIndex(sourcePlanIndex, maa.plans.length)];
    if (!storagePlan) continue;
    storagePlan.drones = { ...storagePlan.drones, enable: true, room: allocation.target.room, index: allocation.target.index, order: "pre" };
  }
  return maa;
}

export function droneProductionForRotation(input: { layout: BaseBlueprint; maa: MaaJson; rotation: RotationJson }): DroneDailyProduction {
  const allocations = chooseDroneAllocations({
    layout: input.layout,
    plans: input.maa.plans,
    shifts: input.rotation.shifts,
    dailyProduction: {
      lmd: input.rotation.daily.production?.lmd ?? 0,
      pure_gold: (input.rotation.daily.production?.pure_gold ?? 0) + (input.rotation.daily.production?.equivalent_gold ?? 0),
    },
  });
  const cycle = allocations.reduce<DroneDailyProduction>((sum, allocation) => ({
    lmd: sum.lmd + allocation.production.lmd,
    pure_gold: sum.pure_gold + allocation.production.pure_gold,
    battle_records: sum.battle_records + allocation.production.battle_records,
  }), { lmd: 0, pure_gold: 0, battle_records: 0 });
  const totalHours = input.rotation.shifts.reduce((sum, shift) => sum + (positive(shift.duration_hours) ? shift.duration_hours : 0), 0);
  return normalizeDroneDailyProduction(cycle, totalHours);
}
