import type { BaseBlueprint, BlueprintRoom } from "./types.ts";
import type { RoomRow } from "./schedule.ts";
import { normalizeFacilityDefaults, RECYCLING_ROOM_ID } from "./facility-defaults.ts";

export { RECYCLING_ROOM_ID, RECYCLING_ROOM } from "./facility-defaults.ts";
export type EditableRoom = BlueprintRoom;

export function manualEditableRooms(layout: BaseBlueprint): EditableRoom[] {
  return normalizeFacilityDefaults(layout).rooms;
}

export function withRecyclingRoom(rows: RoomRow[]): RoomRow[] {
  if (!rows.length || rows.some((row) => row.group === "recycling")) return rows;
  return [...rows, {
    key: RECYCLING_ROOM_ID, roomId: RECYCLING_ROOM_ID, group: "recycling",
    groupLabel: "回收站", title: "回收站", index: 0,
    level: 3, operators: [], operatorSlots: [], autofill: true,
    rule: "未配置干员时由 MAA 自动填充", suspicious: false,
  }];
}
