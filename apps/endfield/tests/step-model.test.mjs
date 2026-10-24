import assert from "node:assert/strict";
import test from "node:test";
import { catalog, DEFAULT_OPTIONS, manualTemplate } from "@riic/endfield-solver/model.mjs";
import { MFG_LAYOUTS } from "@riic/endfield-solver/simulation.mjs";
import {
  buildStepConfig, defaultSource, productsFor, roomsFromManual, roomsFromResult, roomsFromTemplate, scheduledNames, validateStepConfig,
} from "../src/step/step-model.ts";

const OPTIONS = {
  ...DEFAULT_OPTIONS,
  levels: { center: 5, mfg1: 3, mfg2: 3, grow: 3, guest: 3 },
  grow: { 晶植: 3, 菌类: 0, 矿物: 0 },
};
const OPERATORS = catalog.slice(0, 6).map(operator => ({ name: operator.name, elite: 4 }));
const NAMES = OPERATORS.map(operator => operator.name);

function workspace(overrides = {}) {
  return { version: 1, operators: structuredClone(OPERATORS), options: structuredClone(OPTIONS), ...overrides };
}
function manualPlan(ws) {
  return manualTemplate(ws.options).map((room, index) => ({
    ...room,
    hour: 10 + index,
    a: Array.from({ length: room.slots }, (_, slot) => NAMES[(index + slot) % NAMES.length]),
    b: Array.from({ length: room.slots }, (_, slot) => NAMES[(index + slot + 3) % NAMES.length]),
  }));
}
function plan(room, extra = {}) {
  return {
    key: room.key, category: room.products[0] ?? "线索", single: false, hour: 12,
    a: [NAMES[0]], b: [NAMES[1]], value: 1, bonusA: 0, bonusB: 0,
    converged: true, days: 1, daily: [], moodA: null, moodB: null, workHours: null, restHours: null, assist: null,
    ...extra,
  };
}

test("the facility template decides which rooms exist and what they produce", () => {
  const rooms = roomsFromTemplate(workspace());
  assert.deepEqual(rooms.map(room => room.key), ["中枢", "会客室", "制造舱1", "制造舱2", "培养舱"]);
  assert.deepEqual(rooms.find(room => room.key === "中枢").products, []);
  assert.deepEqual(rooms.find(room => room.key === "会客室").products, ["线索"]);
  assert.deepEqual(rooms.find(room => room.key === "制造舱1").products, [MFG_LAYOUTS["1干员1武器"][0]]);
  assert.deepEqual(rooms.find(room => room.key === "制造舱2").products, [MFG_LAYOUTS["1干员1武器"][1]]);
  assert.deepEqual(rooms.find(room => room.key === "培养舱").products, ["晶植"]);
  assert.ok(rooms.every(room => room.slots >= 1 && room.crewA.every(name => name === null)));
});

test("manufacturing layout and growth counts drive the products", () => {
  assert.deepEqual(productsFor("制造舱1", { ...OPTIONS, mfg: "2干员" }), ["干员经验"]);
  assert.deepEqual(productsFor("制造舱2", { ...OPTIONS, mfg: "2干员" }), ["干员经验"]);
  assert.deepEqual(productsFor("制造舱1", { ...OPTIONS, mfg: "2武器" }), ["武器经验"]);
  assert.deepEqual(productsFor("培养舱", { ...OPTIONS, grow: { 晶植: 0, 菌类: 2, 矿物: 1 } }), ["菌类", "矿物"]);
  assert.deepEqual(productsFor("培养舱", { ...OPTIONS, grow: { 晶植: 0, 菌类: 0, 矿物: 0 } }), []);
  const noGrowth = roomsFromTemplate(workspace({ options: { ...OPTIONS, grow: { 晶植: 0, 菌类: 0, 矿物: 0 } } }));
  assert.equal(noGrowth.some(room => room.key === "培养舱"), false);
});

test("manual drafts map crews, hours and single-shift rooms", () => {
  const ws = workspace();
  ws.manual = manualPlan(ws);
  ws.manual[2].b = [];
  ws.manual[0].a[0] = "不存在的干员";
  const rooms = roomsFromManual(ws);
  assert.equal(rooms.length, 5);
  assert.equal(rooms[0].hour, 10);
  assert.equal(rooms[0].crewA[0], null, "unknown operators are dropped");
  assert.equal(rooms[1].single, false);
  assert.equal(rooms[2].single, true, "an empty B shift becomes a single-shift room");
  assert.deepEqual(rooms[2].crewB, rooms[2].crewB.map(() => null));
});

