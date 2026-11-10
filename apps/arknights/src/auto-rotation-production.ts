import { chooseDroneCandidateCombination, type DroneRoomTarget } from "@riic/arknights-domain/drone-allocation";
import { droneDailyProductionForActualShift, NORMAL_TRADE_DAILY, type DroneOutputTarget } from "@riic/arknights-domain/drone-production-core";
import type { AutoRotationResult } from "@riic/arknights-domain/auto-rotation";
import type { BaseBlueprint, RoomEfficiency } from "@riic/arknights-domain/types";
import { estimateDailyProductionForRoomSnapshots } from "./daily-production.ts";
import { dailyProductionGroups, estimateGroups } from "./daily-production-presentation.ts";
import type { ProductionSummaryPresentation } from "./production-summary-adapters.ts";
import type { AutoRotationQueue } from "./auto-rotation-presentation.ts";

export type AutoRotationDroneOverrides = Partial<Record<AutoRotationQueue, string | null>>;

export interface AutoQueueDroneAllocation {
  target: DroneRoomTarget;
  production: ReturnType<typeof droneDailyProductionForActualShift>;
  priority: number;
  level: number;
}

const QUEUES = ["main", "backup"] as const;
const ZERO_DRONES = { lmd: 0, pure_gold: 0, battle_records: 0 };
type DroneProduction = typeof ZERO_DRONES;
type DroneOption = { allocation?: AutoQueueDroneAllocation; production: DroneProduction };

function scaledProduction(production: DroneProduction, scale: number): DroneProduction {
  return { lmd: production.lmd * scale, pure_gold: production.pure_gold * scale, battle_records: production.battle_records * scale };
}

function queueInputs(result: AutoRotationResult, layout: BaseBlueprint, queue: AutoRotationQueue) {
  const states = new Map(result.rooms.map(room => [room.roomId, room[queue]]));
  const rooms = new Map(result.rooms.map(room => {
    const state = room[queue];
    const efficiency: RoomEfficiency | undefined = state.efficiency ?? (state.productionEfficiency === undefined ? undefined : { final_efficiency: state.productionEfficiency });
    return [room.roomId, { efficiency, productionPerDay: state.productionPerDay }] as const;
  }));
  const goldTradeRooms = layout.rooms.filter(room => room.kind === "trade_post" && room.product && "trade" in room.product && room.product.trade.order === "gold");
  // A missing zero field in an evaluated snapshot is known zero; a missing snapshot is unknown.
  const equivalentGoldKnown = goldTradeRooms.every(room => states.get(room.id)?.efficiency !== undefined);
  const equivalentGold = goldTradeRooms
    .reduce((sum, room) => sum + (states.get(room.id)?.efficiency?.gold_equivalent_efficiency ?? 0) * 10_000, 0);
  const powerRooms = layout.rooms.filter(room => room.kind === "power_plant");
  const powerKnown = powerRooms.every(room => states.get(room.id)?.powerChargeEfficiency !== undefined);
  const powerStations = powerRooms.map(room => {
    const state = states.get(room.id);
    const equivalentEfficiency = state?.powerChargeEfficiency ?? 0;
    return { equivalentEfficiency, working: Boolean(state?.operators.length) && equivalentEfficiency > 0 };
  });
  const candidates: AutoQueueDroneAllocation[] = [];
  let tradeIndex = 0;
  let factoryIndex = 0;
  for (const room of layout.rooms) {
    if (room.kind === "trade_post") tradeIndex += 1;
    if (room.kind === "factory") factoryIndex += 1;
    const state = states.get(room.id);
    const efficiency = rooms.get(room.id)?.efficiency;
    if (!state?.operators.length || !efficiency || !Number.isFinite(efficiency.final_efficiency)) continue;
    let target: DroneRoomTarget | undefined;
    let output: DroneOutputTarget | undefined;
    let priority = room.level;
    if (room.kind === "trade_post" && room.product && "trade" in room.product && room.product.trade.order === "gold" && efficiency.order_multiplier !== undefined) {
      const level = room.level === 1 || room.level === 2 ? room.level : 3;
      target = { room: "trading", index: tradeIndex, roomId: room.id, product: "lmd" };
      output = { room: "trading", index: tradeIndex, profile: {
        kind: "evaluated", level, orderMultiplier: efficiency.order_multiplier,
        goldValuePerBase: (efficiency.gold_output_multiplier ?? 0) * 10_000,
      } };
      priority = NORMAL_TRADE_DAILY[level] * efficiency.order_multiplier;
    } else if (room.kind === "factory" && room.product && "factory" in room.product) {
      const recipe = room.product.factory.recipe;
      if (recipe === "gold" || recipe === "battle_record") {
        const product = recipe === "gold" ? "gold" : "experience";
        target = { room: "manufacture", index: factoryIndex, roomId: room.id, product };
        output = { room: "manufacture", index: factoryIndex, product };
      }
    }
    if (target && output) candidates.push({ target, priority, level: room.level, production: droneDailyProductionForActualShift({ powerStations, durationHours: 24, target: output }) });
  }
  const best = (product: DroneRoomTarget["product"]) => candidates.filter(item => item.target.product === product).sort((a, b) => b.priority - a.priority || b.level - a.level)[0];
  const automaticOptions = layout.template === "153"
    ? [best("experience") ?? best("lmd")].filter((item): item is AutoQueueDroneAllocation => Boolean(item))
    : [best("lmd"), best("gold")].filter((item): item is AutoQueueDroneAllocation => Boolean(item));
  return {
    rooms, equivalentGold, equivalentGoldKnown, powerKnown, candidates, automaticOptions,
    drones: powerKnown ? droneDailyProductionForActualShift({
      powerStations, durationHours: 24, target: { room: "manufacture", index: 1, product: "gold" },
    }).drones : null,
  };
}

