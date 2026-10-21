export type RoomVisual = {
  accent: string;
  level: string;
  background: string;
};

const ROOM_VISUALS: Record<string, RoomVisual> = {
  trading: {
    accent: "#22BBFF",
    level: "#22BBFF",
    background: "/images/building-room-emblems/emblem_trading.png",
  },
  manufacture: {
    accent: "#FFD800",
    level: "#FFD800",
    background: "/images/building-room-emblems/emblem_manufacture.png",
  },
  power: {
    accent: "#B8F03A",
    level: "#B8F03A",
    background: "/images/building-room-emblems/emblem_power.png",
  },
  control: {
    accent: "#FFFFFF",
    level: "#FFFFFF",
    background: "/images/building-room-emblems/emblem_control.png",
  },
  dormitory: {
    accent: "#016E65",
    level: "#FFFFFF",
    background: "/images/building-room-emblems/emblem_dormitory.png",
  },
  meeting: {
    accent: "#FFFFFF",
    level: "#FFFFFF",
    background: "/images/building-room-emblems/emblem_meeting.png",
  },
  processing: {
    accent: "#FFFFFF",
    level: "#FFFFFF",
    background: "/images/building-room-emblems/emblem_workshop.png",
  },
  hire: {
    accent: "#FFFFFF",
    level: "#FFFFFF",
    background: "/images/building-room-emblems/emblem_hire.png",
  },
  training: {
    accent: "#FFFFFF",
    level: "#FFFFFF",
    background: "/images/building-room-emblems/emblem_training.png",
  },
  recycling: {
    accent: "#FFFFFF",
    level: "#FFFFFF",
    background: "/images/building-room-emblems/emblem_training.png",
  },
  default: {
    accent: "#FFFFFF",
    level: "#FFFFFF",
    background: "/images/building-room-emblems/emblem_none.png",
  },
};

export function roomVisualFor(group: string): RoomVisual {
  return ROOM_VISUALS[group] ?? ROOM_VISUALS.default;
}

const LIGHT_SURFACE_ROOM_ACCENTS: Record<string, string> = {
  trading: ROOM_VISUALS.trading.accent,
  manufacture: ROOM_VISUALS.manufacture.accent,
  power: ROOM_VISUALS.power.accent,
  control: "#D58A32",
  dormitory: ROOM_VISUALS.dormitory.accent,
  meeting: "#71717A",
  processing: "#71717A",
  hire: "#71717A",
  training: "#71717A",
  recycling: "#71717A",
  default: "#71717A",
};

/** Facility identity colour adapted from the dark schedule board for light surfaces. */
export function roomLightAccentFor(group: string): string {
  return LIGHT_SURFACE_ROOM_ACCENTS[group] ?? LIGHT_SURFACE_ROOM_ACCENTS.default;
}