test("results seed crews and clamp the changeover hour", () => {
  const ws = workspace();
  ws.manual = manualPlan(ws);
  const result = {
    revision: "test", elapsedMs: 10,
    status: { searchComplete: true, stopReason: "complete", centersVisited: 1, centersTotal: 1, nodes: 1, approximations: [], gaps: [] },
    verification: { ok: true, errors: [] }, scores: {},
    center: { hour: 15, a: [NAMES[0]], b: [NAMES[1]], recoveryA: 0.2, recoveryB: 0.1 },
    rooms: [
      plan({ key: "会客室", products: ["线索"] }, { single: true, hour: 24, a: [NAMES[2]], b: [] }),
      plan({ key: "制造舱1", products: ["干员经验"] }, { hour: 9, a: [NAMES[3]], b: [NAMES[4]] }),
    ],
  };
  const rooms = roomsFromResult(ws, result);
  const center = rooms.find(room => room.key === "中枢");
  assert.equal(center.hour, 15);
  assert.equal(center.crewA[0], NAMES[0]);
  assert.equal(center.crewA.length, center.slots);
  assert.equal(center.single, false);
  const guest = rooms.find(room => room.key === "会客室");
  assert.equal(guest.single, true);
  assert.equal(guest.hour, 14, "hour 24 falls back to the room default changeover");
  const first = rooms.find(room => room.key === "制造舱1");
  assert.equal(first.hour, 9);
  assert.equal(first.crewB[0], NAMES[4]);
  assert.equal(first.crewB.length, first.slots);
  const missing = rooms.find(room => room.key === "培养舱");
  assert.equal(missing.single, true);
  assert.equal(missing.crewA.every(name => name === null), true);
});

test("the default import source prefers manual, then a verified result", () => {
  const empty = workspace();
  assert.equal(defaultSource(empty, null), "template");
  assert.equal(defaultSource(empty, { center: { hour: 12 } }), "result");
  const manual = workspace();
  manual.manual = manualPlan(manual);
  assert.equal(defaultSource(manual, { center: { hour: 12 } }), "manual");
});

test("config assembly carries rooms, boosts and scheduled names", () => {
  const ws = workspace();
  ws.manual = manualPlan(ws);
  const config = buildStepConfig(ws, null, "manual");
  assert.equal(config.rooms.length, 5);
  assert.equal(config.boost.dailyCount, 0, "assistance is off by default");
  const names = scheduledNames(config.rooms);
  assert.ok(names.size > 0);
  assert.ok(NAMES.every(name => names.has(name)));

  const assisted = buildStepConfig(workspace({ options: { ...OPTIONS, assist: true } }), null, "template");
  assert.equal(assisted.boost.dailyCount, 2);
  assert.equal(assisted.boost.days[0].list.length, 2);
  assert.equal(assisted.boost.days[0].list[0].hour, 12);
  assert.equal(assisted.boost.days[0].list[1].hour, 18);
});

test("duplicate or unknown crews are reported before starting", () => {
  const ws = workspace();
  ws.manual = manualPlan(ws);
  const config = buildStepConfig(ws, null, "manual");
  const empty = {
    ...config,
    rooms: config.rooms.map(room => ({ ...room, crewA: room.crewA.map(() => null), crewB: room.crewB.map(() => null) })),
  };
  const owned = new Set(NAMES);
  assert.deepEqual(validateStepConfig(empty, owned), []);
  const duplicate = {
    ...empty,
    rooms: empty.rooms.map((room, index) => index === 1 || index === 2 ? { ...room, crewA: [NAMES[0], ...room.crewA.slice(1)] } : room),
  };
  assert.ok(validateStepConfig(duplicate, owned).some(problem => problem.includes("重复")));
  assert.ok(validateStepConfig(duplicate, new Set()).some(problem => problem.includes("不在名单中")));
  const badHour = { ...empty, rooms: empty.rooms.map((room, index) => index === 0 ? { ...room, hour: 24 } : room) };
  assert.ok(validateStepConfig(badHour, owned).some(problem => problem.includes("换班时刻")));
});
