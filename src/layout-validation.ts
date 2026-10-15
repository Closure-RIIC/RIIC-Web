import type { RoomKind } from "./types";

const MAX_DRONE_CAP = 0xffff_ffff;
const ROOM_MAX_LEVEL: Record<RoomKind, number> = {
  control_center: 5,
  trade_post: 3,
  factory: 3,
  power_plant: 3,
  dormitory: 5,
  office: 3,
  meeting_room: 3,
  workshop: 3,
  training_room: 3,
};
const ROOM_KINDS = new Set<RoomKind>(Object.keys(ROOM_MAX_LEVEL) as RoomKind[]);

type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const roomKind = (value: unknown): value is RoomKind => typeof value === "string" && ROOM_KINDS.has(value as RoomKind);

export function validateLayoutJson(value: unknown): string[] {
  if (!object(value)) return ["layout 必须是 JSON 对象。"];
  const errors: string[] = [];
  if (typeof value.template !== "string" || !value.template.trim()) errors.push("template 必须是非空字符串。");
  if (!Number.isInteger(value.drone_cap) || (value.drone_cap as number) < 0 || (value.drone_cap as number) > MAX_DRONE_CAP) {
    errors.push(`drone_cap 必须是 0–${MAX_DRONE_CAP} 的整数。`);
  }
  if (!object(value.scenario)) errors.push("scenario 必须是对象。");
  if (!Array.isArray(value.rooms) || value.rooms.length === 0) return [...errors, "rooms 必须是非空数组。"];

  const ids = new Set<string>();
  let controls = 0;
  let powerPlants = 0;
  const factoryRecipesUnlocked = value.rooms.some((room) => object(room) && room.kind === "factory" && Number(room.level) >= 3);
  value.rooms.forEach((room, index) => {
    const label = `rooms[${index}]`;
    if (!object(room)) return errors.push(`${label} 必须是对象。`);
    if (typeof room.id !== "string" || !room.id.trim()) {
      errors.push(`${label}.id 必须是非空字符串。`);
    } else if (room.id !== room.id.trim()) {
      errors.push(`${label}.id 不能包含首尾空格。`);
    } else if (ids.has(room.id)) {
      errors.push(`房间 ID 重复：${room.id}。`);
    } else {
      ids.add(room.id);
    }
    if (!roomKind(room.kind)) errors.push(`${label}.kind 不受支持。`);
    const maxLevel = roomKind(room.kind) ? ROOM_MAX_LEVEL[room.kind] : 5;
    if (!Number.isInteger(room.level) || (room.level as number) < 1 || (room.level as number) > maxLevel) {
      errors.push(`${label}.level 必须是 1–${maxLevel} 的整数。`);
    }
    if (room.kind === "control_center") controls += 1;
    if (room.kind === "power_plant") powerPlants += 1;
    if (room.kind === "trade_post") {
      const trade = object(room.product) && object(room.product.trade) ? room.product.trade : null;
      if (!trade || !["gold", "originium"].includes(String(trade.order))) errors.push(`${label} 缺少有效贸易订单。`);
      if (trade?.order === "originium" && Number(room.level) < 3) errors.push(`${label} 仅 3 级贸易站可使用开采协力。`);
    }
    if (room.kind === "factory") {
      const factory = object(room.product) && object(room.product.factory) ? room.product.factory : null;
      if (!factory || !["all", "gold", "battle_record", "originium"].includes(String(factory.recipe))) errors.push(`${label} 缺少有效制造配方。`);
      if (factory?.recipe === "originium" && !factoryRecipesUnlocked) {
        errors.push(`${label} 需至少一个 3 级制造站解锁源石碎片配方。`);
      }
    }
    if (room.kind === "dormitory" && room.dorm_beds !== undefined && (!Number.isInteger(room.dorm_beds) || (room.dorm_beds as number) < 1 || (room.dorm_beds as number) > 5)) {
      errors.push(`${label}.dorm_beds 必须是 1–5 的整数。`);
    }
  });
  if (controls !== 1) errors.push(`布局必须且只能包含一个控制中枢（当前 ${controls} 个）。`);
  if (powerPlants === 0) errors.push("布局至少需要一个发电站。");
  return errors;
}
