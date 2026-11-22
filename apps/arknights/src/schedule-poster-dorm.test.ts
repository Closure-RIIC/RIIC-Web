import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { BaseBlueprint } from "@riic/arknights-domain/types";
import { createManualScheduleDraft, manualScheduleToMaa } from "./manual-schedule.ts";
import { applyScheduleText, scheduleDraftToText } from "./schedule-poster-text.ts";
import { assignPosterDormOperator, posterDormOperators } from "./schedule-poster-dorm.ts";
import { createPosterDocument, posterDataOnly, readPosterFile } from "./schedule-poster-document.ts";

const layout = JSON.parse(readFileSync(new URL("../../../packages/arknights-domain/src/layouts/252.json", import.meta.url), "utf8")) as BaseBlueprint;
const names = ["森蚺", "塑心", "虎狼丸", "爱丽丝", "车尔尼", "锡兰"];

test("batch dorm text skips AUTO and reads multiple occupants vertically without changing the draft", () => {
  const draft = createManualScheduleDraft([12, 12]);
  const parsed = applyScheduleText("宿舍1：森蚺、塑心、虎狼丸、auto | =\n宿舍2：爱丽丝、车尔尼、auto | =", layout, draft, new Set(names));
  assert.deepEqual(parsed.errors, []);
  const before = structuredClone(parsed.draft);
  for (const index of [0, 1]) assert.deepEqual(posterDormOperators(layout, parsed.draft, index), ["森蚺", "爱丽丝", "塑心", "车尔尼", "虎狼丸", null]);
  assert.deepEqual(parsed.draft, before);
  const decoded = readPosterFile(JSON.stringify(posterDataOnly(createPosterDocument(layout, parsed.draft))));
  assert.deepEqual(posterDormOperators(layout, decoded.draft, 0), posterDormOperators(layout, parsed.draft, 0));
});

test("each of the six poster cards writes vertically and fills every other bed with AUTO", () => {
  let draft = createManualScheduleDraft([12, 12]);
  const otherShift = structuredClone(draft.shifts[1]);
  for (const [posterSlot, operator] of names.entries()) {
    const result = assignPosterDormOperator({ layout, draft, shiftIndex: 0, posterSlot, operator });
    assert.equal(result.conflict, null);
    draft = result.draft;
  }
  const expected = { dorm_1: [names[0], names[4]], dorm_2: [names[1], names[5]], dorm_3: [names[2]], dorm_4: [names[3]] };
  for (const [id, occupants] of Object.entries(expected)) {
    const assignment = draft.shifts[0]!.rooms[id]!;
    assert.deepEqual(assignment.operators, [...occupants, ...Array.from({ length: 5 - occupants.length }, () => null)]);
    assert.deepEqual(assignment.autofillSlots, Array.from({ length: 5 - occupants.length }, (_, index) => index + occupants.length));
    assert.equal(assignment.autofill, true);
  }
  assert.deepEqual(draft.shifts[1], otherShift);
  assert.deepEqual(posterDormOperators(layout, draft, 0), names);
  const roundTrip = applyScheduleText(scheduleDraftToText(layout, draft), layout, draft, new Set(names));
  assert.deepEqual(roundTrip.errors, []);
  assert.deepEqual(roundTrip.draft.shifts[0]!.rooms.dorm_1, draft.shifts[0]!.rooms.dorm_1);
  assert.equal(manualScheduleToMaa(draft, layout, false).plans[0]!.rooms.dormitory?.length, 4);
});

test("clearing a card restores AUTO and does not affect another shift or production room", () => {
  const draft = createManualScheduleDraft([12, 12]);
  draft.shifts[1]!.rooms.dorm_2 = { operators: [names[0], names[1]], autofill: false };
  draft.shifts[1]!.rooms.trade_1 = { operators: [names[5]] };
  const result = assignPosterDormOperator({ layout, draft, shiftIndex: 1, posterSlot: 0, operator: null });
  assert.equal(result.conflict, null);
  assert.deepEqual(result.draft.shifts[0], draft.shifts[0]);
  assert.deepEqual(result.draft.shifts[1]!.rooms.trade_1, draft.shifts[1]!.rooms.trade_1);
  assert.deepEqual(result.draft.shifts[1]!.rooms.dorm_1?.autofillSlots, [0, 1, 2, 3, 4]);
  assert.deepEqual(result.draft.shifts[1]!.rooms.dorm_2?.operators, [names[1], null, null, null, null]);
});

