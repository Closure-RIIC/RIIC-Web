import assert from "node:assert/strict";
import test from "node:test";

import { createCalculatorProductionPresentation, createManualProductionPresentation } from "./production-summary-adapters.ts";
import type { BaseBlueprint, MaaJson, RotationJson } from "./types.ts";

const layout: BaseBlueprint = {
  template: "243",
  drone_cap: 0,
  scenario: {},
  rooms: [{ id: "trade_1", kind: "trade_post", level: 3, product: { trade: { order: "gold" } } }],
};
const maa: MaaJson = { title: "test", plans: [{ name: "1", rooms: { trading: [{ operators: [], product: "LMD" }] } }] };
const rotation: RotationJson = {
  profile: "abc_12_12_12",
  shifts: [{ index: 0, duration_hours: 24, active_teams: [], resting_team: "", scores: { trade_score: 1, manu_prod_sum: 0, power_charge_sum: 0, room_lines: [{ room_id: "trade_1", total_efficiency: 1, final_efficiency: 1, order_multiplier: 1 }] }, weighted_trade: 1, weighted_manu: 0, weighted_power: 0 }],
  daily: { trade: 1, manufacture: 0, power: 0, production: { lmd: 12_345, pure_gold: 0, battle_records: 0, originium_shards: 0, orundum: 0 } },
};

test("calculator presentation keeps solver totals authoritative", () => {
  const model = createCalculatorProductionPresentation({ layout, maa, rotation });
  assert.equal(model.source, "solver");
  assert.equal(model.groups.find((group) => group.id === "lmd")?.primary.amount.value, 12_345);
});

test("manual presentation stays pending until evaluated", () => {
  const model = createManualProductionPresentation({ computed: false, layout, maa, evaluation: null });
  assert.equal(model.source, "pending");
  assert.equal(model.detailsAvailable, false);
});

test("manual presentation never treats local rotation production as solver output", () => {
  const model = createManualProductionPresentation({ computed: true, layout, maa, evaluation: { rotation, roomsByShift: [], warnings: [], elapsedMs: 1 } });
  assert.equal(model.source, "estimate");
  assert.equal(model.solverProduction, null);
});
