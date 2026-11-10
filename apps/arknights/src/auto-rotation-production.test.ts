import assert from "node:assert/strict";
import test from "node:test";
import type { AutoRotationResult, AutoRotationState } from "@riic/arknights-domain/auto-rotation";
import type { BaseBlueprint } from "@riic/arknights-domain/types";
import { autoRotationProduction } from "./auto-rotation-production.ts";

function fixture() {
  const layout: BaseBlueprint = { template: "243", drone_cap: 250, scenario: {}, rooms: [
    { id: "trade_1", kind: "trade_post", level: 3, product: { trade: { order: "gold" } } },
    { id: "manu_1", kind: "factory", level: 3, product: { factory: { recipe: "gold" } } },
    { id: "manu_2", kind: "factory", level: 3, product: { factory: { recipe: "battle_record" } } },
    { id: "power_1", kind: "power_plant", level: 3 },
  ] };
  const state = (extra: Partial<AutoRotationState>): AutoRotationState => ({ operators: ["阿米娅"], evaluationHours: 32, complete: true, missingSeats: 0, ...extra });
  const result: AutoRotationResult = { mode: "auto", hours: [32, 32], complete: true, rooms: [
    { roomId: "trade_1", kind: "trade_post", main: state({ efficiency: { final_efficiency: 4, order_multiplier: 2, gold_equivalent_efficiency: 0.3, gold_output_multiplier: 0.15 }, productionPerDay: 42_424 }), backup: state({ efficiency: { final_efficiency: 2, order_multiplier: 1 }, productionPerDay: 20_530 }) },
    { roomId: "manu_1", kind: "factory", main: state({ efficiency: { final_efficiency: 2.45 }, productionPerDay: 24_500 }), backup: state({ efficiency: { final_efficiency: 2 }, productionPerDay: 20_000 }) },
    { roomId: "manu_2", kind: "factory", main: state({ efficiency: { final_efficiency: 2.1 }, productionPerDay: 16_800 }), backup: state({ efficiency: { final_efficiency: 1.5 }, productionPerDay: 12_000 }) },
    { roomId: "power_1", kind: "power_plant", main: state({ powerChargeEfficiency: 0.25 }), backup: state({ powerChargeEfficiency: 0.5 }) },
  ], dormSupport: [], fiammetta: null, warnings: [], durationMs: 1, diagnosticId: "production-test" };
  return { layout, result };
}

