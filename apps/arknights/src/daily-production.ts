import type {
  BaseBlueprint,
  BlueprintRoom,
  MaaJson,
  MaaPlan,
  MaaRoom,
  RoomEfficiency,
  RotationJson,
  RotationShift,
} from "./types.ts";

export type DailyProductionUnavailableReason =
  | "missing-room-data"
  | "ambiguous-recipe"
  | "missing-drone-data";

export interface DailyProductionAmount {
  value: number | null;
  natural: number | null;
  drones: number | null;
  unavailableReason?: DailyProductionUnavailableReason;
}

export interface LmdOrderDailyProduction extends DailyProductionAmount {
  droneTrade: number | null;
}

export interface OrundumDailyProduction extends DailyProductionAmount {
  manufactureCapacity: number | null;
  tradeCapacity: number | null;
  manufactureDrones: number | null;
  tradeDrones: number | null;
  bottleneck: "manufacture" | "trade" | "balanced" | "none" | "unavailable";
}

export interface DailyProductionEstimate {
  lmdOrders: LmdOrderDailyProduction;
  gold: DailyProductionAmount;
  experience: DailyProductionAmount;
  shards: DailyProductionAmount;
  orundum: OrundumDailyProduction;
}

type FactoryRecipe = "gold" | "battle_record" | "originium" | "ambiguous";
type TradeOrder = "gold" | "originium" | "ambiguous";

interface ShiftRoom {
  blueprint: BlueprintRoom;
  maa?: MaaRoom;
  efficiency?: RoomEfficiency;
}

interface MutableAmount {
  natural: number;
  drones: number;
  unavailableReason?: DailyProductionUnavailableReason;
}

const TRADE_BASE_DAILY: Record<number, number> = {
  1: 10_000,
  2: 10_141,
  3: 10_265,
};

const EXPERIENCE_BASE_DAILY = 8_000;
const SHARD_BASE_DAILY = 24;
const ORUNDUM_ORDER_BASE_DAILY = 240;
const GOLD_VALUE_BASE_DAILY = 10_000;
const ORUNDUM_PER_SHARD = 10;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function unavailable(target: MutableAmount, reason: DailyProductionUnavailableReason) {
  target.unavailableReason ??= reason;
}

function planForShift(maa: MaaJson, shift: RotationShift, position: number): MaaPlan | undefined {
  return maa.plans[shift.index] ?? maa.plans[position];
}

function layoutRooms(layout: BaseBlueprint, kind: BlueprintRoom["kind"]): BlueprintRoom[] {
  return layout.rooms.filter((room) => room.kind === kind);
}

function roomLine(shift: RotationShift, roomId: string): RoomEfficiency | undefined {
  return shift.scores.room_lines.find((line) => line.room_id === roomId);
}

function roomAt(
  rooms: BlueprintRoom[],
  maaRooms: MaaRoom[] | undefined,
  shift: RotationShift,
  index: number
): ShiftRoom {
  const blueprint = rooms[index];
  return {
    blueprint,
    maa: maaRooms?.[index],
    efficiency: roomLine(shift, blueprint.id),
  };
}

function factoryRecipe(room: ShiftRoom): FactoryRecipe {
  const maaProduct = room.maa?.product;
  if (maaProduct !== undefined) {
    if (maaProduct === "Gold" || maaProduct === "Pure Gold" || maaProduct === "gold" || maaProduct === "贵金属") return "gold";
    if (maaProduct === "Battle Record" || maaProduct === "battle_record" || maaProduct === "作战记录") return "battle_record";
    if (maaProduct === "Originium Shard" || maaProduct === "originium" || maaProduct === "源石碎片") return "originium";
    return "ambiguous";
  }

  if (room.blueprint.product && "factory" in room.blueprint.product) {
    const recipe = room.blueprint.product.factory.recipe;
    return recipe === "all" ? "ambiguous" : recipe;
  }
  return "ambiguous";
}

function tradeOrder(room: ShiftRoom): TradeOrder {
  const maaProduct = room.maa?.product;
  if (maaProduct !== undefined) {
    if (maaProduct === "LMD" || maaProduct === "Gold" || maaProduct === "gold" || maaProduct === "龙门商法") return "gold";
    if (maaProduct === "Orundum" || maaProduct === "Originium Shard" || maaProduct === "originium" || maaProduct === "开采协力") return "originium";
    return "ambiguous";
  }

  if (room.blueprint.product && "trade" in room.blueprint.product) return room.blueprint.product.trade.order;
  return "ambiguous";
}

function finalEfficiency(efficiency: RoomEfficiency | undefined): number | null {
  if (!efficiency) return null;
  // serve 新输出：最终效率 = total_efficiency × order_multiplier（非贸易房倍率为 1）。
  const total = finite(efficiency.total_efficiency) ? efficiency.total_efficiency : undefined;
  if (total !== undefined) {
    const order = finite(efficiency.order_multiplier) ? efficiency.order_multiplier : 1;
    return total * order;
  }
  // 旧输出兜底：final_efficiency 本身已是含倍率最终值。
  return finite(efficiency.final_efficiency) ? efficiency.final_efficiency : null;
}

function finalizedAmount(source: MutableAmount): DailyProductionAmount {
  if (source.unavailableReason) {
    return {
      value: null,
      natural: null,
      drones: null,
      unavailableReason: source.unavailableReason,
    };
  }
  return {
    value: source.natural + source.drones,
    natural: source.natural,
    drones: source.drones,
  };
}

