import assert from "node:assert/strict";
import test from "node:test";

import { trainingPlannerTargetFromAdvice } from "./training-planner-handoff.ts";

test("accepts only explicit targets within the operator's promotion and level limits", () => {
  const operator = { id: "char_100_test", rarity: 6 };
  assert.deepEqual(trainingPlannerTargetFromAdvice(operator, { kind: "explicit", elite: 2, level: 90 }), {
    operatorId: operator.id,
    targetElite: 2,
    targetLevel: 90,
  });
  assert.deepEqual(trainingPlannerTargetFromAdvice(operator, { kind: "explicit", elite: 1 }), {
    operatorId: operator.id,
    targetElite: 1,
    targetLevel: 1,
  });
  assert.equal(trainingPlannerTargetFromAdvice(operator, { kind: "needs_review", elite: 2, level: 90 }), null);
  assert.equal(trainingPlannerTargetFromAdvice(operator, { kind: "derive_from_skill_binding", elite: 2, level: 90 }), null);
  assert.equal(trainingPlannerTargetFromAdvice(operator, { kind: "explicit", elite: 3, level: 90 }), null);
  assert.equal(trainingPlannerTargetFromAdvice(operator, { kind: "explicit", elite: 2, level: 91 }), null);
});
