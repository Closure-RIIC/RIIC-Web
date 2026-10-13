import assert from "node:assert/strict";
import test from "node:test";

import {
  assignManualOperator,
  clearManualRoom,
  clearManualShift,
  createManualScheduleDraft,
  createManualScheduleDraftFromCalculator,
  layoutFromMaaSchedule,
  loadManualScheduleDraft,
  manualScheduleDraftContentEqual,
  manualShiftTimeRanges,
  manualScheduleToMaa,
  manualRoomCapacity,
  normalizeMaaScheduleForManualImport,
  parseMaaScheduleText,
  reconcileManualScheduleDraft,
  resizeManualScheduleDraft,
  resizeManualShiftDurations,
  setManualDormAutofill,
  updateManualShiftBoundary,
  moveManualShiftBoundaryByHour,
  snapManualShiftDurationsToHours,
  setManualDroneTarget,
  swapManualOperators,
} from "./manual-schedule.ts";
import type { BaseBlueprint, OperBoxEntry } from "./types.ts";

const layout: BaseBlueprint = {
  template: "243",
  drone_cap: 235,
  scenario: {},
  rooms: [
    { id: "control", kind: "control_center", level: 5 },
    { id: "trade_1", kind: "trade_post", level: 3, product: { trade: { order: "gold" } } },
    { id: "manu_1", kind: "factory", level: 3, product: { factory: { recipe: "battle_record" } } },
    { id: "dorm_1", kind: "dormitory", level: 5 },
    { id: "training_room", kind: "training_room", level: 3 },
  ],
};

const box: OperBoxEntry[] = ["菲亚梅塔", "但书", "巫恋"].map((name, index) => ({
  id: String(index), name, own: true, elite: 2, level: 80, potential: 1, rarity: 6,
}));

test("manual sorting swaps one room in one shift without mutating the source draft", () => {
  let draft = createManualScheduleDraft();
  for (const [slotIndex, operator] of ["但书", "巫恋"].entries()) {
    draft = assignManualOperator({ draft, layout, shiftIndex: 0, roomId: "trade_1", slotIndex, operator }).draft;
  }
  const before = structuredClone(draft);
  const swapped = swapManualOperators(draft, layout, 0, "trade_1", 0, 1);
  assert.deepEqual(draft, before);
  assert.deepEqual(swapped.shifts[0]?.rooms.trade_1?.operators.slice(0, 2), ["巫恋", "但书"]);
  assert.deepEqual(swapped.shifts.slice(1), before.shifts.slice(1));
  assert.equal(swapManualOperators(draft, layout, 0, "trade_1", -1, 1), draft);
  assert.equal(swapManualOperators(draft, layout, 0, "trade_1", 0.5, 1), draft);
  assert.equal(swapManualOperators(draft, layout, 0, "trade_1", 0, 3), draft);
});

test("manual draft defaults to independent 12/6/6 shifts and preserves filled shifts when resized", () => {
  const initial = createManualScheduleDraft();
  assert.deepEqual(initial.shifts.map((shift) => shift.durationHours), [12, 6, 6]);
  const assigned = assignManualOperator({
    draft: initial, layout, shiftIndex: 0, roomId: "trade_1", slotIndex: 0, operator: "但书",
  }).draft;
  const resized = resizeManualScheduleDraft(assigned, resizeManualShiftDurations([12, 6, 6], 4));
  assert.equal(resized.shifts[0]?.rooms.trade_1?.operators[0], "但书");
  assert.deepEqual(resized.shifts.map((shift) => shift.durationHours), [12, 6, 3, 3]);
});

test("manual room capacity follows control, trading and manufacturing room levels", () => {
  assert.equal(manualRoomCapacity({ kind: "control_center", level: 2, id: "control" } as never), 2);
  assert.equal(manualRoomCapacity({ kind: "control_center", level: 5, id: "control" } as never), 5);
  assert.equal(manualRoomCapacity({ kind: "trade_post", level: 1, id: "trade_1" } as never), 1);
  assert.equal(manualRoomCapacity({ kind: "factory", level: 2, id: "manu_1" } as never), 2);
  assert.equal(manualRoomCapacity({ kind: "factory", level: 5, id: "manu_1" } as never), 3);
});

