import assert from "node:assert/strict";
import test from "node:test";
import { RECYCLING_ROOM, RECYCLING_ROOM_ID, withRecyclingRoom } from "./recycling-room.ts";
import { assignManualOperator, clearManualRoom, createManualScheduleDraft, findManualOperatorConflict, loadManualScheduleDraft, manualRoomCapacity, manualScheduleToMaa, persistManualScheduleDraft, reconcileManualScheduleDraft } from "./manual-schedule.ts";
import type { BaseBlueprint } from "./types.ts";

const layout: BaseBlueprint = { template: "test", drone_cap: 200, scenario: {}, rooms: [
  { id: "control", kind: "control_center", level: 5 },
  { id: "training_room", kind: "training_room", level: 3 },
] };

test("recycling assignments retain two slots through storage without changing solver layouts or MAA output", () => {
  const original = JSON.stringify(layout);
  let draft = reconcileManualScheduleDraft(createManualScheduleDraft(), layout);
  const exportBefore = manualScheduleToMaa(draft, layout, false);
  assert.equal(manualRoomCapacity(RECYCLING_ROOM), 2);
  draft = assignManualOperator({ draft, layout, shiftIndex: 0, roomId: RECYCLING_ROOM_ID, slotIndex: 1, operator: "阿米娅" }).draft;
  assert.deepEqual(draft.shifts[0]!.rooms[RECYCLING_ROOM_ID]!.operators, [null, "阿米娅"]);
  assert.equal(assignManualOperator({ draft, layout, shiftIndex: 0, roomId: RECYCLING_ROOM_ID, slotIndex: 2, operator: "陈" }).draft, draft);
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  persistManualScheduleDraft(storage, draft);
  const loaded = loadManualScheduleDraft(storage);
  assert.ok(loaded);
  const restored = reconcileManualScheduleDraft(loaded, layout);
  assert.deepEqual(restored.shifts[0]!.rooms[RECYCLING_ROOM_ID]!.operators, [null, "阿米娅"]);
  assert.deepEqual(manualScheduleToMaa(restored, layout, false), exportBefore);
  assert.equal(JSON.stringify(layout), original);
});

test("recycling participates in same-shift conflicts and clearing without affecting other shifts", () => {
  let draft = reconcileManualScheduleDraft(createManualScheduleDraft(), layout);
  draft = assignManualOperator({ draft, layout, shiftIndex: 0, roomId: "control", slotIndex: 0, operator: "阿米娅" }).draft;
  const request = { draft, layout, shiftIndex: 0, roomId: RECYCLING_ROOM_ID, slotIndex: 0, operator: "阿米娅" };
  const denied = assignManualOperator(request);
  assert.equal(denied.draft, draft);
  assert.equal(denied.conflict?.roomId, "control");
  const moved = assignManualOperator({ ...request, moveExisting: true }).draft;
  assert.equal(moved.shifts[0]!.rooms.control!.operators[0], null);
  assert.equal(findManualOperatorConflict(moved.shifts[0]!, "阿米娅", "control", 0)?.roomId, RECYCLING_ROOM_ID);
  assert.deepEqual(clearManualRoom(moved, layout, 0, RECYCLING_ROOM_ID).shifts[0]!.rooms[RECYCLING_ROOM_ID]!.operators, [null, null]);
  assert.deepEqual(moved.shifts[1], draft.shifts[1]);
});

test("the display helper keeps empty states and existing recycling assignments intact", () => {
  assert.deepEqual(withRecyclingRoom([]), []);
  const row = { key: "control", roomId: "control", group: "control" as const, groupLabel: "控制中枢", title: "控制中枢", index: 0, operators: [], operatorSlots: [], autofill: false, rule: "", suspicious: false };
  const rows = withRecyclingRoom([row]);
  assert.equal(rows.length, 2);
  assert.equal(rows[1]!.level, undefined);
  assert.equal(withRecyclingRoom(rows), rows);
});
