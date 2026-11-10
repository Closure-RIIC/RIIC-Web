import assert from "node:assert/strict";
import test from "node:test";
import { createManualScheduleDraft, assignManualOperator, clearManualRoom, setManualRoomProduct } from "./manual-schedule.ts";
import { draftHistoryReducer, manualEvaluationInputKey, manualProductionDeltas, type DraftHistory } from "./manual-editing.ts";
import type { BaseBlueprint } from "@riic/arknights-domain/types";
import type { ManualPlanResult } from "./manual-plan-result.ts";

const layout: BaseBlueprint = { template: "243", drone_cap: 0, scenario: {}, rooms: [{ id: "manu_1", kind: "factory", level: 3, product: { factory: { recipe: "gold" } } }] };
const initial = () => createManualScheduleDraft([12, 12]);

test("undo restores assignments and products, and does not count navigation, restoration or no-op edits", () => {
  const original = initial(); let state: DraftHistory = { present: original, past: [] };
  state = draftHistoryReducer(state, { type: "sync", update: original });
  state = draftHistoryReducer(state, { type: "edit", update: draft => assignManualOperator({ draft, layout, shiftIndex: 0, roomId: "manu_1", slotIndex: 0, operator: "阿米娅" }).draft });
  const assigned = state.present;
  state = draftHistoryReducer(state, { type: "sync", update: draft => ({ ...draft, activeShift: 1 }) });
  state = draftHistoryReducer(state, { type: "edit", update: draft => ({ ...draft }) });
  assert.equal(state.past.length, 1);
  state = draftHistoryReducer(state, { type: "edit", update: draft => setManualRoomProduct(draft, layout, 0, "manu_1", { factory: { recipe: "battle_record" } }) });
  const changedProduct = state.present;
  state = draftHistoryReducer(state, { type: "edit", update: draft => clearManualRoom(draft, layout, 0, "manu_1") });
  state = draftHistoryReducer(state, { type: "undo" }); assert.deepEqual(state.present, changedProduct);
  state = draftHistoryReducer(state, { type: "undo" }); assert.deepEqual(state.present.shifts, assigned.shifts);
  state = draftHistoryReducer(state, { type: "undo" }); assert.deepEqual(state.present, original);
  assert.deepEqual(original, initial()); assert.equal(state.past.length, 0);
});

test("history is capped and external context changes discard incompatible undo entries", () => {
  let state: DraftHistory = { present: initial(), past: [] };
  for (let i = 0; i < 65; i++) state = draftHistoryReducer(state, { type: "edit", update: draft => ({ ...draft, startTime: String(i) }) });
  assert.equal(state.past.length, 50);
  state = draftHistoryReducer(state, { type: "undo" });
  state = draftHistoryReducer(state, { type: "edit", update: draft => ({ ...draft, startTime: "new edit" }) });
  assert.equal(state.present.startTime, "new edit");
  state = draftHistoryReducer(state, { type: "reset" }); assert.equal(state.past.length, 0);
  assert.equal(draftHistoryReducer(state, { type: "undo" }), state);
});

test("result provenance ignores navigation and clock labels but detects changed assignments, Box, layout and calculation mode", () => {
  const draft = initial(); const key = manualEvaluationInputKey(layout, draft, [], "native");
  assert.equal(manualEvaluationInputKey(layout, { ...draft, activeShift: 1, startTime: "13:00" }, [], "native"), key);
  const edited = assignManualOperator({ draft, layout, shiftIndex: 0, roomId: "manu_1", slotIndex: 0, operator: "阿米娅" }).draft;
  assert.notEqual(manualEvaluationInputKey(layout, edited, [], "native"), key);
  assert.notEqual(manualEvaluationInputKey({ ...layout, drone_cap: 200 }, draft, [], "native"), key);
  assert.notEqual(manualEvaluationInputKey(layout, draft, [{ id: "char_002_amiya", name: "阿米娅", elite: 2, level: 80, own: true, potential: 6, rarity: 5 }], "native"), key);
  assert.notEqual(manualEvaluationInputKey(layout, draft, [], "manual"), key);
  assert.equal(manualEvaluationInputKey(layout, JSON.parse(JSON.stringify(draft)), [], "native"), key);
});

function result(): ManualPlanResult {
  return { kind: "manual", revision: 1, layout, maa: { title: "fixture", plans: [] }, roomsByShift: [], warnings: [], elapsedMs: 1,
    rotation: { profile: "abc_12_12_12", shifts: [], daily: { trade: 0, manufacture: 0, power: 0,
      production: { lmd: 10000, pure_gold: 5000, equivalent_gold: 1000, battle_records: 20000, originium_shards: 0, orundum: 0 },
      drone_production: { lmd: 500, pure_gold: 1000, battle_records: 1000 } } } };
}

test("daily deltas use displayed units and shared drone/equivalent-gold accounting, including zero and negative changes", () => {
  const baseline = result(); const current = structuredClone(baseline);
  current.rotation.daily.production!.pure_gold += 1000;
  current.rotation.daily.production!.equivalent_gold! += 500;
  current.rotation.daily.production!.battle_records -= 1000;
  current.rotation.daily.drone_production!.lmd += 500;
  const delta = manualProductionDeltas(current, baseline);
  assert.equal(delta.gold, 3); assert.equal(delta['lmd-orders'], 500); assert.equal(delta.experience, -1000); assert.equal(delta.orundum, 0);
  current.rotation.daily.production!.battle_records = NaN;
  assert.equal(manualProductionDeltas(current, baseline).experience, null);
  assert.equal(baseline.rotation.daily.production!.pure_gold, 5000);
});
