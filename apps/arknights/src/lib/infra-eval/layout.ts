function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keep the public layout intact while adapting its room kinds to the shipped WASM protocol. */
export function toNativeEvalLayout(layout: unknown): unknown {
  if (!isRecord(layout) || !Array.isArray(layout.rooms)) return layout;
  return {
    ...layout,
    rooms: layout.rooms.map(room => isRecord(room) && room.kind === "recycle"
      ? { ...room, kind: "recycling_station" }
      : room),
  };
}