test("manual shift boundaries use minute precision, stay contiguous and cover one day", () => {
  const durations = updateManualShiftBoundary("08:15", [12, 6, 6], 0, "19:59");
  assert.ok(durations);
  assert.deepEqual(manualShiftTimeRanges("08:15", durations), [
    { startTime: "08:15", endTime: "19:59", durationMinutes: 705 },
    { startTime: "20:00", endTime: "02:14", durationMinutes: 375 },
    { startTime: "02:15", endTime: "08:14", durationMinutes: 360 },
  ]);
  assert.equal(updateManualShiftBoundary("08:15", durations, 0, "02:15"), null);
});

test("hourly timeline boundaries snap, cannot cross and retain a complete day", () => {
  const source = [12, 6, 6];
  assert.deepEqual(moveManualShiftBoundaryByHour(source, 0, 9.4), [9, 9, 6]);
  assert.deepEqual(moveManualShiftBoundaryByHour(source, 0, 23), [17, 1, 6]);
  assert.deepEqual(moveManualShiftBoundaryByHour(source, 0, -5), [1, 17, 6]);
  assert.deepEqual(moveManualShiftBoundaryByHour(source, 1, 22.8), [12, 11, 1]);
  assert.deepEqual(source, [12, 6, 6]);
  assert.deepEqual(moveManualShiftBoundaryByHour([24], 0, 5), [24]);
  assert.deepEqual(moveManualShiftBoundaryByHour(source, 0, NaN), source);
  for (let count = 1; count <= 12; count++) {
    const hours = snapManualShiftDurationsToHours(resizeManualShiftDurations(source, count));
    assert.equal(hours.length, count);
    assert.equal(hours.reduce((sum, hour) => sum + hour, 0), 24);
    assert.ok(hours.every(hour => Number.isInteger(hour) && hour >= 1));
  }
  const legacy = [11.75, 6.25, 6];
  assert.deepEqual(snapManualShiftDurationsToHours(legacy), [12, 6, 6]);
  assert.deepEqual(legacy, [11.75, 6.25, 6]);
  assert.deepEqual(manualShiftTimeRanges("23:00", moveManualShiftBoundaryByHour(source, 0, 3)), [
    { startTime: "23:00", endTime: "01:59", durationMinutes: 180 },
    { startTime: "02:00", endTime: "16:59", durationMinutes: 900 },
    { startTime: "17:00", endTime: "22:59", durationMinutes: 360 },
  ]);
});

test("legacy manual drafts gain a start time and a 24-hour cycle", () => {
  const storage = {
    getItem: () => JSON.stringify({
      version: 2,
      activeShift: 0,
      fiammettaEnabled: false,
      shifts: [{ durationHours: 9, rooms: {}, fiammettaTarget: null }],
    }),
    setItem: () => undefined,
  };
  const draft = loadManualScheduleDraft(storage);
  assert.equal(draft?.version, 3);
  assert.equal(draft?.startTime, "08:00");
  assert.equal(draft?.shifts[0]?.durationHours, 24);
});

test("manual assignment reports a same-shift conflict and moves only after confirmation", () => {
  const first = assignManualOperator({
    draft: createManualScheduleDraft(), layout, shiftIndex: 0, roomId: "trade_1", slotIndex: 0, operator: "巫恋",
  }).draft;
  const blocked = assignManualOperator({
    draft: first, layout, shiftIndex: 0, roomId: "manu_1", slotIndex: 1, operator: "巫恋",
  });
  assert.deepEqual(blocked.conflict, { roomId: "trade_1", slotIndex: 0 });
  assert.equal(blocked.draft.shifts[0]?.rooms.manu_1, undefined);

  const moved = assignManualOperator({
    draft: first, layout, shiftIndex: 0, roomId: "manu_1", slotIndex: 1, operator: "巫恋", moveExisting: true,
  }).draft;
  assert.equal(moved.shifts[0]?.rooms.trade_1?.operators[0], null);
  assert.equal(moved.shifts[0]?.rooms.manu_1?.operators[1], "巫恋");
});

