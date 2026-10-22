import type { BaseBlueprint, BlueprintRoom } from "@riic/arknights-domain/types";
import type { RoomRow } from "./schedule.ts";

export const RECYCLING_ROOM_ID = "recycling_station";
// An editor-only facility until the solver / upstream API defines its contract.
export type RecyclingRoom = { id: typeof RECYCLING_ROOM_ID; kind: "recycling"; level: 1 | 2 | 3 };

export function recyclingRoom(level: number = 3): RecyclingRoom {
  return { id: RECYCLING_ROOM_ID, kind: "recycling", level: Math.max(1, Math.min(3, Math.trunc(level))) as 1 | 2 | 3 };
}

export const RECYCLING_ROOM = recyclingRoom();
export type EditableRoom = BlueprintRoom | typeof RECYCLING_ROOM;

export function manualEditableRooms(layout: BaseBlueprint, recyclingLevel?: number): EditableRoom[] {
  return [...layout.rooms, recyclingRoom(recyclingLevel)];
}

export function withRecyclingRoom(rows: RoomRow[], recyclingLevel?: number): RoomRow[] {
  if (!rows.length || rows.some((row) => row.group === "recycling")) return rows;
  return [...rows, {
    key: RECYCLING_ROOM_ID, roomId: RECYCLING_ROOM_ID, group: "recycling",
    groupLabel: "回收站", title: "回收站", index: 0, level: recyclingRoom(recyclingLevel).level,
    operators: [], operatorSlots: [], autofill: false,
    rule: "仅保存手动配置，不参与产量计算或 MAA 导出", suspicious: false,
  }];
}
