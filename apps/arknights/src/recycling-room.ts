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

export function manualEditableRooms(layout: BaseBlueprint, recyclingLevel?: number): EditableRoom[] {
  // 预设布局已自带回收站；只有缺失时才补一座，避免出现两个同 id 的房间。
  if (layout.rooms.some((room) => room.kind === "recycle")) return [...layout.rooms];
  return [...layout.rooms, recyclingRoom(recyclingLevel)];
}

/** 往求解器布局里补一座回收站；已存在则不重复添加。 */
export function withRecyclingRoomInLayout(layout: BaseBlueprint, recyclingLevel?: number): BaseBlueprint {
  if (layout.rooms.some((room) => room.kind === "recycle")) return layout;
  return { ...layout, rooms: [...layout.rooms, recyclingRoom(recyclingLevel)] };
}

export function withRecyclingRoom(rows: RoomRow[], recyclingLevel?: number): RoomRow[] {
  if (!rows.length || rows.some((row) => row.group === "recycle")) return rows;
  return [...rows, {
    key: RECYCLING_ROOM_ID, roomId: RECYCLING_ROOM_ID, group: "recycle",
    groupLabel: "回收站", title: "回收站", index: 0, level: recyclingRoom(recyclingLevel).level,
    operators: [], operatorSlots: [], autofill: false,
    rule: "仅保存手动配置，不参与产量计算或 MAA 导出", suspicious: false,
  }];
}