test("selecting within one room swaps positions and selecting the current operator is a no-op", () => {
  let draft = reconcileManualScheduleDraft(createManualScheduleDraft([12]), layout, box);
  draft = assignManualOperator({
    draft, layout, shiftIndex: 0, roomId: "trade_1", slotIndex: 0, operator: "但书",
  }).draft;
  draft = assignManualOperator({
    draft, layout, shiftIndex: 0, roomId: "trade_1", slotIndex: 1, operator: "巫恋",
  }).draft;

  const swapped = assignManualOperator({
    draft, layout, shiftIndex: 0, roomId: "trade_1", slotIndex: 1, operator: "但书",
  });
  assert.equal(swapped.conflict, null);
  assert.deepEqual(swapped.draft.shifts[0]?.rooms.trade_1?.operators, ["巫恋", "但书", null]);

  const unchanged = assignManualOperator({
    draft: swapped.draft, layout, shiftIndex: 0, roomId: "trade_1", slotIndex: 1, operator: "但书",
  });
  assert.equal(unchanged.draft, swapped.draft);
  assert.deepEqual(unchanged.draft.shifts[0]?.rooms.trade_1?.operators, ["巫恋", "但书", null]);
});

test("reconcile removes missing rooms and operators no longer owned", () => {
  let draft = createManualScheduleDraft([12]);
  draft = assignManualOperator({ draft, layout, shiftIndex: 0, roomId: "trade_1", slotIndex: 0, operator: "但书" }).draft;
  draft.shifts[0]!.rooms.removed = { operators: ["巫恋"] };
  const reconciled = reconcileManualScheduleDraft(draft, layout, box.filter((entry) => entry.name !== "但书"));
  assert.equal(reconciled.shifts[0]?.rooms.trade_1?.operators[0], null);
  assert.equal(reconciled.shifts[0]?.rooms.removed, undefined);
});

test("dormitories default to autofill and become explicitly empty when cleared", () => {
  let reconciled = reconcileManualScheduleDraft(createManualScheduleDraft([12]), layout, box);
  assert.equal(reconciled.version, 3);
  assert.equal(reconciled.shifts[0]?.rooms.dorm_1?.autofill, true);
  assert.equal(reconciled.shifts[0]?.rooms.dorm_1?.operators.length, 5);

  reconciled = assignManualOperator({
    draft: reconciled,
    layout,
    shiftIndex: 0,
    roomId: "dorm_1",
    slotIndex: 0,
    operator: "但书",
  }).draft;
  const autofillDisabled = setManualDormAutofill(reconciled, layout, 0, "dorm_1", false);
  assert.equal(autofillDisabled.shifts[0]?.rooms.dorm_1?.operators[0], "但书");
  assert.equal(autofillDisabled.shifts[0]?.rooms.dorm_1?.autofill, false);

  const cleared = clearManualRoom(reconciled, layout, 0, "dorm_1");
  assert.deepEqual(cleared.shifts[0]?.rooms.dorm_1?.operators, [null, null, null, null, null]);
  assert.equal(cleared.shifts[0]?.rooms.dorm_1?.autofill, false);
});

test("room and shift clearing keep their intended scope", () => {
  let draft = reconcileManualScheduleDraft(createManualScheduleDraft([12, 12]), layout, box);
  draft = assignManualOperator({ draft, layout, shiftIndex: 0, roomId: "trade_1", slotIndex: 0, operator: "但书" }).draft;
  draft = assignManualOperator({ draft, layout, shiftIndex: 1, roomId: "trade_1", slotIndex: 0, operator: "但书" }).draft;
  draft = setManualDroneTarget(draft, layout, 0, "manu_1");

  const roomCleared = clearManualRoom(draft, layout, 0, "manu_1");
  assert.equal(roomCleared.shifts[0]?.droneTargetRoomId, "manu_1");

  const shiftCleared = clearManualShift(draft, layout, 0);
  assert.equal(shiftCleared.shifts[0]?.rooms.trade_1?.operators.every((operator) => operator === null), true);
  assert.equal(shiftCleared.shifts[0]?.rooms.dorm_1?.autofill, false);
  assert.equal(shiftCleared.shifts[0]?.droneTargetRoomId, null);
  assert.equal(shiftCleared.shifts[1]?.rooms.trade_1?.operators[0], "但书");
});

