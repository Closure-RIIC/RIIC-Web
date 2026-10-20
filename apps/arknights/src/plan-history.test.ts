import assert from "node:assert/strict";
import test from "node:test";

import { parsePlanHistory } from "./plan-history.ts";
import { SESSION_TTL_MS } from "./persistence.ts";

const now = Date.parse("2026-08-16T00:00:00.000Z");
const validResult = {
  profile: { repoRoot: "/secret" },
  maa: { title: "test", plans: [{ name: "第一班", rooms: {} }], stderr: "secret" },
  rotation: { profile: "balanced", shifts: [{ index: 0, duration_hours: 24 }] },
  trainingRoom: { schema_version: 1, shifts: [{ trainee: "能天使", trainer: null }] },
  durationMs: 123,
  diagnosticId: "diagnostic-1",
  debug: { stdout: "secret" },
};

test("plan history rejects expired and malformed entries", () => {
  const entries = parsePlanHistory(JSON.stringify([
    { savedAt: new Date(now - SESSION_TTL_MS).toISOString(), result: validResult },
    { savedAt: "invalid", result: validResult },
  ]), now);
  assert.deepEqual(entries, []);
});

test("plan history normalizes public data and strips internal fields", () => {
  const [entry] = parsePlanHistory(JSON.stringify([
    { savedAt: new Date(now - 1_000).toISOString(), result: validResult },
  ]), now);
  assert.ok(entry);
  assert.equal("debug" in entry.result, false);
  assert.equal("repoRoot" in entry.result.profile, false);
  assert.equal("stderr" in entry.result.maa, false);
  assert.deepEqual(entry.result.trainingRoom, {
    schema_version: 1,
    shifts: [{ trainee: "能天使", trainer: null }],
  });
});
