import assert from "node:assert/strict";
import test from "node:test";
import { createMowerEditorDocument } from "./mower-editor.ts";
import { mowerSchedulePresentation } from "./mower-schedule-presentation.ts";

test("Mower presentation preserves source keys, holes, Free slots and document metadata", () => {
  const document = createMowerEditorDocument();
  document.plan1.room_1_1!.plans = [
    { agent: "", group: "group-a", replacement: ["砾"] },
    { agent: "Free", group: "", replacement: [] },
    { agent: "阿米娅", group: "group-b", replacement: ["凯尔希"] },
  ];
  const before = structuredClone(document);
  const { rows, layout } = mowerSchedulePresentation(document.plan1);
  const row = rows.find((item) => item.roomId === "room_1_1")!;
  assert.equal(rows.length, 19);
  assert.equal(row.title, "贸易站 B101");
  assert.equal(row.slotAssignments?.[0], undefined);
  assert.equal(row.slotAssignments?.[1]?.name, "Free");
  assert.equal(row.slotAssignments?.[2]?.name, "阿米娅");
  assert.equal(layout.rooms.find((item) => item.id === row.roomId)?.kind, "trade_post");
  assert.deepEqual(document, before);
});

test("empty backup facilities remain editable and production types retain their identity", () => {
  const { rows, layout } = mowerSchedulePresentation({ room_2_2: { name: "发电站", plans: [] } });
  assert.equal(rows.length, 19);
  assert.equal(rows.find((row) => row.roomId === "room_2_2")?.group, "power");
  assert.equal(rows.find((row) => row.roomId === "train")?.group, "training");
  assert.equal(layout.rooms.find((room) => room.id === "room_2_2")?.kind, "power_plant");
});

test("recycling uses the shared auxiliary room layout and preserves both operator slots", () => {
  const plan = { recycle: { name: "回收站", plans: [{ agent: "" }, { agent: "旅骨", group: "recycle-group", replacement: ["阿米娅"] }] } };
  const before = structuredClone(plan);
  const { rows, layout } = mowerSchedulePresentation(plan);
  const row = rows.find(row => row.roomId === "recycle")!;
  assert.equal(row.group, "recycling");
  assert.equal(row.title, "回收站");
  assert.equal(row.slotAssignments?.[0], undefined);
  assert.equal(row.slotAssignments?.[1]?.name, "旅骨");
  assert.equal(layout.rooms.find(room => room.id === "recycle")?.kind, "recycling_station");
  assert.deepEqual(plan, before);
  assert.equal(mowerSchedulePresentation({}).rows.find(row => row.group === "recycling")?.operators.length, 0);
});