test("conflicts preserve the original draft until a move is confirmed", () => {
  const draft = createManualScheduleDraft([24]);
  draft.shifts[0]!.rooms.trade_1 = { operators: [names[0]] };
  const options = { layout, draft, shiftIndex: 0, posterSlot: 5, operator: names[0]! };
  const blocked = assignPosterDormOperator(options);
  assert.equal(blocked.draft, draft);
  assert.equal(blocked.conflict?.roomId, "trade_1");
  const moved = assignPosterDormOperator({ ...options, moveExisting: true });
  assert.equal(moved.conflict, null);
  assert.equal(moved.draft.shifts[0]!.rooms.trade_1?.operators[0], null);
  assert.equal(moved.draft.shifts[0]!.rooms.dorm_2?.operators[1], names[0]);
  assert.equal(draft.shifts[0]!.rooms.trade_1?.operators[0], names[0]);
});

test("old sixth-card data migrates to the shared draft on edit", () => {
  const draft = createManualScheduleDraft([24]);
  draft.shifts[0]!.rooms.dorm_1 = { operators: [names[0]], autofill: true };
  assert.deepEqual(posterDormOperators(layout, draft, 0, names[5]), [names[0], null, null, null, null, names[5]]);
  const result = assignPosterDormOperator({ layout, draft, shiftIndex: 0, posterSlot: 0, operator: names[1]!, legacyHanger: names[5] });
  assert.equal(result.draft.shifts[0]!.rooms.dorm_1?.operators[0], names[1]);
  assert.equal(result.draft.shifts[0]!.rooms.dorm_2?.operators[1], names[5]);
});

test("moving between dormitories and swapping within one dorm preserve valid AUTO markers", () => {
  const draft = createManualScheduleDraft([24]);
  draft.shifts[0]!.rooms.dorm_1 = { operators: [names[0], names[1]], autofill: true };
  const options = { layout, draft, shiftIndex: 0, posterSlot: 1, operator: names[0]! };
  assert.equal(assignPosterDormOperator(options).conflict?.roomId, "dorm_1");
  const moved = assignPosterDormOperator({ ...options, moveExisting: true }).draft;
  assert.equal(moved.shifts[0]!.rooms.dorm_1?.operators[0], null);
  assert.ok(moved.shifts[0]!.rooms.dorm_1?.autofillSlots?.includes(0));
  assert.equal(moved.shifts[0]!.rooms.dorm_2?.operators[0], names[0]);
  let full = createManualScheduleDraft([24]);
  for (const [posterSlot, operator] of names.entries()) full = assignPosterDormOperator({ layout, draft: full, shiftIndex: 0, posterSlot, operator }).draft;
  const swap = assignPosterDormOperator({ layout, draft: full, shiftIndex: 0, posterSlot: 0, operator: names[4]! });
  assert.equal(swap.conflict, null);
  const swapped = swap.draft;
  assert.deepEqual(swapped.shifts[0]!.rooms.dorm_1?.operators.slice(0, 2), [names[4], names[0]]);
  for (const room of layout.rooms.filter(room => room.kind === "dormitory")) {
    const assignment = swapped.shifts[0]!.rooms[room.id]!;
    assert.deepEqual(assignment.autofillSlots, assignment.operators.flatMap((name, index) => name ? [] : [index]));
  }
  assert.doesNotThrow(() => readPosterFile(JSON.stringify(posterDataOnly(createPosterDocument(layout, swapped)))));
});

test("poster capacity stays six and invalid targets leave the draft unchanged", () => {
  const draft = createManualScheduleDraft([24]);
  draft.shifts[0]!.rooms.dorm_1 = { operators: ["a", "b", "c", "d", "e"] };
  draft.shifts[0]!.rooms.dorm_2 = { operators: ["f", "g", "h"] };
  assert.deepEqual(posterDormOperators(layout, draft, 0), ["a", "f", "b", "g", "c", "h"]);
  for (const posterSlot of [-1, 6, 1.5]) assert.equal(assignPosterDormOperator({ layout, draft, shiftIndex: 0, posterSlot, operator: null }).draft, draft);
});