function product(model: ReturnType<typeof autoRotationProduction>, id: string) {
  return model.presentation.groups.flatMap(group => [group.primary, ...(group.supporting ? [group.supporting] : [])]).find(item => item.id === id)!;
}
const close = (actual: number | null | undefined, expected: number) => assert.ok(actual != null && Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

const disabled = { main: null, backup: null } as const;

test("whole-plan natural output includes both windows and never sums two daily totals", () => {
  const input = fixture();
  const before = structuredClone(input);
  const model = autoRotationProduction({ ...input, selectedDroneRooms: disabled });
  close(model.drones, 342); // (312 + 372) / 2
  close(product(model, "experience").amount.value, 14_400);
  close(product(model, "lmd-orders").amount.value, 31_477);
  assert.equal(product(model, "gold").amount.value, 57); // (22250 + 1500 equivalent + 5000 daily) / 500
  assert.equal(model.presentation.source, "estimate");
  assert.equal(model.presentation.solverProduction, null);
  assert.deepEqual(input, before);
});

test("unequal evaluation windows use their durations and normalize the complete period", () => {
  const input = fixture();
  input.result.hours = [8, 24];
  const model = autoRotationProduction({ ...input, selectedDroneRooms: disabled });
  close(product(model, "experience").amount.value, 13_200);
  close(product(model, "lmd-orders").amount.value, 26_003.5);
  close(model.drones, 357);
  assert.equal(product(model, "gold").amount.value, 53);
});

test("automatic drone allocation balances the complete plan rather than choosing each queue in isolation", () => {
  const input = fixture();
  const trade = input.result.rooms[0];
  for (const queue of ["main", "backup"] as const) {
    trade[queue].productionPerDay = 26_000;
    trade[queue].efficiency = { final_efficiency: 2.5, order_multiplier: 1, gold_equivalent_efficiency: 0, gold_output_multiplier: 0 };
    input.result.rooms[1][queue].productionPerDay = 20_000;
  }
  const model = autoRotationProduction(input);
  // Each queue alone would prefer gold; the joint trade/gold combination is closer to balance.
  assert.equal(model.queues.main.allocation?.target.roomId, "trade_1");
  assert.equal(model.queues.backup.allocation?.target.roomId, "manu_1");
  close(model.presentation.droneProduction?.lmd, 3336.125);
  close(model.presentation.droneProduction?.pure_gold, 3875);
  close(product(model, "lmd-orders").amount.value, 29_336.125);
});

test("one queue's manual drone contribution is weighted once and retains special trade multipliers", () => {
  const input = fixture();
  const model = autoRotationProduction({ ...input, selectedDroneRooms: { main: "trade_1", backup: null } });
  close(model.presentation.droneProduction?.lmd, 6672.25);
  close(model.presentation.droneProduction?.pure_gold, 487.5);
  close(product(model, "lmd-orders").amount.value, 38_149.25);
  assert.equal(product(model, "gold").amount.value, 58);
  const experience = autoRotationProduction({ ...input, selectedDroneRooms: { main: "manu_2", backup: null } });
  close(product(experience, "experience").amount.value, 17_000);
  const both = autoRotationProduction({ ...input, selectedDroneRooms: { main: "manu_2", backup: "manu_2" } });
  close(product(both, "experience").amount.value, 20_100);
});

test("gold is combined before rounding and the daily allowance is added once", () => {
  const input = fixture();
  for (const queue of ["main", "backup"] as const) input.result.rooms[0][queue].efficiency!.gold_equivalent_efficiency = 0;
  input.result.rooms[1].main.productionPerDay = 499;
  input.result.rooms[1].backup.productionPerDay = 501;
  const model = autoRotationProduction({ ...input, selectedDroneRooms: disabled });
  assert.equal(product(model, "gold").amount.value, 11);
  assert.ok(product(model, "gold").rows.some(([label, value]) => label === "日常获取" && value === 10));
});

test("originium stage capacities are combined over the complete period before applying the bottleneck", () => {
  const input = fixture();
  input.layout.rooms[0].product = { trade: { order: "originium" } };
  input.layout.rooms[1].product = { factory: { recipe: "originium" } };
  input.result.rooms[0].main.productionPerDay = 240;
  input.result.rooms[0].backup.productionPerDay = 0;
  input.result.rooms[1].main.productionPerDay = 0;
  input.result.rooms[1].backup.productionPerDay = 24;
  const model = autoRotationProduction({ ...input, selectedDroneRooms: disabled });
  close(product(model, "shards").amount.value, 12);
  close(product(model, "orundum").amount.value, 120);
});

test("153 accelerates experience across both windows and falls back to trade", () => {
  const input = fixture();
  input.layout.template = "153";
  const model = autoRotationProduction(input);
  assert.equal(model.queues.main.allocation?.target.roomId, "manu_2");
  assert.equal(model.queues.backup.allocation?.target.roomId, "manu_2");
  close(product(model, "experience").amount.value, 20_100);
  input.layout.rooms = input.layout.rooms.filter(room => room.id !== "manu_2");
  const fallback = autoRotationProduction(input);
  assert.equal(fallback.queues.main.allocation?.target.roomId, "trade_1");
  assert.equal(fallback.queues.backup.allocation?.target.roomId, "trade_1");
});

test("an unknown recipe or one missing queue snapshot cannot become a complete known total", () => {
  const input = fixture();
  input.layout.rooms.find(room => room.id === "manu_1")!.product = { factory: { recipe: "all" } };
  const ambiguous = autoRotationProduction({ ...input, selectedDroneRooms: disabled });
  assert.equal(product(ambiguous, "gold").amount.value, null);
  assert.equal(product(ambiguous, "gold").amount.unavailableReason, "ambiguous-recipe");
  assert.ok(!ambiguous.queues.main.candidates.some(candidate => candidate.target.roomId === "manu_1"));
  const missing = fixture();
  delete missing.result.rooms[0].backup.efficiency;
  delete missing.result.rooms[0].backup.productionPerDay;
  const model = autoRotationProduction({ ...missing, selectedDroneRooms: disabled });
  assert.equal(product(model, "lmd-orders").amount.value, null);
  assert.equal(product(model, "gold").amount.value, null);
  assert.equal(product(model, "gold").amount.unavailableReason, "missing-room-data");
  assert.ok(product(model, "gold").rows.some(([label, value]) => label === "估算等效赤金" && value === null));
});

test("missing power affects the selected product while the other queue's disabled output stays zero", () => {
  const input = fixture();
  delete input.result.rooms.find(room => room.roomId === "power_1")!.main.powerChargeEfficiency;
  const model = autoRotationProduction({ ...input, selectedDroneRooms: { main: "manu_2", backup: null } });
  assert.equal(model.drones, null);
  assert.equal(product(model, "experience").amount.value, null);
  assert.equal(product(model, "experience").amount.unavailableReason, "missing-drone-data");
  close(product(model, "lmd-orders").amount.value, 31_477);
  assert.equal(product(model, "gold").amount.value, 57);
  const trade = autoRotationProduction({ ...input, selectedDroneRooms: { main: "trade_1", backup: null } });
  assert.equal(product(trade, "lmd-orders").amount.value, null);
  assert.equal(product(trade, "gold").amount.value, null);
  close(product(trade, "experience").amount.value, 14_400);
});
