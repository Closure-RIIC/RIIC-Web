import assert from "node:assert/strict";
import test from "node:test";
import { catalog, DEFAULT_OPTIONS, manualTemplate } from "@riic/endfield-solver/model.mjs";
import { MFG_LAYOUTS } from "@riic/endfield-solver/simulation.mjs";
import {
  ensureBoostDays, maxBoostDays, productsFor, roomsFromManual, STEP_ROOM_LABELS,
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

test("the facility template decides which rooms exist and what they produce", () => {
  const ws = workspace();
  ws.manual = manualPlan(ws);
  const rooms = roomsFromManual(ws);
  assert.deepEqual(rooms.map(room => room.key), ["中枢", "会客室", "制造舱1", "制造舱2", "培养舱"]);
  assert.deepEqual(rooms.find(room => room.key === "中枢").products, []);
  assert.deepEqual(rooms.find(room => room.key === "会客室").products, ["线索"]);
  assert.deepEqual(rooms.find(room => room.key === "制造舱1").products, [MFG_LAYOUTS["1干员1武器"][0]]);
  assert.deepEqual(rooms.find(room => room.key === "制造舱2").products, [MFG_LAYOUTS["1干员1武器"][1]]);
  assert.deepEqual(rooms.find(room => room.key === "培养舱").products, ["晶植"]);
  assert.ok(rooms.find(room => room.key === "中枢").slots >= 1);
});

test("manufacturing layout and growth counts drive the products", () => {
  assert.deepEqual(productsFor("制造舱1", { ...OPTIONS, mfg: "2干员" }), ["干员经验"]);
  assert.deepEqual(productsFor("制造舱2", { ...OPTIONS, mfg: "2干员" }), ["干员经验"]);
  assert.deepEqual(productsFor("制造舱1", { ...OPTIONS, mfg: "2武器" }), ["武器经验"]);
  assert.deepEqual(productsFor("培养舱", { ...OPTIONS, grow: { 晶植: 0, 菌类: 2, 矿物: 1 } }), ["菌类", "矿物"]);
  assert.deepEqual(productsFor("培养舱", { ...OPTIONS, grow: { 晶植: 0, 菌类: 0, 矿物: 0 } }), []);
  const ws = workspace({ options: { ...OPTIONS, grow: { 晶植: 0, 菌类: 0, 矿物: 0 } } });
  ws.manual = manualPlan(ws);
  assert.equal(roomsFromManual(ws).some(room => room.key === "培养舱"), false);
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

test("room labels stay aligned with the solver keys", () => {
  assert.equal(STEP_ROOM_LABELS["中枢"], "总控中枢");
  assert.equal(STEP_ROOM_LABELS["制造舱1"], "制造舱 Ⅰ");
});

test("boost days follow the simulated horizon", () => {
  assert.equal(maxBoostDays(0, 24), 1);
  assert.equal(maxBoostDays(8, 48), 3);
  const patched = ensureBoostDays({ dailyCount: 2, currentDay: 0, days: [] }, 2);
  assert.equal(patched.days.length, 2);
  assert.equal(patched.days[0].list.length, 2);
});
