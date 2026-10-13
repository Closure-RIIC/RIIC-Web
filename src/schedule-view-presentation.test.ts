import assert from "node:assert/strict";
import test from "node:test";

import * as presentation from "./schedule-view-presentation.ts";
import { planToRows } from "./schedule.ts";
import {
  COMPACT_CARD_CLASS,
  COMPACT_HEADER_CLASS,
  COMPACT_OPERATOR_ROW_CLASS,
  COMPACT_OPERATOR_SIZE_CLASS,
  COMPACT_ROOM_TITLE_CLASS,
  LEVEL_DIAMOND_METRICS,
  OPERATOR_NAME_SIZE_CLASS,
  ROOM_GRID_TONES,
  compactFactoryAccent,
  compactTradeAccent,
  levelDiamondCount,
  roomGridTone,
} from "./schedule-view-presentation.ts";

test("uses the smaller operator name size in both schedule views", () => {
  assert.equal(OPERATOR_NAME_SIZE_CLASS, "text-xs max-sm:text-[10px]");
});

test("defines narrow level diamonds for list, mobile, and compact views", () => {
  assert.deepEqual(LEVEL_DIAMOND_METRICS, {
    list: { height: 20, width: 10, gap: 2 },
    listMobile: { height: 16, width: 8, gap: 1.5 },
    compact: { height: 14, width: 7.5, gap: 1.5 },
  });
  assert.equal(levelDiamondCount(undefined), 0);
  assert.equal(levelDiamondCount(1), 1);
  assert.equal(levelDiamondCount(3), 3);
  assert.equal(levelDiamondCount(7), 5);
});

test("uses an orange control grid and a pale blue grid everywhere else", () => {
  assert.deepEqual(roomGridTone("control"), ROOM_GRID_TONES.control);
  assert.deepEqual(roomGridTone("trading"), ROOM_GRID_TONES.default);
  assert.deepEqual(roomGridTone("manufacture"), ROOM_GRID_TONES.default);
  assert.deepEqual(roomGridTone("dormitory"), ROOM_GRID_TONES.default);
});

test("keeps compact operators responsive, left aligned, and eight pixels apart", () => {
  assert.equal(
    COMPACT_OPERATOR_SIZE_CLASS,
    "[--operator-slot-size:clamp(64px,5.9vw,76px)]",
  );
  assert.equal(
    COMPACT_OPERATOR_ROW_CLASS,
    "flex items-start justify-start gap-2",
  );
});

test("widens the compact two-column stack and includes processing", () => {
  assert.equal(
    presentation.COMPACT_GRID_CLASS,
    "flex items-stretch gap-3",
  );
  assert.equal(
    presentation.COMPACT_COLUMN_CLASS,
    "flex min-w-0 flex-col gap-3",
  );
  const rows = planToRows({
    name: "compact rooms",
    rooms: {
      processing: [{ operators: [] }],
      power: [{ operators: [] }],
      dormitory: [{ operators: [] }],
    },
  });
  assert.deepEqual(rows.map((row) => row.group).sort(), ["dormitory", "power", "processing"]);
});

test("stretches compact columns and lets dormitories share remaining height", () => {
  assert.equal(
    presentation.COMPACT_DORM_WRAPPER_CLASS,
    "flex min-h-0 flex-1",
  );
  assert.equal(
    presentation.COMPACT_DORM_OPERATOR_AREA_CLASS,
    "flex min-h-0 flex-1 items-center",
  );
});

test("right-aligns operators in horizontal three-power cards", () => {
  assert.equal(
    presentation.COMPACT_POWER_CARD_CLASS,
    "infra-room-surface relative grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 overflow-hidden px-3 py-2",
  );
  assert.equal(
    presentation.COMPACT_POWER_OPERATOR_ROW_CLASS,
    "flex items-start justify-end gap-2",
  );
});

test("reuses list room backgrounds in every compact card", () => {
  assert.equal(
    presentation.COMPACT_ROOM_BACKGROUND_CLASS,
    "infra-room-emblem pointer-events-none absolute inset-0 bg-no-repeat",
  );
  assert.deepEqual(presentation.COMPACT_ROOM_BACKGROUND_STYLE, {
    backgroundPosition: "-18px center",
    backgroundSize: "auto 100%",
  });
});

test("pins every compact room title to the shared top position", () => {
  assert.equal(
    COMPACT_CARD_CLASS,
    "infra-room-surface relative flex flex-col justify-start gap-2 overflow-hidden px-3 py-2",
  );
  assert.equal(
    COMPACT_HEADER_CLASS,
    "flex h-7 shrink-0 items-center gap-1.5",
  );
  assert.equal(
    COMPACT_ROOM_TITLE_CLASS,
    "shrink-0 whitespace-nowrap text-sm font-medium tracking-[-0.02em] text-white",
  );
});

test("renders highlighted products as text-only accents", () => {
  assert.equal(
    compactTradeAccent("gold"),
    "infra-room-value border-transparent bg-transparent text-[#22BBFF]",
  );
  assert.equal(
    compactFactoryAccent("gold"),
    "infra-room-value border-transparent bg-transparent text-[#FFD800]",
  );
  assert.equal(
    compactFactoryAccent("battle_record"),
    "infra-room-value border-transparent bg-transparent text-[#4DB9FF]",
  );
  assert.equal(
    compactTradeAccent("originium"),
    "infra-room-value border-transparent bg-transparent text-[#fb7e7e]",
  );
  assert.equal(
    compactFactoryAccent("originium"),
    "infra-room-value border-transparent bg-transparent text-[#fb7e7e]",
  );
});

test("preserves every other compact product treatment", () => {
  assert.equal(
    compactFactoryAccent("all"),
    "border-transparent bg-[#FFD800] text-[#313131]",
  );
  assert.equal(
    compactFactoryAccent("unknown"),
    "border-white/20 text-white bg-[#3C3C3C]/70",
  );
});