/** Whole-plan output weighted by both evaluation windows, independently of the viewed queue. */
export function autoRotationProduction(input: {
  result: AutoRotationResult;
  layout: BaseBlueprint;
  /** Per queue: undefined = automatic; null = disabled; string = explicit room. */
  selectedDroneRooms?: AutoRotationDroneOverrides;
}) {
  const { result, layout } = input;
  const queues = { main: queueInputs(result, layout, "main"), backup: queueInputs(result, layout, "backup") };
  const totalHours = result.hours[0] + result.hours[1];
  const estimate = estimateDailyProductionForRoomSnapshots({ layout, snapshots: QUEUES.map((queue, index) => ({
    durationHours: result.hours[index], rooms: queues[queue].rooms,
  })) });
  const equivalentGoldKnown = QUEUES.every(queue => queues[queue].equivalentGoldKnown);
  const equivalentGold = QUEUES.reduce((sum, queue, index) => sum + queues[queue].equivalentGold * result.hours[index] / totalHours, 0);
  const canBalance = estimate.lmdOrders.value !== null && estimate.gold.value !== null && equivalentGoldKnown;
  const wanted = QUEUES.map(queue => {
    const selected = input.selectedDroneRooms?.[queue];
    return selected === undefined ? queues[queue].automaticOptions : queues[queue].candidates.filter(candidate => candidate.target.roomId === selected);
  });
  const missingPower = QUEUES.some((queue, index) => !queues[queue].powerKnown && wanted[index].length > 0);
  const automaticReady = layout.template === "153" || (canBalance && !missingPower);
  const options: DroneOption[][] = QUEUES.map((queue, index) => {
    const selected = input.selectedDroneRooms?.[queue];
    const available = queues[queue].powerKnown && (selected !== undefined || automaticReady) ? wanted[index] : [];
    return available.length ? available.map(allocation => ({
      allocation,
      // The shared allocator consumes actual period amounts before normalizing the whole cycle.
      production: scaledProduction(allocation.production, result.hours[index] / 24),
    })) : [{ allocation: undefined, production: ZERO_DRONES }];
  });
  const allocations = layout.template === "153" ? options.map(([first]) => first) : chooseDroneCandidateCombination({
    candidates: options, totalHours,
    dailyProduction: { lmd: estimate.lmdOrders.value ?? 0, pure_gold: (estimate.gold.value ?? 0) + equivalentGold },
  });
  const drone = allocations.reduce((sum, allocation) => ({
    lmd: sum.lmd + allocation.production.lmd * 24 / totalHours,
    pure_gold: sum.pure_gold + allocation.production.pure_gold * 24 / totalHours,
    battle_records: sum.battle_records + allocation.production.battle_records * 24 / totalHours,
  }), { ...ZERO_DRONES });
  // Shared accounting keeps equivalent gold and the daily 5000 gold-value allowance consistent with timed plans.
  const production = {
    lmd: estimate.lmdOrders.value ?? 0, pure_gold: estimate.gold.value ?? 0,
    battle_records: estimate.experience.value ?? 0, originium_shards: estimate.shards.value ?? 0,
    orundum: estimate.orundum.value ?? 0, equivalent_gold: equivalentGold,
  };
  const unavailable = estimateGroups(estimate, drone);
  const groups = dailyProductionGroups(estimate, production, drone).map(group => {
    const fallback = unavailable.find(item => item.id === group.id)!;
    return {
      ...group, source: "estimate" as const,
      primary: fallback.primary.amount.value === null ? fallback.primary : group.primary,
      ...(fallback.supporting?.amount.value === null ? { supporting: fallback.supporting } : {}),
    };
  });
  if (!equivalentGoldKnown) {
    const gold = groups.find(group => group.id === "lmd")?.supporting;
    if (gold) {
      gold.amount = { ...gold.amount, value: null, natural: null, unavailableReason: gold.amount.unavailableReason ?? "missing-room-data" };
      gold.rows = gold.rows.map(([label, value, unit]) => [label, /等效赤金|总产出/.test(label) ? null : value, unit]);
    }
  }
  const possibleTargets = QUEUES.flatMap((queue, index) => {
    const unresolved = !queues[queue].powerKnown || (input.selectedDroneRooms?.[queue] === undefined && !automaticReady && missingPower);
    return unresolved ? wanted[index] : [];
  });
  const missingDroneData = possibleTargets.length > 0;
  if (missingDroneData) {
    const withoutDroneTotal = (product: typeof groups[number]["primary"]) => ({
      ...product,
      amount: { ...product.amount, value: null, drones: null, unavailableReason: product.amount.unavailableReason ?? "missing-drone-data" as const },
      rows: product.rows.map(([label, value, unit]): [string, number | null, string] => [label, /无人机|总产出/.test(label) ? null : value, unit]),
    });
    for (const group of groups.filter(group => group.id !== "orundum")) {
      const output = group.id === "experience" ? "battle_records" : "lmd";
      if (possibleTargets.some(candidate => candidate.production[output] > 0)) group.primary = withoutDroneTotal(group.primary);
      if (group.supporting && possibleTargets.some(candidate => candidate.production.pure_gold > 0)) group.supporting = withoutDroneTotal(group.supporting);
    }
  }
  const presentation: ProductionSummaryPresentation = {
    source: "estimate", groups, detailsAvailable: true, solverProduction: null, droneProduction: missingDroneData ? undefined : drone,
  };
  return {
    presentation,
    queues: {
      main: { ...queues.main, allocation: allocations[0]?.allocation },
      backup: { ...queues.backup, allocation: allocations[1]?.allocation },
    },
    drones: QUEUES.every(queue => queues[queue].drones !== null)
      ? QUEUES.reduce((sum, queue, index) => sum + queues[queue].drones! * result.hours[index] / totalHours, 0)
      : null,
  };
}
