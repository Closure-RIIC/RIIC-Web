import type { CSSProperties } from "react";

export const OPERATOR_NAME_SIZE_CLASS = "text-xs max-sm:text-[10px]";

export const LEVEL_DIAMOND_METRICS = {
  list: { height: 20, width: 10, gap: 2 },
  listMobile: { height: 16, width: 8, gap: 1.5 },
  compact: { height: 14, width: 7.5, gap: 1.5 },
} as const;

export type LevelDiamondVariant = "list" | "compact";

export function levelDiamondCount(level?: number): number {
  if (!level || !Number.isFinite(level)) return 0;
  return Math.max(1, Math.min(Math.trunc(level), 5));
}

export const ROOM_GRID_TONES = {
  control: {
    color: "#D58A32",
    opacity: 0.15,
    fadeStart: "8%",
  },
  default: {
    color: "#52B8E8",
    opacity: 0.09,
    fadeStart: "30%",
  },
} as const;

export function roomGridTone(group: string) {
  return group === "control" ? ROOM_GRID_TONES.control : ROOM_GRID_TONES.default;
}

export const COMPACT_OPERATOR_SIZE_CLASS =
  "[--operator-slot-size:clamp(64px,5.9vw,76px)]";

export const COMPACT_OPERATOR_ROW_CLASS =
  "flex items-start justify-start gap-2";

export const COMPACT_GRID_CLASS = "flex items-stretch gap-3";
export const COMPACT_COLUMN_CLASS = "flex min-w-0 flex-col gap-3";
export const COMPACT_DORM_WRAPPER_CLASS = "flex min-h-0 flex-1";
export const COMPACT_DORM_OPERATOR_AREA_CLASS =
  "flex min-h-0 flex-1 items-center";

export const COMPACT_CARD_CLASS =
  "infra-room-surface relative flex flex-col justify-start gap-2 overflow-hidden px-3 py-2";

export const COMPACT_POWER_CARD_CLASS =
  "infra-room-surface relative grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 overflow-hidden px-3 py-2";

export const COMPACT_POWER_OPERATOR_ROW_CLASS =
  "flex items-start justify-end gap-2";

export const COMPACT_HEADER_CLASS =
  "flex h-7 shrink-0 items-center gap-1.5";

export const COMPACT_ROOM_TITLE_CLASS =
  "shrink-0 whitespace-nowrap text-sm font-medium tracking-[-0.02em] text-white";

export const COMPACT_ROOM_BACKGROUND_CLASS =
  "infra-room-emblem pointer-events-none absolute inset-0 bg-no-repeat";

export const COMPACT_ROOM_BACKGROUND_STYLE = {
  backgroundPosition: "-18px center",
  backgroundSize: "auto 100%",
} satisfies CSSProperties;

const PRODUCT_FALLBACK =
  "border-white/20 text-white bg-[#3C3C3C]/70";

const TRADE_ACCENT: Record<string, string> = {
  gold: "infra-room-value border-transparent bg-transparent text-[#22BBFF]",
  originium: "infra-room-value border-transparent bg-transparent text-[#fb7e7e]",
};

const FACTORY_ACCENT: Record<string, string> = {
  all: "border-transparent bg-[#FFD800] text-[#313131]",
  gold: "infra-room-value border-transparent bg-transparent text-[#FFD800]",
  battle_record: "infra-room-value border-transparent bg-transparent text-[#4DB9FF]",
  originium: "infra-room-value border-transparent bg-transparent text-[#fb7e7e]",
};

export function compactTradeAccent(order: string) {
  return TRADE_ACCENT[order] ?? PRODUCT_FALLBACK;
}

export function compactFactoryAccent(recipe: string) {
  return FACTORY_ACCENT[recipe] ?? PRODUCT_FALLBACK;
}
