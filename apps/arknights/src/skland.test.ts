import assert from "node:assert/strict";
import test from "node:test";

import { compareShifts, countShiftPlacementAdjustments } from "./skland.ts";
import type { MaaJson, SklandScheduleInfrastructure } from "./types.ts";

const infrastructure: SklandScheduleInfrastructure = {
  storeTs: null, layoutLabel: "243", layoutSuggestion: null, layoutWarning: null,
  tiredOperators: ["能天使", "推进之王"],
  rooms: [
    { key: "control:0", group: "control", index: 0, level: 5, operators: [{ id: "a", name: "阿米娅", morale: 20 }] },
    { key: "trading:0", group: "trading", index: 0, level: 3, operators: [{ id: "b", name: "能天使", morale: 0 }], product: "gold" },
    { key: "manufacture:0", group: "manufacture", index: 0, level: 3, operators: [{ id: "c", name: "推进之王", morale: 0 }], product: "gold" },
    { key: "training:0", group: "training" as never, index: 0, level: 3, operators: [{ id: "x", name: "忽略干员", morale: 20 }] },
  ],
};
const maa: MaaJson = { title: "test", plans: [
  { name: "第一班", rooms: { control: [{ operators: ["阿米娅"] }], trading: [{ operators: ["推进之王", "德克萨斯"] }] } },
  { name: "第二班", rooms: { control: [{ operators: ["阿米娅"] }], trading: [{ operators: ["能天使"] }], manufacture: [{ operators: ["推进之王"] }] } },
] };

test("compareShifts builds unique room-level adjustments and merges fatigue", () => {
  const first = compareShifts(maa, infrastructure)[0];
  assert.equal(first.score, 25);
  assert.deepEqual(first.matched, ["阿米娅"]);
  assert.deepEqual(first.misplaced, ["推进之王"]);
  assert.equal(first.adjustments.length, 3);
  assert.deepEqual(first.adjustments.find((item) => item.operator === "推进之王"), { operator: "推进之王", currentRoomKey: "manufacture:0", targetRoomKey: "trading:0", issues: ["misplaced", "tired"] });
  assert.deepEqual(first.adjustments.find((item) => item.operator === "德克萨斯")?.issues, ["missing"]);
  assert.deepEqual(first.adjustments.find((item) => item.operator === "能天使")?.issues, ["unexpected"]);
  assert.equal(countShiftPlacementAdjustments(first), 3);
});

test("compareShifts supports multiple shifts and exact room matches", () => {
  const second = compareShifts(maa, infrastructure)[1];
  assert.equal(second.score, 100);
  assert.equal(second.adjustments.length, 2);
  assert.ok(second.adjustments.every((item) => item.issues.length === 1 && item.issues[0] === "tired"));
  assert.equal(countShiftPlacementAdjustments(second), 0);
});

test("compareShifts reports a fully matching shift with no adjustments", () => {
  const second = compareShifts(maa, { ...infrastructure, tiredOperators: [] })[1];
  assert.equal(second.score, 100);
  assert.deepEqual(second.adjustments, []);
});

test("compareShifts treats rooms of the same facility type as matches", () => {
  const comparison = compareShifts(
    {
      title: "same facility type",
      plans: [{
        name: "first shift",
        rooms: {
          trading: [
            { operators: [] },
            { operators: ["Texas"] },
          ],
        },
      }],
    },
    {
      storeTs: null,
      layoutLabel: "243",
      layoutSuggestion: null,
      layoutWarning: null,
      tiredOperators: [],
      rooms: [{
        key: "trading:0",
        group: "trading",
        index: 0,
        level: 3,
        operators: [{ id: "texas", name: "Texas", morale: 20 }],
        product: "gold",
      }],
    },
  )[0];

  assert.equal(comparison.score, 100);
  assert.deepEqual(comparison.matched, ["Texas"]);
  assert.deepEqual(comparison.misplaced, []);
  assert.deepEqual(comparison.adjustments, []);
  assert.equal(countShiftPlacementAdjustments(comparison), 0);
});

test("compareShifts keeps fatigue warnings for same-facility matches", () => {
  const comparison = compareShifts(
    {
      title: "same facility type with fatigue",
      plans: [{
        name: "first shift",
        rooms: {
          trading: [
            { operators: [] },
            { operators: ["Texas"] },
          ],
        },
      }],
    },
    {
      storeTs: null,
      layoutLabel: "243",
      layoutSuggestion: null,
      layoutWarning: null,
      tiredOperators: ["Texas"],
      rooms: [{
        key: "trading:0",
        group: "trading",
        index: 0,
        level: 3,
        operators: [{ id: "texas", name: "Texas", morale: 0 }],
        product: "gold",
      }],
    },
  )[0];

  assert.equal(comparison.score, 100);
  assert.deepEqual(comparison.matched, ["Texas"]);
  assert.deepEqual(comparison.misplaced, []);
  assert.deepEqual(comparison.tiredScheduled, ["Texas"]);
  assert.deepEqual(comparison.adjustments, [{
    operator: "Texas",
    currentRoomKey: "trading:0",
    targetRoomKey: "trading:1",
    issues: ["tired"],
  }]);
  assert.equal(countShiftPlacementAdjustments(comparison), 0);
});

test("compareShifts excludes dormitories before calculating the match rate", () => {
  const comparison = compareShifts(
    {
      title: "宿舍不参与比较",
      plans: [{
        name: "第一班",
        rooms: {
          control: [{ operators: ["阿米娅"] }],
          trading: [{ operators: ["德克萨斯"] }],
          dormitory: [{ operators: ["计划宿舍干员"] }],
        },
      }],
    },
    {
      storeTs: null,
      layoutLabel: "243",
      layoutSuggestion: null,
      layoutWarning: null,
      tiredOperators: ["计划宿舍干员"],
      rooms: [
        { key: "control:0", group: "control", index: 0, level: 5, operators: [{ id: "a", name: "阿米娅", morale: 20 }] },
        { key: "trading:0", group: "trading", index: 0, level: 3, operators: [{ id: "b", name: "能天使", morale: 20 }], product: "gold" },
        { key: "dormitory:0", group: "dormitory", index: 0, level: 5, operators: [{ id: "d", name: "当前宿舍干员", morale: 10 }] },
      ],
    },
  )[0];

  assert.equal(comparison.score, 33);
  assert.deepEqual(comparison.matched, ["阿米娅"]);
  assert.deepEqual(comparison.missing, ["德克萨斯"]);
  assert.deepEqual(comparison.unexpected, ["能天使"]);
  assert.deepEqual(comparison.tiredScheduled, []);
  assert.ok(comparison.adjustments.every((item) => !item.operator.includes("宿舍")));
});

test("compareShifts returns no comparisons without required input", () => {
  assert.deepEqual(compareShifts(undefined, infrastructure), []);
  assert.deepEqual(compareShifts(maa, undefined), []);
});