test("MAA export includes contiguous minute periods, per-shift Fiammetta targets and dorm autofill", () => {
  let draft = createManualScheduleDraft([12, 6, 6], "08:15", "period");
  draft.shifts[0]!.fiammettaTarget = "但书";
  draft = setManualDormAutofill(draft, layout, 0, "dorm_1", true);
  draft = setManualDroneTarget(draft, layout, 0, "manu_1");
  draft = setManualDroneTarget(draft, layout, 1, "trade_1");
  draft = setManualDroneTarget(draft, layout, 2, "manu_1");
  const maa = manualScheduleToMaa(draft, layout, true);
  assert.equal(maa.planTimes, "3班");
  assert.deepEqual(maa.plans.map((plan) => plan.duration), [720, 360, 360]);
  assert.deepEqual(maa.plans.map((plan) => plan.period), [
    [["08:15", "20:14"]],
    [["20:15", "23:59"], ["00:00", "02:14"]],
    [["02:15", "08:14"]],
  ]);
  assert.deepEqual(maa.plans[0]?.Fiammetta, { enable: true, target: "但书", order: "pre" });
  assert.deepEqual(maa.plans.map((plan) => plan.drones), [
    { enable: true, room: "manufacture", index: 1, rule: "all", order: "pre" },
    { enable: true, room: "manufacture", index: 1, rule: "all", order: "pre" },
    { enable: true, room: "trading", index: 1, rule: "all", order: "pre" },
  ]);
  assert.deepEqual(maa.plans[1]?.Fiammetta, { enable: false, target: "", order: "pre" });
  assert.equal(maa.plans[0]?.rooms.dormitory?.[0]?.autofill, true);
  assert.deepEqual(maa.plans[0]?.rooms.dormitory?.[0]?.operators, []);
  assert.deepEqual(maa.plans[0]?.rooms.control?.[0], { operators: [], sort: true, skip: false, autofill: false });
  assert.equal(maa.plans[0]?.rooms.trading?.[0]?.product, "LMD");
  assert.equal(maa.plans[0]?.rooms.manufacture?.[0]?.product, "Battle Record");
  assert.equal("training" in (maa.plans[0]?.rooms ?? {}), false);
});

test("MAA export writes Orundum for originium trading orders and Originium Shard for shard factories", () => {
  const originiumLayout: BaseBlueprint = {
    ...layout,
    rooms: layout.rooms.map((room) => {
      if (room.id === "trade_1") return { ...room, product: { trade: { order: "originium" as const } } };
      if (room.id === "manu_1") return { ...room, product: { factory: { recipe: "originium" as const } } };
      return room;
    }),
  };
  const maa = manualScheduleToMaa(createManualScheduleDraft([12]), originiumLayout, false);
  assert.equal(maa.plans[0]?.rooms.trading?.[0]?.product, "Orundum");
  assert.equal(maa.plans[0]?.rooms.manufacture?.[0]?.product, "Originium Shard");
});

