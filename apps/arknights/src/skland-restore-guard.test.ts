import assert from "node:assert/strict";
import test from "node:test";

import { createSklandRestoreGuard } from "./skland-restore-guard.ts";

test("a complete restore wins over a late identity summary", () => {
  const guard = createSklandRestoreGuard();
  const generation = guard.begin();
  assert.equal(guard.canApplySummary(generation), true);
  assert.equal(guard.acceptFull(generation), true);
  assert.equal(guard.canApplySummary(generation), false);
});

test("a failed complete restore still permits the independent summary to preserve identity", () => {
  const guard = createSklandRestoreGuard();
  const generation = guard.begin();
  assert.equal(guard.isCurrent(generation), true);
  assert.equal(guard.canApplySummary(generation), true);
});

test("login, logout, or role changes invalidate every response from the previous generation", () => {
  const guard = createSklandRestoreGuard();
  const initialRestore = guard.begin();
  const logout = guard.begin();
  assert.equal(guard.isCurrent(initialRestore), false);
  assert.equal(guard.canApplySummary(initialRestore), false);
  assert.equal(guard.acceptFull(initialRestore), false);
  assert.equal(guard.acceptFull(logout), true);
  assert.equal(guard.canApplySummary(logout), false);
});
