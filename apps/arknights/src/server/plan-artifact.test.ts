import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

register("../../../../scripts/ts-path-loader.mjs", import.meta.url);

test("pending plan envelopes resume into finalized private artifacts", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "arkinfra-artifact-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const storageRoot = path.join(root, "storage");
  const runsRoot = path.join(storageRoot, "cli-runs");
  const runRoot = path.join(runsRoot, "pending-run");
  await mkdir(runRoot, { recursive: true });

  process.env.BETA_STORAGE_DIR = storageRoot;
  process.env.BETA_CLI_RUN_DIR = runsRoot;
  process.env.BETA_FEEDBACK_DIR = path.join(storageRoot, "feedback");
  process.env.BETA_BUSINESS_DB_ENABLED = "0";

  const diagnosticId = "11111111-1111-4111-8111-111111111111";
  const startedAt = new Date().toISOString();
  const ownerTag = "a".repeat(64);
  const envelopePath = path.join(runRoot, "run-envelope.json");
  await writeFile(envelopePath, JSON.stringify({
    version: "plan-run-envelope-v1",
    diagnosticId,
    dataOwnerTag: ownerTag,
    result: {
      success: false,
      startedAt,
      runId: diagnosticId,
      error: "fixture",
    },
  }), "utf-8");

  const {
    finalizePlanArtifactEnvelope,
    PRIVATE_RECORD_TTL_MS,
    resumePendingPlanArtifactFinalizations,
    waitForPlanArtifactFinalizers,
  } = await import("@riic/platform-server/infra");

  assert.equal(PRIVATE_RECORD_TTL_MS, 30 * 24 * 60 * 60 * 1000);

  assert.equal(await resumePendingPlanArtifactFinalizations(), 1);
  assert.equal(await waitForPlanArtifactFinalizers(5_000), true);
  assert.equal(JSON.parse(await readFile(path.join(runRoot, "result.json"), "utf-8")).runId, diagnosticId);
  assert.deepEqual(JSON.parse(await readFile(path.join(runRoot, "owner.json"), "utf-8")), {
    version: 1,
    ownerTag,
    diagnosticId,
    sourceName: null,
    createdAt: startedAt,
  });
  assert.equal(JSON.parse(await readFile(path.join(runRoot, "artifact-expanded.json"), "utf-8")).diagnosticId, diagnosticId);
  assert.equal(JSON.parse(await readFile(path.join(runRoot, "artifact-finalized.json"), "utf-8")).diagnosticId, diagnosticId);
  assert.equal(await resumePendingPlanArtifactFinalizations(), 0);

  const outsideEnvelope = path.join(storageRoot, "outside-envelope.json");
  await writeFile(outsideEnvelope, "{}", "utf-8");
  await assert.rejects(
    finalizePlanArtifactEnvelope(outsideEnvelope),
    /outside private storage/,
  );
  const invalidRunRoot = path.join(runsRoot, "invalid-run");
  await mkdir(invalidRunRoot, { recursive: true });
  await writeFile(path.join(invalidRunRoot, "run-envelope.json"), "{}", "utf-8");
  assert.equal(await resumePendingPlanArtifactFinalizations(), 1);
  assert.equal(await waitForPlanArtifactFinalizers(5_000), true);
  const failed = JSON.parse(await readFile(path.join(invalidRunRoot, "artifact-failed.json"), "utf-8"));
  assert.equal(failed.reason, "invalid-envelope");
  assert.equal(await resumePendingPlanArtifactFinalizations(), 0);

  const orphanRunRoot = path.join(runsRoot, "orphan-run");
  await mkdir(orphanRunRoot, { recursive: true });
  const orphanEnvelopePath = path.join(orphanRunRoot, "run-envelope.json");
  await writeFile(orphanEnvelopePath, JSON.stringify({
    version: "plan-run-envelope-v1",
    diagnosticId: "22222222-2222-4222-8222-222222222222",
    dataOwnerTag: null,
    result: {
      success: false,
      startedAt,
      runId: "22222222-2222-4222-8222-222222222222",
      error: "crashed before recordRun",
    },
  }), "utf-8");
  assert.equal(await resumePendingPlanArtifactFinalizations({
    updateArtifact: async () => "missing",
    missingRunGraceMs: 0,
    retryMs: [],
  }), 1);
  assert.equal(await waitForPlanArtifactFinalizers(5_000), true);
  const orphanFailed = JSON.parse(await readFile(path.join(orphanRunRoot, "artifact-failed.json"), "utf-8"));
  assert.equal(orphanFailed.reason, "missing-run-record");
  assert.equal(await resumePendingPlanArtifactFinalizations(), 0);

  const recoveringRunRoot = path.join(runsRoot, "recovering-run");
  await mkdir(recoveringRunRoot, { recursive: true });
  const retainedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  await writeFile(path.join(recoveringRunRoot, "run-envelope.json"), JSON.stringify({
    version: "plan-run-envelope-v1",
    diagnosticId: "33333333-3333-4333-8333-333333333333",
    dataOwnerTag: null,
    result: {
      success: true,
      startedAt: retainedAt.toISOString(),
      runId: "33333333-3333-4333-8333-333333333333",
    },
  }), "utf-8");
  const recoveringEnvelopePath = path.join(recoveringRunRoot, "run-envelope.json");
  await utimes(recoveringEnvelopePath, retainedAt, retainedAt);
  const updateStatuses: string[] = [];
  assert.equal(await resumePendingPlanArtifactFinalizations({
    updateArtifact: async ({ status }) => {
      updateStatuses.push(status);
      return updateStatuses.length === 1 ? "unavailable" : "updated";
    },
    retryMs: [],
    slowRetryMs: 0,
  }), 1);
  assert.equal(await waitForPlanArtifactFinalizers(5_000), true);
  assert.deepEqual(updateStatuses, ["complete", "complete"]);
  assert.equal(
    JSON.parse(await readFile(path.join(recoveringRunRoot, "artifact-finalized.json"), "utf-8")).diagnosticId,
    "33333333-3333-4333-8333-333333333333",
  );
  await assert.rejects(
    readFile(path.join(recoveringRunRoot, "artifact-failed.json"), "utf-8"),
    (error: NodeJS.ErrnoException) => error.code === "ENOENT",
  );

  const expiredRunRoot = path.join(runsRoot, "retention-expired-run");
  await mkdir(expiredRunRoot, { recursive: true });
  const expiredEnvelopePath = path.join(expiredRunRoot, "run-envelope.json");
  const expiredDiagnosticId = "44444444-4444-4444-8444-444444444444";
  await writeFile(expiredEnvelopePath, JSON.stringify({
    version: "plan-run-envelope-v1",
    diagnosticId: expiredDiagnosticId,
    dataOwnerTag: null,
    result: {
      success: false,
      startedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      runId: expiredDiagnosticId,
      error: "retention fixture",
    },
  }), "utf-8");
  const expiredAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  await utimes(expiredEnvelopePath, expiredAt, expiredAt);
  assert.equal(await resumePendingPlanArtifactFinalizations({
    updateArtifact: async () => "unavailable",
    retryMs: [],
    slowRetryMs: 0,
  }), 1);
  assert.equal(await waitForPlanArtifactFinalizers(5_000), true);
  const retentionFailure = JSON.parse(await readFile(path.join(expiredRunRoot, "artifact-failed.json"), "utf-8"));
  assert.equal(retentionFailure.reason, "retention-exceeded");
});
