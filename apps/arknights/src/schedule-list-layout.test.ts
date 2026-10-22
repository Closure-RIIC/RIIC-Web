import assert from "node:assert/strict";
import test from "node:test";

import {
  LIST_FUNCTIONAL_GROUP_GAP_PX,
  LIST_MEETING_OPERATOR_WIDTH_PX,
  LIST_OPERATOR_GAP_MAX_PX,
  LIST_OPERATOR_FRAME_SIZE_PX,
  LIST_OPERATOR_ORIGIN_PX,
  buildListScheduleGroups,
  buildMobileListScheduleGroups,
  listFunctionalFacilityGridClass,
  listFunctionalOperatorPosition,
  listFunctionalOperatorPlacementClass,
  listFunctionalRoomSpanClass,
  listMobileOperatorGridClass,
  listRoomHeightClass,
  listRoomTitleSizeClass,
  listRoomUsesAlignedOperatorOrigin,
} from "./schedule-list-layout.ts";
import type { RoomGroup, RoomRow } from "./schedule.ts";

function roomRow(group: RoomGroup, groupLabel: string, index = 0): RoomRow {
  return {
    key: `${group}-${index}`,
    group,
    groupLabel,
    index,
    roomId: `${group}-${index}`,
    title: groupLabel,
    operators: [],
    operatorSlots: [],
    autofill: false,
    rule: "",
    suspicious: false,
  };
}

test("places processing in the ordered functional facility group", () => {
  const groups = buildListScheduleGroups([
    roomRow("control", "控制中枢"),
    roomRow("power", "发电站"),
    roomRow("hire", "办公室"),
    roomRow("processing", "加工站"),
    roomRow("meeting", "会客室"),
    roomRow("training", "训练室"),
    roomRow("dormitory", "宿舍"),
  ]);

  assert.deepEqual(groups.map((group) => group.label), [
    "控制中枢",
    "功能设施",
    "宿舍",
  ]);
  assert.deepEqual(
    groups.find((group) => group.label === "功能设施")?.rows.map((row) => row.group),
    ["power", "training", "meeting", "hire", "processing"],
  );
});

test("keeps auxiliary rooms paired on separate rows in two-power layouts", () => {
  const groups = buildListScheduleGroups([
    roomRow("meeting", "会客室"),
    roomRow("power", "发电站", 0),
    roomRow("processing", "加工站"),
    roomRow("power", "发电站", 1),
    roomRow("hire", "办公室"),
    roomRow("training", "训练室"),
  ]);

  assert.deepEqual(
    groups.find((group) => group.label === "功能设施")?.rows.map((row) => row.group),
    ["power", "power", "training", "meeting", "hire", "processing"],
  );
});

test("orders mobile list groups like the in-game assignment overview without dropping secondary rooms", () => {
  const groups = buildMobileListScheduleGroups([
    roomRow("trading", "贸易站"),
    roomRow("dormitory", "宿舍"),
    roomRow("power", "发电站"),
    roomRow("training", "训练室"),
    roomRow("control", "控制中枢"),
    roomRow("processing", "加工站"),
    roomRow("hire", "办公室"),
    roomRow("manufacture", "制造站"),
    roomRow("meeting", "会客室"),
  ]);

  assert.deepEqual(
    groups.map((group) => group.rows[0]?.group),
    ["control", "meeting", "manufacture", "trading", "power", "hire", "dormitory", "training", "processing"],
  );
  assert.deepEqual(groups.map((group) => group.label), [
    "控制中枢",
    "会客室",
    "制造站",
    "贸易站",
    "发电站",
    "办公室",
    "宿舍",
    "训练室",
    "加工站",
  ]);
});

test("aligns production operator origins with the control center", () => {
  assert.equal(listRoomUsesAlignedOperatorOrigin("control"), true);
  assert.equal(listRoomUsesAlignedOperatorOrigin("trading"), true);
  assert.equal(listRoomUsesAlignedOperatorOrigin("manufacture"), true);
  assert.equal(listRoomUsesAlignedOperatorOrigin("processing"), false);
  assert.equal(listRoomUsesAlignedOperatorOrigin("power"), false);
});

test("adds breathing room only to manufacturing and functional facility cards", () => {
  assert.equal(listRoomHeightClass("manufacture"), "h-[160px]");
  assert.equal(listRoomHeightClass("power"), "h-[128px]");
  assert.equal(listRoomHeightClass("meeting"), "h-[128px]");
  assert.equal(listRoomHeightClass("training"), "h-[128px]");
  assert.equal(listRoomHeightClass("processing"), "h-[128px]");
  assert.equal(listRoomHeightClass("trading"), "h-[144px]");
});

