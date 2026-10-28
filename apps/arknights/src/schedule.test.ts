import assert from "node:assert/strict";
import test from "node:test";

import { presentRoomEfficiency } from "@riic/arknights-domain/efficiency";
import { planToRows } from "./schedule.ts";
import type { BaseBlueprint, MaaPlan, RotationShift, TrainingRoomShift } from "@riic/arknights-domain/types";

const layout: BaseBlueprint = {
  template: "243",
  drone_cap: 235,
  scenario: {},
  rooms: [
    { id: "control", kind: "control_center", level: 5 },
    { id: "training_room", kind: "training_room", level: 3 },
  ],
};

const plan: MaaPlan = {
  name: "第一班",
  rooms: {
    control: [{ operators: ["阿米娅"] }],
  },
};

function trainingRow(shift?: TrainingRoomShift) {
  const row = planToRows(plan, undefined, layout, shift).find((candidate) => candidate.group === "training");
  assert.ok(row);
  return row;
}

test("adds two named empty training positions for plans without optional training data", () => {
  const row = trainingRow();
  assert.equal(row.roomId, "training_room");
  assert.equal(row.level, 3);
  assert.equal(row.rule, "不参与 MAA 导出");
  assert.deepEqual(row.positionSlots, [
    { position: "trainee", positionLabel: "训练位" },
    { position: "trainer", positionLabel: "协助位" },
  ]);
  assert.deepEqual(row.operatorSlots, []);
});

test("keeps each training shift independent and preserves an empty leading position", () => {
  const first = trainingRow({ trainee: "能天使", trainer: "德克萨斯" });
  const second = trainingRow({ trainee: null, trainer: "拉普兰德" });

  assert.deepEqual(first.positionSlots?.map((position) => position.slot?.name ?? null), ["能天使", "德克萨斯"]);
  assert.deepEqual(second.positionSlots?.map((position) => position.slot?.name ?? null), [null, "拉普兰德"]);
  assert.deepEqual(second.operatorSlots.map((slot) => slot.name), ["拉普兰德"]);
  assert.equal("training" in plan.rooms, false);
});

test("also adds the training room while only a layout is available", () => {
  const row = planToRows(undefined, undefined, layout).find((candidate) => candidate.group === "training");
  assert.deepEqual(row?.positionSlots?.map((position) => position.positionLabel), ["训练位", "协助位"]);
});

test("omits unavailable efficiency and marks Lancet-2 when its power room omits total efficiency", () => {
  const powerLayout: BaseBlueprint = {
    template: "243",
    drone_cap: 235,
    scenario: {},
    rooms: [
      { id: "power_1", kind: "power_plant", level: 3 },
      { id: "power_2", kind: "power_plant", level: 3 },
    ],
  };
  const powerPlan: MaaPlan = {
    name: "第一班",
    rooms: {
      power: [
        { operators: ["Castle-3"] },
        { operators: ["Lancet-2"] },
      ],
    },
  };
  const shift: RotationShift = {
    index: 0,
    duration_hours: 12,
    active_teams: [],
    resting_team: "",
    scores: {
      trade_score: 0,
      manu_prod_sum: 0,
      power_charge_sum: 0,
      room_lines: [
        { room_id: "power_1", order_multiplier: 1 },
        { room_id: "power_2", order_multiplier: 1 },
      ],
    },
    weighted_trade: 0,
    weighted_manu: 0,
    weighted_power: 0,
  };

  const rows = planToRows(powerPlan, shift, powerLayout);
  const firstPower = rows.find((row) => row.roomId === "power_1");
  const lancetPower = rows.find((row) => row.roomId === "power_2");

  assert.equal(firstPower?.efficiency?.total_efficiency, undefined);
  assert.equal(presentRoomEfficiency("power", firstPower?.efficiency), null);
  assert.equal(firstPower?.operatorSlots[0]?.portraitAlert, undefined);
  assert.equal(lancetPower?.efficiency?.total_efficiency, 0);
  assert.equal(presentRoomEfficiency("power", lancetPower?.efficiency), null);
  assert.equal(lancetPower?.operatorSlots[0]?.portraitAlert, "missing-power-efficiency");
});

test("rows carry the shift's own product label instead of the layout's", () => {
  const productLayout: BaseBlueprint = {
    template: "243",
    drone_cap: 235,
    scenario: {},
    rooms: [
      { id: "trade_1", kind: "trade_post", level: 3, product: { trade: { order: "gold" } } },
      { id: "manu_1", kind: "factory", level: 3, product: { factory: { recipe: "gold" } } },
      { id: "manu_2", kind: "factory", level: 3, product: { factory: { recipe: "gold" } } },
    ],
  };
  const productPlan: MaaPlan = {
    name: "第一班",
    rooms: {
      trading: [{ product: "Originium Shard", operators: [] }],
      manufacture: [
        { product: "Battle Record", operators: [] },
        { product: "Originium Shard", operators: [] },
      ],
    },
  };

  const rows = planToRows(productPlan, undefined, productLayout);
  const labelOf = (roomId: string) => rows.find((row) => row.roomId === roomId)?.product;

  // 贸易站读到的是这一班的开采协力，而不是布局里的龙门商法
  assert.equal(labelOf("trade_1"), "开采协力");
  // 制造站按房间分组解析，不能落空、也不能被当成贸易产物
  assert.equal(labelOf("manu_1"), "作战记录");
  assert.equal(labelOf("manu_2"), "源石碎片");
});
