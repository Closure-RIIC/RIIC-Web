import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeFacilityDefaults } from "./facility-defaults.ts";
import { validateLayoutJson } from "./layout-validation.ts";
import { assignManualOperator, createManualScheduleDraft, createManualScheduleDraftFromCalculator, layoutFromMaaSchedule, manualScheduleToMaa, reconcileManualScheduleDraft } from "./manual-schedule.ts";
import { prepareMaaForExport } from "./maa-safety.ts";
import { planToRows } from "./schedule.ts";
import { parseTrainingRoomSchedule } from "./training-room-contract.ts";
import { assertCompleteSolverOutput } from "./server/solver-output-contract.ts";
import { withDefaultDormAutofill } from "./automatic-dorm-defaults.ts";
import type { BaseBlueprint, MaaJson } from "./types.ts";

const layout: BaseBlueprint = JSON.parse(readFileSync(new URL("./layouts/243.json", import.meta.url), "utf8"));

test("all presets use drone cap 250 and one level-three recycling station", () => {
  for (const preset of [153, 243, 252, 333, 342]) {
    const value: BaseBlueprint = JSON.parse(readFileSync(new URL(`./layouts/${preset}.json`, import.meta.url), "utf8"));
    assert.equal(value.drone_cap, 250);
    assert.deepEqual(value.rooms.filter(room => room.kind === "recycling_station"), [{ id: "recycling_station", kind: "recycling_station", level: 3 }]);
    assert.deepEqual(validateLayoutJson(value), []);
  }
  const legacy = { ...layout, drone_cap: 235, rooms: layout.rooms.filter(room => room.kind !== "recycling_station") };
  assert.deepEqual(normalizeFacilityDefaults(normalizeFacilityDefaults(legacy)), layout);
  assert.equal(normalizeFacilityDefaults({ ...layout, drone_cap: 200 }).drone_cap, 200);
  assert.ok(validateLayoutJson({ ...layout, drone_cap: 251 }).length);
  assert.ok(validateLayoutJson({ ...layout, rooms: [...layout.rooms, { id: "extra", kind: "recycling_station", level: 3 }] }).length);
});

test("training assistant and recycling B-only assignments round trip without moving into A", () => {
  let draft = reconcileManualScheduleDraft(createManualScheduleDraft(), layout);
  draft = assignManualOperator({ draft, layout, shiftIndex: 0, roomId: "training_room", slotIndex: 1, operator: "德克萨斯" }).draft;
  draft = assignManualOperator({ draft, layout, shiftIndex: 0, roomId: "recycling_station", slotIndex: 1, operator: "阿米娅" }).draft;
  const maa = prepareMaaForExport(manualScheduleToMaa(draft, layout, false));
  assert.deepEqual(maa.plans[0]!.rooms.training?.[0]?.operatorsA, ["德克萨斯"]);
  assert.deepEqual(maa.plans[0]!.rooms.training?.[0]?.operatorsB, []);
  const restored = createManualScheduleDraftFromCalculator({ layout, maa, fallbackDurations: [12, 6, 6], fiammettaEnabled: false });
  assert.deepEqual(restored.shifts[0]!.rooms.training_room?.operators, [null, "德克萨斯"]);
  assert.deepEqual(restored.shifts[0]!.rooms.recycling_station?.operators, [null, "阿米娅"]);
  const rows = planToRows(maa.plans[0], undefined, layout);
  assert.deepEqual(rows.find(row => row.group === "training")?.positionSlots?.map(position => position.slot?.name ?? null), [null, "德克萨斯"]);
  assert.deepEqual(rows.find(row => row.group === "recycling")?.slotAssignments?.map(slot => slot?.name ?? null), [null, "阿米娅"]);
  assert.equal(layoutFromMaaSchedule(maa, layout).rooms.filter(room => room.kind === "training_room").length, 1);
});

test("empty export skips training and fills recycling while respecting explicit recycle skip", () => {
  const maa: MaaJson = { title: "test", plans: [{ name: "empty", rooms: {} }] };
  const exported = prepareMaaForExport(maa);
  assert.equal(exported.plans[0]!.rooms.training?.[0]?.skip, true);
  assert.equal(exported.plans[0]!.rooms.recycle?.[0]?.autofill, true);
  maa.plans[0]!.rooms.recycle = [{ skip: true }];
  assert.equal(prepareMaaForExport(maa).plans[0]!.rooms.recycle?.[0]?.autofill, undefined);
});

test("independent training response must agree with MAA positions and stay unique", () => {
  const maa: MaaJson = { title: "test", plans: [{ name: "shift", rooms: { training: [{ operatorsA: ["德克萨斯"], operatorsB: [] }], recycle: [{ operatorsB: ["阿米娅"] }] } }] };
  assert.doesNotThrow(() => parseTrainingRoomSchedule({ schema_version: 1, shifts: [{ trainee: null, trainer: "德克萨斯" }] }, maa));
  assert.throws(() => parseTrainingRoomSchedule({ schema_version: 1, shifts: [{ trainee: null, trainer: "能天使" }] }, maa), /不一致/);
  assert.throws(() => parseTrainingRoomSchedule({ schema_version: 1, shifts: [{ trainee: "阿米娅", trainer: "德克萨斯" }] }, maa), /已在/);
});

test("solver success validator accepts A/B facilities without legacy operators", () => {
  const payload = { profile: { schema_version: 4, domains: [{}], summary: { owned: 1 } }, rotation: { profile: "abc_12_6_6", shifts: [{}, {}, {}] }, maa: { title: "plan", description: "", planTimes: "3班", plans: [0, 1, 2].map(() => ({ name: "shift", rooms: { training: [{ operatorsA: [], operatorsB: [], skip: true }], recycle: [{ operatorsA: [], operatorsB: [], autofill: true }] } })) } };
  assert.doesNotThrow(() => assertCompleteSolverOutput(payload, "abc_12_6_6"));
});

test("Fiammetta-only downloads preserve skipped training, recycling and dorms", () => {
  const maa: MaaJson = { title: "event", plans: [{ name: "event", Fiammetta: { enable: true, target: "但书" }, drones: { enable: false, room: "manufacture", index: 1, order: "pre" }, rooms: {
    trading: [{ operators: ["但书"], skip: false }],
    control: [{ operators: ["阿米娅"], skip: true }],
    dormitory: [{ operators: [], skip: true, autofill: false }],
    training: [{ operatorsA: [], operatorsB: ["麦哲伦"], skip: true }],
    recycle: [{ operatorsA: [], operatorsB: [], skip: true, autofill: false }],
  } }] };
  const result = withDefaultDormAutofill({ maa } as Parameters<typeof withDefaultDormAutofill>[0]);
  const rooms = prepareMaaForExport(result.maa).plans[0]!.rooms;
  assert.equal(rooms.trading?.[0]?.skip, false);
  assert.equal(rooms.training?.[0]?.skip, true);
  assert.equal(rooms.recycle?.[0]?.skip, true);
  assert.equal(rooms.recycle?.[0]?.autofill, false);
  assert.equal(rooms.dormitory?.[0]?.skip, true);
  assert.equal(rooms.dormitory?.[0]?.autofill, false);
});
