import type { RoomKind } from "@riic/arknights-domain/types";

/**
 * Operator slots per room kind and level.
 *
 * Source: building_data.json `rooms[kind].phases[].maxStationedNum`
 * (ArknightsGameData dataVersion 79.0.0). Keep in sync with
 * `manualRoomCapacity` in manual-schedule.ts.
 */
export function roomCapacity(kind: RoomKind, level: number, dormBeds?: number): number {
  switch (kind) {
    case "dormitory": return Math.max(1, Math.min(5, dormBeds ?? 5));
    case "control_center": return Math.max(1, Math.min(5, level));
    case "factory":
    case "trade_post": return Math.max(1, Math.min(3, level));
    case "meeting_room":
    case "training_room": return 2;
    case "recycle": return level >= 2 ? 2 : 1;
    default: return 1;
  }
}
