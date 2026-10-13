import type { BaseBlueprint } from "./types.ts";

export const DEFAULT_DRONE_CAP = 250;
export const RECYCLING_ROOM_ID = "recycling_station";
export const RECYCLING_ROOM = { id: RECYCLING_ROOM_ID, kind: "recycling_station" as const, level: 3 };

/** Upgrade layouts saved before the recycling facility was part of the blueprint. */
export function normalizeFacilityDefaults(layout: BaseBlueprint): BaseBlueprint {
  return {
    ...layout,
    drone_cap: layout.drone_cap == null || layout.drone_cap === 235 ? DEFAULT_DRONE_CAP : layout.drone_cap,
    rooms: layout.rooms.some((room) => room.kind === "recycling_station")
      ? layout.rooms
      : [...layout.rooms, { ...RECYCLING_ROOM }],
  };
}
