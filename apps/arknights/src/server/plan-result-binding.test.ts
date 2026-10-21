import assert from "node:assert/strict";
import test from "node:test";

import type { PublicPlanData } from "../types.ts";
import { publicPlanSha256, resolveSavedPlanCalculationContext } from "./plan-result-binding.ts";

function result(durationMs = 100): PublicPlanData {
  return {
    profile: { name: "test" },
    maa: { plans: [] },
    rotation: { profile: "abc_12_6_6", shifts: [] },
    durationMs,
    diagnosticId: "diagnostic-1",
  } as unknown as PublicPlanData;
}

test("public plan binding is stable across object key order", () => {
  const original = result();
  const reordered = {
    diagnosticId: original.diagnosticId,
    durationMs: original.durationMs,
    rotation: original.rotation,
    maa: original.maa,
    profile: original.profile,
  } as PublicPlanData;
  assert.equal(publicPlanSha256(original), publicPlanSha256(reordered));
});

test("public plan binding changes when persisted result data changes", () => {
  assert.notEqual(publicPlanSha256(result(100)), publicPlanSha256(result(101)));
});

test("saved plan context resolves automatic factory recipes from the computed plan", () => {
  const publicResult = result();
  publicResult.maa.plans = [{
    name: "plan",
    rooms: { manufacture: [{ product: "Pure Gold", operators: [] }] },
  }];
  const context = resolveSavedPlanCalculationContext({
    presetLabel: "243",
    layout: {
      template: "243",
      drone_cap: 235,
      scenario: {},
      rooms: [{ id: "manu_1", kind: "factory", level: 3, product: { factory: { recipe: "all" } } }],
    },
    rotationProfile: "abc_12_6_6",
    fiammettaEnabled: false,
  }, publicResult);
  assert.deepEqual(context.layout.rooms[0]?.product, { factory: { recipe: "gold" } });
});