test("calculator results become an editable manual draft with room order, shifts, Fiammetta and training room preserved", () => {
  const draft = createManualScheduleDraftFromCalculator({
    layout,
    maa: {
      title: "求解结果",
      plans: [
        {
          name: "班次 1",
          duration: 600,
          Fiammetta: { enable: true, target: ["但书", "巫恋"], order: "pre" },
          drones: { enable: true, room: "trading", index: 1, order: "pre" },
          rooms: {
            control: [{ operators: [{ name: "菲亚梅塔", skill: 2 }] }],
            trading: [{ operators: ["但书", null, { name: "巫恋" }] }],
            dormitory: [{ operators: ["菲亚梅塔"], autofill: false }],
          },
        },
        { name: "班次 2", rooms: { manufacture: [{ operators: ["巫恋"] }] } },
      ],
    },
    fallbackDurations: [12, 6],
    fiammettaEnabled: true,
    trainingRoomShifts: [
      { trainee: "巫恋", trainer: "菲亚梅塔" },
      { trainee: null, trainer: "但书" },
    ],
  });

  assert.deepEqual(draft.shifts.map((shift) => shift.durationHours), [12, 12]);
  assert.deepEqual(draft.shifts[0]?.rooms.control?.operators, ["菲亚梅塔", null, null, null, null]);
  assert.deepEqual(draft.shifts[0]?.rooms.trade_1?.operators, ["但书", null, "巫恋"]);
  assert.equal(draft.shifts[0]?.rooms.dorm_1?.autofill, false);
  assert.equal(draft.shifts[0]?.fiammettaTarget, "但书");
  assert.equal(draft.shifts[0]?.droneTargetRoomId, null);
  assert.equal(draft.shifts[1]?.droneTargetRoomId, "trade_1");
  assert.deepEqual(draft.shifts[0]?.rooms.training_room?.operators, ["巫恋", "菲亚梅塔"]);
  assert.deepEqual(draft.shifts[1]?.rooms.manu_1?.operators, ["巫恋", null, null]);
});

test("manual draft source survives reconciliation without affecting content equality", () => {
  const original = createManualScheduleDraft([12, 6]);
  original.source = {
    kind: "calculator",
    variant: "progression-adjusted",
    createdAt: "2026-09-05T00:00:00.000Z",
  };
  const reconciled = reconcileManualScheduleDraft(original, layout, box);
  const sameContent = structuredClone(reconciled);
  sameContent.source = {
    kind: "calculator",
    variant: "baseline",
    createdAt: "2026-09-05T01:00:00.000Z",
  };

  assert.equal(reconciled.source?.variant, "progression-adjusted");
  assert.equal(manualScheduleDraftContentEqual(reconciled, sameContent), true);
  sameContent.startTime = "08:15";
  assert.equal(manualScheduleDraftContentEqual(reconciled, sameContent), false);
  sameContent.startTime = reconciled.startTime;
  sameContent.scheduleMode = "period";
  assert.equal(manualScheduleDraftContentEqual(reconciled, sameContent), false);
  sameContent.scheduleMode = reconciled.scheduleMode;
  sameContent.shifts[0]!.durationHours = 10;
  assert.equal(manualScheduleDraftContentEqual(reconciled, sameContent), false);
});

test("manual draft loading preserves only valid calculator source metadata", () => {
  const draft = createManualScheduleDraft([12, 6]);
  draft.source = {
    kind: "calculator",
    variant: "progression-adjusted",
    createdAt: "2026-09-05T00:00:00.000Z",
  };
  const storage = {
    getItem: () => JSON.stringify(draft),
    setItem: () => undefined,
  };

  assert.deepEqual(loadManualScheduleDraft(storage)?.source, draft.source);

  const invalidDraft = structuredClone(draft);
  assert.ok(invalidDraft.source);
  invalidDraft.source.createdAt = "not-a-date";
  assert.equal(loadManualScheduleDraft({
    ...storage,
    getItem: () => JSON.stringify(invalidDraft),
  })?.source, undefined);
});

test("external MAA schedules import periods, operator groups and operators outside the current Box", () => {
  const maa = normalizeMaaScheduleForManualImport(parseMaaScheduleText(JSON.stringify({
    title: "外部排版",
    plans: [
      {
        name: "白班",
        period: [["08:15", "19:59"]],
        groups: [{ name: "贸易候选", operators: ["但书", "巫恋"] }],
        rooms: {
          trading: [{ operators: ["贸易候选", "巫恋"], use_operator_groups: true }],
        },
      },
      {
        name: "夜班",
        period: [["20:00", "23:59"], ["00:00", "08:14"]],
        rooms: { manufacture: [{ operators: ["未拥有", "巫恋"] }] },
      },
    ],
  })));
  const imported = reconcileManualScheduleDraft(createManualScheduleDraftFromCalculator({
    layout,
    maa,
    fallbackDurations: [],
    fiammettaEnabled: false,
    preferMaaTiming: true,
    preserveExternalOperators: true,
  }), layout, box);

  assert.equal(imported.startTime, "08:15");
  assert.deepEqual(imported.shifts.map((shift) => shift.durationHours), [11.75, 12.25]);
  assert.deepEqual(imported.shifts[0]?.rooms.trade_1?.operators, ["但书", "巫恋", null]);
  assert.deepEqual(imported.shifts[1]?.rooms.manu_1?.operators, ["未拥有", "巫恋", null]);
});

