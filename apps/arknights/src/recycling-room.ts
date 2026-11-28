import type { BaseBlueprint, BlueprintRoom } from "@riic/arknights-domain/types";
import type { RoomRow } from "./schedule.ts";

export const RECYCLING_ROOM_ID = "recycling_station";
// 回收站：求解器 wire 名 `recycle`，全布局至多一座、等级 1–3、不带产物。
export type RecyclingRoom = { id: typeof RECYCLING_ROOM_ID; kind: "recycle"; level: 1 | 2 | 3 };

export function recyclingRoom(level: number = 3): RecyclingRoom {
  return { id: RECYCLING_ROOM_ID, kind: "recycle", level: Math.max(1, Math.min(3, Math.trunc(level))) as 1 | 2 | 3 };
}

export const RECYCLING_ROOM = recyclingRoom();
export type EditableRoom = BlueprintRoom | typeof RECYCLING_ROOM;

export function recyclingRoomCapacity(level: number): number {
  return level >= 2 ? 2 : 1;
}

export function manualEditableRooms(layout: BaseBlueprint, recyclingLevel?: number): EditableRoom[] {
  return [...withRecyclingRoomInLayout(layout, recyclingLevel).rooms];
}

/** 往求解器布局里补一座回收站；已存在则不重复添加。 */
export function withRecyclingRoomInLayout(layout: BaseBlueprint, recyclingLevel?: number): BaseBlueprint {
  if (layout.rooms.some((room) => room.kind === "recycle")) return layout;
  return { ...layout, rooms: [...layout.rooms, recyclingRoom(recyclingLevel)] };
}

export function withRecyclingRoom(rows: RoomRow[], room?: Pick<BlueprintRoom, "id" | "level">): RoomRow[] {
  if ((!rows.length && !room) || rows.some((row) => row.group === "recycle")) return rows;
  const { id, level } = room ?? RECYCLING_ROOM;
  return [...rows, {
    key: id, roomId: id, group: "recycle",
    groupLabel: "回收站", title: "回收站", index: 0, level,
    operators: [], operatorSlots: [], autofill: false,
    rule: "支持 MAA 排班与产量计算", suspicious: false,
  }];
}
