import assert from "node:assert/strict";
import test from "node:test";
import { withDefaultDormAutofill } from "./automatic-dorm-defaults.ts";
import { prepareMaaForExport } from "./maa-safety.ts";
import type { PublicPlanData } from "./types.ts";

test("new results enable every dorm in every shift without mutating solver data", () => {
  const source = { maa: { plans: [0, 1].map(() => ({ rooms: {
    dormitory: Array.from({ length: 4 }, () => ({ operators: [], autofill: false, candidates: ["杜林"] })),
    trading: [{ operators: [], autofill: false }],
  } })) } } as unknown as PublicPlanData;
  const next = withDefaultDormAutofill(source);
  for (const plan of next.maa.plans) {
    assert.deepEqual(plan.rooms.dormitory?.map(room => room.autofill), [true, true, true, true]);
    assert.ok(plan.rooms.dormitory?.every(room => room.candidates === undefined));
    assert.equal(plan.rooms.trading?.[0]?.autofill, false);
  }
  assert.equal(source.maa.plans[0].rooms.dormitory?.[0]?.autofill, false);
  next.maa.plans[0].rooms.dormitory![0].autofill = false;
  assert.equal(prepareMaaForExport(next.maa).plans[0].rooms.dormitory?.[0]?.autofill, true);
});
