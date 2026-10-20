import assert from "node:assert/strict";
import test from "node:test";

import { evaluateManualSchedule } from "./manual-schedule-evaluator.ts";
import { createManualScheduleDraft } from "./manual-schedule.ts";
import type { BaseBlueprint, OperBoxEntry } from "./types.ts";

const layout: BaseBlueprint = {
  template: "243",
  drone_cap: 0,
  scenario: {},
  rooms: [{ id: "trade_1", kind: "trade_post", level: 3, product: { trade: { order: "gold" } } }],
};

const operbox: OperBoxEntry[] = [
  { id: "char_4032_provs", name: "但书", own: true, elite: 2, level: 80, potential: 1, rarity: 6 },
  { id: "char_254_vodfox", name: "巫恋", own: true, elite: 2, level: 80, potential: 1, rarity: 5 },
  { id: "char_486_takila", name: "龙舌兰", own: true, elite: 2, level: 80, potential: 1, rarity: 5 },
];

test("paper evaluation carries special anchors and computes trade-equivalent efficiency", () => {
  const draft = createManualScheduleDraft([24]);
  draft.shifts[0]!.rooms.trade_1 = {
    operators: ["但书", "巫恋", "龙舌兰"],
    manualSkillEfficiencyPct: 90,
  };
  const evaluation = evaluateManualSchedule({
    draft,
    layout,
    operbox,
    crossFacilityEfficiencyByShift: new Map([[0, new Map([["trade_1", 0.07]])]]),
  });
  const room = evaluation.roomsByShift[0]?.find(item => item.roomId === "trade_1");
  assert.ok(room);
  assert.equal(room.baseEfficiency, 1.03);
  assert.equal(room.skillEfficiency, 0.9);
  assert.equal(room.globalEfficiency, 0.07);
  assert.equal(room.totalEfficiency, 2);
  assert.equal(room.orderMultiplier, 1.552);
  assert.equal(room.finalEfficiency, 3.104);
  assert.equal(room.tradeEquivalentEfficiency, 2.004);
  assert.equal(room.specialTradeAnchor?.tradeUnitOutputPerDay, 15_929.2);
  assert.equal(evaluation.rotation.shifts[0]?.scores.room_lines[0]?.trade_equivalent_efficiency, 2.004);
});

test("paper evaluation reports witch-tequila hidden gold output from its special anchor", () => {
  const draft = createManualScheduleDraft([24]);
  draft.shifts[0]!.rooms.trade_1 = {
    operators: ["巫恋", "龙舌兰", "柏喙"],
    manualSkillEfficiencyPct: 0,
  };
  const box = [...operbox.filter(operator => operator.name !== "但书"), {
    id: "char_252_bibeak", name: "柏喙", own: true, elite: 2, level: 80, potential: 1, rarity: 5,
  }];
  const evaluation = evaluateManualSchedule({ draft, layout, operbox: box });
  const room = evaluation.roomsByShift[0]?.find(item => item.roomId === "trade_1");
  assert.ok(room);
  assert.equal(room.specialTradeAnchor?.tradeUnitOutputPerDay, 12_739.73);
  assert.equal(room.specialTradeAnchor?.goldUnitOutputPerDay, 2_328.77);
  assert.equal(room.goldEquivalentEfficiency, 0.252);
});