test("uses 18px list room titles for every room", () => {
  assert.equal(
    listRoomTitleSizeClass(),
    "text-[18px] max-sm:text-[16px]",
  );
});

test("fits five operator slots in one mobile row", () => {
  assert.equal(
    listMobileOperatorGridClass(),
    "max-[819px]:grid max-[819px]:w-full max-[819px]:max-w-[304px] max-[819px]:grid-cols-5 max-[819px]:[column-gap:0.375rem] max-[819px]:gap-y-2 max-[819px]:overflow-visible max-[819px]:pb-2",
  );
});

test("positions functional operators at 248px and clamps before a frame clips", () => {
  const singleSlotPosition = {
    columnGap: "clamp(0.75rem, 1.25vw, 1.25rem)",
    left: `max(0px, min(${LIST_OPERATOR_ORIGIN_PX}px, calc(100cqw - ${LIST_OPERATOR_FRAME_SIZE_PX}px)))`,
  };

  assert.deepEqual(listFunctionalOperatorPosition("power"), singleSlotPosition);
  assert.deepEqual(listFunctionalOperatorPosition("hire"), singleSlotPosition);
  assert.deepEqual(listFunctionalOperatorPosition("processing"), singleSlotPosition);
  assert.equal(listFunctionalOperatorPosition("manufacture"), undefined);
});

test("keeps meeting operators on the same origin and existing gap", () => {
  assert.deepEqual(listFunctionalOperatorPosition("meeting"), {
    columnGap: "clamp(0.75rem, 1.25vw, 1.25rem)",
    left: `max(0px, min(${LIST_OPERATOR_ORIGIN_PX}px, calc(100cqw - ${LIST_MEETING_OPERATOR_WIDTH_PX}px)))`,
  });
  assert.deepEqual(listFunctionalOperatorPosition("training"), {
    columnGap: "clamp(0.75rem, 1.25vw, 1.25rem)",
    left: `max(0px, min(${LIST_OPERATOR_ORIGIN_PX}px, calc(100cqw - ${LIST_MEETING_OPERATOR_WIDTH_PX}px)))`,
  });
});

test("uses a fixed three-column functional facility grid on desktop", () => {
  assert.equal(LIST_OPERATOR_ORIGIN_PX, 248);
  assert.equal(LIST_OPERATOR_FRAME_SIZE_PX, 80);
  assert.equal(LIST_OPERATOR_GAP_MAX_PX, 20);
  assert.equal(LIST_FUNCTIONAL_GROUP_GAP_PX, 12);
  assert.equal(
    LIST_MEETING_OPERATOR_WIDTH_PX,
    LIST_OPERATOR_FRAME_SIZE_PX * 2 + LIST_OPERATOR_GAP_MAX_PX,
  );
  assert.equal(
    listFunctionalOperatorPlacementClass("power"),
    "xl:absolute xl:inset-y-0",
  );
  assert.equal(listFunctionalOperatorPlacementClass("manufacture"), undefined);
  assert.equal(
    listFunctionalFacilityGridClass(),
    "xl:grid-cols-[repeat(24,minmax(0,1fr))]",
  );
  assert.equal(listFunctionalRoomSpanClass("power", 3), "xl:col-span-8");
  assert.equal(listFunctionalRoomSpanClass("power", 2), "xl:col-span-12");
  assert.equal(listFunctionalRoomSpanClass("training", 3), "xl:col-span-12");
  assert.equal(listFunctionalRoomSpanClass("meeting", 3), "xl:col-span-12");
  assert.equal(listFunctionalRoomSpanClass("hire", 3), "xl:col-span-8");
  assert.equal(listFunctionalRoomSpanClass("processing", 3), "xl:col-span-8");
  assert.equal(listFunctionalRoomSpanClass("hire", 2), "xl:col-span-12");
  assert.equal(listFunctionalRoomSpanClass("processing", 2), "xl:col-span-12");
  assert.equal(listFunctionalRoomSpanClass("training", 2), "xl:col-span-12");
  assert.equal(listFunctionalRoomSpanClass("meeting", 2), "xl:col-span-12");
  assert.equal(listFunctionalRoomSpanClass("manufacture", 3), undefined);
});
