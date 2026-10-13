import layout153 from "./layouts/153.json";
import layout243 from "./layouts/243.json";
import layout252 from "./layouts/252.json";
import layout333 from "./layouts/333.json";
import layout342 from "./layouts/342.json";
import { BaseBlueprint, BlueprintRoom, PresetDef, RoomKind, TradeProduct } from "./types";
import { factoryRecipeFromMaaProduct, normalizeProductForLevel, type FactoryRecipe } from "./factory-recipes";

export { factoryRecipeFromMaaProduct };
export type { FactoryRecipe } from "./factory-recipes";
export type TradeOrder = TradeProduct["trade"]["order"];

export const PRESETS: PresetDef[] = [
  { label: "243", trading: 2, manufacture: 4, power: 3, layout: layout243 as BaseBlueprint },
  { label: "153", trading: 1, manufacture: 5, power: 3, layout: layout153 as BaseBlueprint },
  { label: "333", trading: 3, manufacture: 3, power: 3, layout: layout333 as BaseBlueprint },
  { label: "252", trading: 2, manufacture: 5, power: 2, layout: layout252 as BaseBlueprint },
  { label: "342", trading: 3, manufacture: 4, power: 2, layout: layout342 as BaseBlueprint },
];

export const FACTORY_RECIPE_OPTIONS: { value: FactoryRecipe; label: string }[] = [
  { value: "gold", label: "贵金属" },
  { value: "battle_record", label: "作战记录" },
  { value: "originium", label: "源石碎片" },
];

export const TRADE_ORDER_OPTIONS: { value: TradeOrder; label: string }[] = [
  { value: "gold", label: "龙门商法" },
  { value: "originium", label: "开采协力" },
];

export function buildBlueprint(preset: PresetDef): BaseBlueprint {
  return structuredClone(preset.layout);
}

export function roomSummary(layout: BaseBlueprint): string {
  const trade = layout.rooms.filter((room) => room.kind === "trade_post").length;
  const manu = layout.rooms.filter((room) => room.kind === "factory").length;
  const power = layout.rooms.filter((room) => room.kind === "power_plant").length;
  return `${trade} 贸易 / ${manu} 制造 / ${power} 发电`;
}

export function hasUnlockedFactoryRecipes(layout: BaseBlueprint): boolean {
  return layout.rooms.some((room) => room.kind === "factory" && room.level >= 3);
}

export function updateFactoryRecipe(layout: BaseBlueprint, roomId: string, recipe: FactoryRecipe): BaseBlueprint {
  const recipeUnlocked = recipe !== "originium" || hasUnlockedFactoryRecipes(layout);
  return {
    ...layout,
    scenario: structuredClone(layout.scenario),
    rooms: layout.rooms.map((room) => {
      if (room.id !== roomId || room.kind !== "factory") return structuredClone(room);
      if (!recipeUnlocked) return structuredClone(room);
      return {
        ...structuredClone(room),
        product: { factory: { recipe } },
      };
    }),
  };
}

export function updateTradeOrder(layout: BaseBlueprint, roomId: string, order: TradeOrder): BaseBlueprint {
  return {
    ...layout,
    scenario: structuredClone(layout.scenario),
    rooms: layout.rooms.map((room) => {
      if (room.id !== roomId || room.kind !== "trade_post") return structuredClone(room);
      if (normalizeProductForLevel(room.level, order) !== order) return structuredClone(room);
      return {
        ...structuredClone(room),
        product: { trade: { order } },
      };
    }),
  };
}

export function maxRoomLevel(kind: RoomKind): number {
  return kind === "control_center" || kind === "dormitory" ? 5 : 3;
}

export function updateRoomLevel(layout: BaseBlueprint, roomId: string, level: number): BaseBlueprint {
  const target = layout.rooms.find((room) => room.id === roomId);
  const maxLevel = target ? maxRoomLevel(target.kind) : 3;
  const nextLevel = Math.max(1, Math.min(maxLevel, Math.trunc(level)));
  const rooms = layout.rooms.map((room) => {
    if (room.id !== roomId) return structuredClone(room);
    const nextRoom = { ...structuredClone(room), level: nextLevel };
    if (nextRoom.kind === "trade_post") {
      nextRoom.product = { trade: { order: normalizeProductForLevel(nextLevel, tradeOrderFor(nextRoom)) } };
    }
    return nextRoom;
  });
  const factoryRecipesUnlocked = rooms.some((room) => room.kind === "factory" && room.level >= 3);

  return {
    ...layout,
    scenario: structuredClone(layout.scenario),
    rooms: factoryRecipesUnlocked
      ? rooms
      : rooms.map((room) => room.kind === "factory" && factoryRecipeFor(room) === "originium"
        ? { ...room, product: { factory: { recipe: "gold" as const } } }
        : room),
  };
}

export function factoryRecipeFor(room: BlueprintRoom): FactoryRecipe {
  if (room.product && "factory" in room.product) return room.product.factory.recipe;
  return "gold";
}

export function tradeOrderFor(room: BlueprintRoom): TradeOrder {
  if (room.product && "trade" in room.product) return room.product.trade.order;
  return "gold";
}

export function productLabel(room: BlueprintRoom): string | undefined {
  if (!room.product) return undefined;

  if ("factory" in room.product) {
    const recipe = room.product.factory.recipe;
    return FACTORY_RECIPE_OPTIONS.find((option) => option.value === recipe)?.label;
  }

  if ("trade" in room.product) {
    const order = room.product.trade.order;
    return TRADE_ORDER_OPTIONS.find((option) => option.value === order)?.label;
  }

  return undefined;
}

export function roomKindLabel(kind: RoomKind): string {
  const labels: Record<RoomKind, string> = {
    control_center: "控制中枢",
    trade_post: "贸易站",
    factory: "制造站",
    power_plant: "发电站",
    dormitory: "宿舍",
    office: "办公室",
    meeting_room: "会客室",
    workshop: "加工站",
    training_room: "训练室",
  };
  return labels[kind];
}

/* ── 发电量校验 ── */

const POWER_OUTPUT: Record<number, number> = { 1: 60, 2: 130, 3: 270 };

const POWER_CONSUMPTION: Partial<Record<RoomKind, Record<number, number>>> = {
  factory:       { 1: 10, 2: 30, 3: 60 },
  trade_post:    { 1: 10, 2: 30, 3: 60 },
  meeting_room:  { 1: 10, 2: 30, 3: 60 },
  workshop:      { 1: 10, 2: 10, 3: 10 },
  office:         { 1: 10, 2: 30, 3: 60 },
  training_room:  { 1: 10, 2: 30, 3: 60 },
  dormitory:      { 1: 10, 2: 20, 3: 30, 4: 45, 5: 65 },
};

export interface PowerBudget {
  ok: boolean;
  generated: number;
  consumed: number;
}

export function computePowerBudget(layout: BaseBlueprint): PowerBudget {
  let generated = 0;
  let consumed = 0;

  for (const room of layout.rooms) {
    const lv = room.level;
    if (room.kind === "power_plant") {
      generated += POWER_OUTPUT[lv] ?? 0;
    } else if (room.kind !== "control_center") {
      consumed += POWER_CONSUMPTION[room.kind]?.[lv] ?? 0;
    }
  }

  return { ok: generated >= consumed, generated, consumed };
}