export function estimateDailyProduction({
  layout,
  maa,
  rotation,
}: {
  layout: BaseBlueprint;
  maa: MaaJson;
  rotation: RotationJson;
}): DailyProductionEstimate {
  const tradeRooms = layoutRooms(layout, "trade_post");
  const factoryRooms = layoutRooms(layout, "factory");
  const lmdOrders: MutableAmount = { natural: 0, drones: 0 };
  const gold: MutableAmount = { natural: 0, drones: 0 };
  const experience: MutableAmount = { natural: 0, drones: 0 };
  const shards: MutableAmount = { natural: 0, drones: 0 };
  const orundumTrade: MutableAmount = { natural: 0, drones: 0 };
  let droneTrade = 0;

  rotation.shifts.forEach((shift, position) => {
    const durationWeight = shift.duration_hours / 24;
    const plan = planForShift(maa, shift, position);
    if (!Number.isFinite(durationWeight) || durationWeight <= 0) return;

    tradeRooms.forEach((_, roomIndex) => {
      const room = roomAt(tradeRooms, plan?.rooms.trading, shift, roomIndex);
      const order = tradeOrder(room);
      if (order === "ambiguous") {
        unavailable(lmdOrders, "ambiguous-recipe");
        unavailable(orundumTrade, "ambiguous-recipe");
        return;
      }
      const multiplier = finalEfficiency(room.efficiency);
      if (multiplier === null) {
        unavailable(order === "gold" ? lmdOrders : orundumTrade, "missing-room-data");
        return;
      }
      const baseDaily = order === "gold"
        ? TRADE_BASE_DAILY[room.blueprint.level]
        : ORUNDUM_ORDER_BASE_DAILY;
      if (!finite(baseDaily)) {
        unavailable(order === "gold" ? lmdOrders : orundumTrade, "missing-room-data");
        return;
      }
      const output = baseDaily * multiplier * durationWeight;
      if (order === "gold") lmdOrders.natural += output;
      else orundumTrade.natural += output;
    });

    factoryRooms.forEach((_, roomIndex) => {
      const room = roomAt(factoryRooms, plan?.rooms.manufacture, shift, roomIndex);
      const recipe = factoryRecipe(room);
      if (recipe === "ambiguous") {
        unavailable(gold, "ambiguous-recipe");
        unavailable(experience, "ambiguous-recipe");
        unavailable(shards, "ambiguous-recipe");
        return;
      }
      const multiplier = finalEfficiency(room.efficiency);
      const target = recipe === "gold" ? gold : recipe === "battle_record" ? experience : shards;
      if (multiplier === null) {
        unavailable(target, "missing-room-data");
        return;
      }
      const baseDaily = recipe === "gold"
        ? GOLD_VALUE_BASE_DAILY
        : recipe === "battle_record"
          ? EXPERIENCE_BASE_DAILY
          : SHARD_BASE_DAILY;
      const output = baseDaily * multiplier * durationWeight;
      target.natural += output;
    });


  });

  // 轮换周期归一化：abc_12_12_12 等 36 小时周期（3×12h）折算回 24 小时等效每日产量。
  // 现有公式按 duration_hours / 24 加权，36h 周期会算成 1.5 天，这里整体乘 24/总时长。
  const totalDurationHours = rotation.shifts.reduce(
    (sum, shift) => sum + (Number.isFinite(shift.duration_hours) ? shift.duration_hours : 0),
    0,
  );
  const normalizeScale = totalDurationHours > 0 ? 24 / totalDurationHours : 1;
  if (normalizeScale !== 1) {
    for (const amount of [lmdOrders, gold, experience, shards, orundumTrade]) {
      amount.natural *= normalizeScale;
      amount.drones *= normalizeScale;
    }
    droneTrade *= normalizeScale;
  }

  const lmdOrderAmount = finalizedAmount(lmdOrders);
  const goldAmount = finalizedAmount(gold);
  const experienceAmount = finalizedAmount(experience);
  const shardAmount = finalizedAmount(shards);
  const tradeAmount = finalizedAmount(orundumTrade);
  const orundumUnavailableReason = shards.unavailableReason ?? orundumTrade.unavailableReason;
  const manufactureCapacity = shardAmount.value === null ? null : shardAmount.value * ORUNDUM_PER_SHARD;
  const tradeCapacity = tradeAmount.value;
  const orundumValue = orundumUnavailableReason || manufactureCapacity === null || tradeCapacity === null
    ? null
    : Math.min(manufactureCapacity, tradeCapacity);
  let bottleneck: OrundumDailyProduction["bottleneck"];
  if (orundumValue === null || manufactureCapacity === null || tradeCapacity === null) bottleneck = "unavailable";
  else if (manufactureCapacity === 0 && tradeCapacity === 0) bottleneck = "none";
  else if (Math.abs(manufactureCapacity - tradeCapacity) < 0.000_001) bottleneck = "balanced";
  else bottleneck = manufactureCapacity < tradeCapacity ? "manufacture" : "trade";

  const estimate = {
    lmdOrders: {
      ...lmdOrderAmount,
      droneTrade: lmdOrders.unavailableReason ? null : droneTrade,
    },
    gold: goldAmount,
    experience: experienceAmount,
    shards: shardAmount,
    orundum: {
      value: orundumValue,
      natural: orundumValue === null ? null : Math.min(shards.natural * ORUNDUM_PER_SHARD, orundumTrade.natural),
      drones: orundumValue === null
        ? null
        : Math.max(0, orundumValue - Math.min(shards.natural * ORUNDUM_PER_SHARD, orundumTrade.natural)),
      ...(orundumUnavailableReason ? { unavailableReason: orundumUnavailableReason } : {}),
      manufactureCapacity,
      tradeCapacity,
      manufactureDrones: shardAmount.drones === null ? null : shardAmount.drones * ORUNDUM_PER_SHARD,
      tradeDrones: tradeAmount.drones,
      bottleneck,
    },
  } satisfies DailyProductionEstimate;
  return estimate;
}
