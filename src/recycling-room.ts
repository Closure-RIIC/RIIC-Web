import type { BaseBlueprint, BlueprintRoom } from "./types.ts";
import type { RoomRow } from "./schedule.ts";

export const RECYCLING_ROOM_ID = "recycling_station";
// An editor-only facility until the solver / upstream API defines its contract.
export const RECYCLING_ROOM = { id: RECYCLING_ROOM_ID, kind: "recycling" as const, level: 0 };
export type EditableRoom = BlueprintRoom | typeof RECYCLING_ROOM;

export function manualEditableRooms(layout: BaseBlueprint): EditableRoom[] {
  return [...layout.rooms, RECYCLING_ROOM];
}

export function withRecyclingRoom(rows: RoomRow[]): RoomRow[] {
  if (!rows.length || rows.some((row) => row.group === "recycling")) return rows;
  return [...rows, {
    key: RECYCLING_ROOM_ID, roomId: RECYCLING_ROOM_ID, group: "recycling",
    groupLabel: "回收站", title: "回收站", index: 0,
    operators: [], operatorSlots: [], autofill: false,
    rule: "仅保存手动配置，不参与产量计算或 MAA 导出", suspicious: false,
  }];
}
