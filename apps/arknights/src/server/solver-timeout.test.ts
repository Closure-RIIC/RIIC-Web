import assert from "node:assert/strict";
import test from "node:test";

import { planCacheLeaseDurationMs, solverTimeoutMs } from "./solver-timeout.ts";

test("invalid solver timeout values use the same 180 second default", () => {
  for (const value of ["", " ", "0", "-1", "NaN", "Infinity", "bad"]) assert.equal(solverTimeoutMs(value), 180_000);
  assert.equal(solverTimeoutMs("120000"), 120_000);
  assert.equal(solverTimeoutMs("0.5"), 1);
  assert.equal(solverTimeoutMs("999999999999"), 2_146_980_000);
});

test("cache leases exceed the effective solver timer and retain the wait margin", () => {
  const previous = process.env.BETA_CLI_TIMEOUT_MS;
  try {
    delete process.env.BETA_CLI_TIMEOUT_MS;
    assert.equal(solverTimeoutMs(), 180_000);
    assert.equal(planCacheLeaseDurationMs(), 195_000);
    assert.equal(planCacheLeaseDurationMs() + 5000, 200_000);
    process.env.BETA_CLI_TIMEOUT_MS = "120000";
    assert.equal(planCacheLeaseDurationMs(), 135_000);
    process.env.BETA_CLI_TIMEOUT_MS = "1";
    assert.equal(planCacheLeaseDurationMs(), 30_000);
    process.env.BETA_CLI_TIMEOUT_MS = "999999999999";
    assert.ok(planCacheLeaseDurationMs() > solverTimeoutMs());
    assert.ok(planCacheLeaseDurationMs() + 5000 < 2_147_483_647);
  } finally {
    if (previous === undefined) delete process.env.BETA_CLI_TIMEOUT_MS;
    else process.env.BETA_CLI_TIMEOUT_MS = previous;
  }
});
