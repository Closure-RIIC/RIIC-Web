import test from "node:test";
import assert from "node:assert/strict";
import { completeSolverActivity } from "../src/solver-activity.ts";

const activity = { id: 1, kind: "schedule", phase: "running", stage: "searching", startedAt: 10, elapsedMs: 0 };
const result = { elapsedMs: 1500, center: {}, verification: { ok: true, errors: [] }, status: { searchComplete: true } };

test("only a verified result with an actual plan finishes successfully", () => {
  assert.equal(completeSolverActivity(activity, result).phase, "success");
  const empty = completeSolverActivity(activity, { ...result, center: null });
  assert.equal(empty.phase, "error");
  assert.equal(empty.problem, "empty");
  const invalid = completeSolverActivity(activity, { ...result, verification: { ok: false, errors: ["Invalid crew"] } });
  assert.equal(invalid.phase, "error");
  assert.equal(invalid.problem, "verification");
  assert.equal(invalid.error, "Invalid crew");
});

test("budget-limited candidates are distinguished from complete search and manual evaluation", () => {
  const limited = { ...result, status: { searchComplete: false } };
  assert.equal(completeSolverActivity(activity, limited).limited, true);
  assert.equal(completeSolverActivity(activity, limited).phase, "success");
  const manual = completeSolverActivity({ ...activity, kind: "manual" }, limited);
  assert.equal(manual.limited, false);
  assert.equal(manual.elapsedMs, result.elapsedMs);
  assert.equal(manual.id, activity.id);
});