test("timed MAA imports merge midnight ranges and expand reused non-contiguous plans", () => {
  const normalized = normalizeMaaScheduleForManualImport(parseMaaScheduleText(JSON.stringify({
    plans: [
      { name: "A", period: [["18:00", "23:59"], ["00:00", "05:59"], ["12:00", "13:59"]], rooms: { control: [{ operators: ["但书"] }] } },
      { name: "B", period: [["06:00", "11:59"], ["14:00", "17:59"]], rooms: { control: [{ operators: ["巫恋"] }] } },
    ],
  })));
  assert.equal(normalized.plans.length, 4);
  assert.deepEqual(normalized.plans.map((plan) => plan.period), [
    [["18:00", "23:59"], ["00:00", "05:59"]],
    [["06:00", "11:59"]],
    [["12:00", "13:59"]],
    [["14:00", "17:59"]],
  ]);
});

test("timed MAA imports reject gaps and overlaps", () => {
  assert.throws(() => normalizeMaaScheduleForManualImport(parseMaaScheduleText(JSON.stringify({
    plans: [{ period: [["00:00", "12:00"]], rooms: {} }],
  }))), /空档/);
  assert.throws(() => normalizeMaaScheduleForManualImport(parseMaaScheduleText(JSON.stringify({
    plans: [
      { period: [["00:00", "12:00"]], rooms: {} },
      { period: [["12:00", "23:59"]], rooms: {} },
    ],
  }))), /重叠/);
});

test("MAA layout import overrides specified room counts and imports room products", () => {
  const imported = layoutFromMaaSchedule(parseMaaScheduleText(JSON.stringify({
    plans: [{ rooms: {
      trading: [
        { product: "Originium Shard", operators: [] },
        { product: "LMD", operators: [] },
        { product: "Orundum", operators: [] },
      ],
      manufacture: [
        { product: "Battle Record", operators: [] },
        { product: "Gold", operators: [] },
        { product: "originium", operators: [] },
      ],
    } }],
  })), layout);
  assert.equal(imported.rooms.filter((room) => room.kind === "trade_post").length, 3);
  assert.equal(imported.rooms.filter((room) => room.kind === "factory").length, 3);
  assert.deepEqual(imported.rooms.filter((room) => room.kind === "trade_post").map((room) => (
    room.product && "trade" in room.product ? room.product.trade.order : null
  )), ["originium", "gold", "originium"]);
  assert.deepEqual(imported.rooms.filter((room) => room.kind === "factory").map((room) => (
    room.product && "factory" in room.product ? room.product.factory.recipe : null
  )), ["battle_record", "gold", "originium"]);
});

test("MAA layout import preserves current products when the file omits or does not recognize them", () => {
  const imported = layoutFromMaaSchedule(parseMaaScheduleText(JSON.stringify({
    plans: [{ rooms: {
      trading: [{ operators: [] }],
      manufacture: [{ product: "unknown product", operators: [] }],
    } }],
  })), layout);
  const importedTrade = imported.rooms.find((room) => room.id === "trade_1");
  const importedFactory = imported.rooms.find((room) => room.id === "manu_1");
  assert.ok(importedTrade?.product && "trade" in importedTrade.product);
  assert.ok(importedFactory?.product && "factory" in importedFactory.product);
  assert.equal(importedTrade.product.trade.order, "gold");
  assert.equal(importedFactory.product.factory.recipe, "battle_record");
});

test("MAA schedule import rejects JSON without valid plans and rooms", () => {
  assert.throws(() => parseMaaScheduleText("{}"), /plans/);
  assert.throws(() => parseMaaScheduleText(JSON.stringify({ plans: [{}] })), /rooms/);
});
