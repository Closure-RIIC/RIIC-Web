import assert from "node:assert/strict";
import test from "node:test";

import { legacyFeedbackSummary, legacyPlanRunSummary } from "./business-backfill.ts";

const artifact = { key: "opaque-id", bytes: 12, sha256: "a".repeat(64) };

test("legacy plan backfill extracts only the run summary whitelist", () => {
  const summary = legacyPlanRunSummary({
    result: {
      runId: "00000000-0000-0000-0000-000000000001",
      success: true,
      durationMs: 123,
      command: "must-not-survive",
      stdout: "must-not-survive",
      debugBundle: {
        inputSummary: { sourceName: "box.json" },
        operbox: [{ token: "must-not-survive" }],
        serveRequest: { params: { options: { fiammetta_enable: false } } },
      },
      solver: { protocol_version: 1, plan_schema_version: 3, solver_executable_sha256: "b".repeat(64), observed_at: "2026-08-21T00:00:00.000Z" },
    },
    owner: null,
    layout: { template: "243", rooms: [{ id: "room" }] },
    operboxCount: 1,
    artifact,
    directoryCreatedAt: new Date("2026-08-21T00:00:00.000Z"),
  });
  assert.ok(summary);
  assert.equal(summary.fiammettaEnable, false);
  const serialized = JSON.stringify(summary);
  for (const forbidden of ["command", "stdout", "token", "debugBundle", "box.json"]) assert.equal(serialized.includes(forbidden), false);
});

test("legacy feedback backfill rejects corrupt data and keeps only the room whitelist", () => {
  assert.equal(legacyFeedbackSummary({ meta: {}, issue: {}, artifact, directoryCreatedAt: new Date() }), null);
  const summary = legacyFeedbackSummary({
    meta: { feedbackId: "feedback-1", diagnosticId: "diag-1", kind: "room_issue", savedAt: "2026-08-21T00:00:00.000Z", dataOwnerTag: "hidden" },
    issue: { room: { id: "room", title: "制造站", group: "manufacture", operators: ["能天使"], command: "hidden" }, note: "说明", token: "hidden" },
    artifact,
    directoryCreatedAt: new Date(),
  });
  assert.deepEqual(summary?.room, { id: "room", title: "制造站", group: "manufacture", operators: ["能天使"] });
  assert.equal(JSON.stringify(summary).includes("hidden"), false);
});
