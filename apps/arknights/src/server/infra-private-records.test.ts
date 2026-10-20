import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { BaseBlueprint } from "../types.ts";
import {
  isLegacySklandRunDirectoryName,
  isPrivateStorageChild,
  isSafePrivateStorageRoot,
} from "./private-storage.ts";
import { REQUIRED_RUNTIME_DATA_FILES, resolveRuntimeDataDir } from "./runtime-data.ts";

register("../../../../scripts/ts-path-loader.mjs", import.meta.url);

test("private record deletion accepts only strict children of the configured root", () => {
  const root = path.resolve("private-record-test-root");
  assert.equal(isPrivateStorageChild(root, path.join(root, "run-1")), true);
  assert.equal(isPrivateStorageChild(root, path.join(root, "nested", "run-2")), true);
  assert.equal(isPrivateStorageChild(root, root), false);
  assert.equal(isPrivateStorageChild(root, path.dirname(root)), false);
  assert.equal(isPrivateStorageChild(root, path.resolve(`${root}-sibling`, "run-3")), false);
});

test("legacy migration recognizes both current and old identifying Skland run labels", () => {
  assert.equal(isLegacySklandRunDirectoryName("2026-08-05_森空岛同步_run-id"), true);
  assert.equal(isLegacySklandRunDirectoryName("2026-07-01_skland_123456789_1700000000_run-id"), true);
  assert.equal(isLegacySklandRunDirectoryName("2026-08-05_MAA导入_run-id"), false);
});

test("private record deletion refuses filesystem and explicitly disallowed broad roots", () => {
  const workspace = path.resolve("workspace-root");
  const storage = path.join(workspace, "server", "storage");
  assert.equal(isSafePrivateStorageRoot(path.parse(storage).root), false);
  assert.equal(isSafePrivateStorageRoot(workspace, [workspace]), false);
  assert.equal(isSafePrivateStorageRoot(path.dirname(workspace), [workspace]), false);
  assert.equal(isSafePrivateStorageRoot(storage, [workspace]), true);
});

test("runtime data override is used only when the solver data set is complete", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "arkinfra-runtime-data-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const cliPath = path.join(root, "bin", "infra-cli");
  const configuredDataDir = path.join(root, "shared-data");
  await mkdir(configuredDataDir, { recursive: true });

  for (const fileName of REQUIRED_RUNTIME_DATA_FILES.slice(0, -1)) {
    await writeFile(path.join(configuredDataDir, fileName), "{}", "utf-8");
  }
  assert.equal(resolveRuntimeDataDir(cliPath, configuredDataDir), null);

  await writeFile(path.join(configuredDataDir, REQUIRED_RUNTIME_DATA_FILES.at(-1)!), "{}", "utf-8");
  assert.equal(resolveRuntimeDataDir(cliPath, configuredDataDir), path.resolve(configuredDataDir));
});

test("Skland owned-data deletion removes only matching runs and feedback without global maintenance", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "arkinfra-owned-delete-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const storageRoot = path.join(root, "storage");
  const runsRoot = path.join(storageRoot, "cli-runs");
  const feedbackRoot = path.join(storageRoot, "feedback");
  await Promise.all([
    mkdir(runsRoot, { recursive: true }),
    mkdir(feedbackRoot, { recursive: true }),
  ]);

  const targetOwnerTag = "a".repeat(64);
  const unrelatedOwnerTag = "b".repeat(64);
  const diagnosticId = "11111111-1111-4111-8111-111111111111";
  const targetRun = path.join(runsRoot, "target-run");
  const unrelatedRun = path.join(runsRoot, "expired-unrelated-run");
  const reproductionDiagnosticId = "22222222-2222-4222-8222-222222222222";
  const reproductionRun = path.join(runsRoot, `2026-09-02_MAA_${reproductionDiagnosticId}`);
  const legacyDiagnosticId = "44444444-4444-4444-8444-444444444444";
  const legacyRun = path.join(runsRoot, `2026-09-02_MAA_${legacyDiagnosticId}`);
  const invalidDiagnosticId = "55555555-5555-4555-8555-555555555555";
  const invalidRun = path.join(runsRoot, `2026-09-02_MAA_${invalidDiagnosticId}`);
  const embeddedDiagnosticId = "99999999-9999-4999-8999-999999999999";
  const embeddedRun = path.join(runsRoot, `2026-09-02_MAA_${embeddedDiagnosticId}`);
  const accountDiagnosticId = "aaaaaaaa-1111-4111-8111-111111111111";
  const accountRun = path.join(runsRoot, "account-owned-run");
  const linkedFeedback = path.join(feedbackRoot, "linked-feedback");
  const ownedFeedback = path.join(feedbackRoot, "owned-feedback");
  const unrelatedFeedback = path.join(feedbackRoot, "unrelated-feedback");
  const deletableFeedback = path.join(feedbackRoot, "deletable-feedback");
  const corruptFeedbackId = "33333333-3333-4333-8333-333333333333";
  const corruptFeedback = path.join(feedbackRoot, `2026-09-02_制造站_${corruptFeedbackId}`);
  await Promise.all([
    mkdir(targetRun),
    mkdir(unrelatedRun),
    mkdir(reproductionRun),
    mkdir(legacyRun),
    mkdir(invalidRun),
    mkdir(embeddedRun),
    mkdir(accountRun),
    mkdir(linkedFeedback),
    mkdir(ownedFeedback),
    mkdir(unrelatedFeedback),
    mkdir(deletableFeedback),
    mkdir(corruptFeedback),
  ]);
  await Promise.all([
    writeFile(path.join(targetRun, "owner.json"), JSON.stringify({ ownerTag: targetOwnerTag, diagnosticId })),
    writeFile(path.join(unrelatedRun, "owner.json"), JSON.stringify({ ownerTag: unrelatedOwnerTag })),
    writeFile(path.join(reproductionRun, "layout.json"), JSON.stringify({
      template: "243",
      drone_cap: 200,
      scenario: {},
      rooms: [
        { id: "control", kind: "control_center", level: 5 },
        { id: "power", kind: "power_plant", level: 3 },
      ],
    })),
    writeFile(path.join(reproductionRun, "operbox.json"), JSON.stringify([{
      id: "char_002_amiya",
      name: "阿米娅",
      own: true,
      level: 80,
      elite: 2,
      potential: 6,
      rarity: 5,
    }])),
    writeFile(path.join(reproductionRun, "reproduction.json"), JSON.stringify({
      sourceName: "MAA 导入",
      rotation: "abc_12_6_6",
      fiammettaEnabled: false,
    })),
    writeFile(path.join(reproductionRun, "result.json"), JSON.stringify({
      runId: reproductionDiagnosticId,
      success: false,
      error: "solver exited",
    })),
    writeFile(path.join(reproductionRun, "stderr.txt"), "debug tail"),
    writeFile(path.join(legacyRun, "result.json"), JSON.stringify({
      runId: legacyDiagnosticId,
      success: false,
      error: "legacy solver exited",
    })),
    writeFile(path.join(legacyRun, "debug-bundle.json"), JSON.stringify({
      inputSummary: { sourceName: "旧版 MAA 导入" },
      layout: {
        template: "243",
        drone_cap: 200,
        scenario: {},
        rooms: [
          { id: "control", kind: "control_center", level: 5 },
          { id: "power", kind: "power_plant", level: 3 },
        ],
      },
      operbox: [{
        id: "char_002_amiya",
        name: "阿米娅",
        own: true,
        level: 80,
        elite: 2,
        potential: 6,
        rarity: 5,
      }],
      stdout: "legacy stdout tail",
      stderr: "legacy stderr tail",
      command: "must-not-leak",
      serveRequest: {
        id: 1,
        method: "plan.compute",
        params: { options: { rotation: "abc_12_6_6", fiammetta_enable: false } },
      },
    })),
    writeFile(path.join(invalidRun, "result.json"), JSON.stringify({
      runId: "66666666-6666-4666-8666-666666666666",
      success: false,
    })),
    writeFile(path.join(embeddedRun, "result.json"), JSON.stringify({
      runId: embeddedDiagnosticId,
      success: false,
      debugBundle: {
        inputSummary: { sourceName: "内嵌旧版制品" },
        layout: {
          template: "243",
          drone_cap: 200,
          scenario: {},
          rooms: [
            { id: "control", kind: "control_center", level: 5 },
            { id: "power", kind: "power_plant", level: 3 },
          ],
        },
        operbox: [{
          id: "char_002_amiya",
          name: "阿米娅",
          own: true,
          level: 80,
          elite: 2,
          potential: 6,
          rarity: 5,
        }],
        serveRequest: {
          id: 2,
          method: "plan.compute",
          params: { options: { rotation: "abc_12_12_12", fiammetta_enable: true } },
        },
        stdout: "embedded stdout",
        stderr: "embedded stderr",
      },
    })),
    writeFile(path.join(accountRun, "owner.json"), JSON.stringify({ diagnosticId: accountDiagnosticId })),
    writeFile(path.join(linkedFeedback, "meta.json"), JSON.stringify({ diagnosticId })),
    writeFile(path.join(ownedFeedback, "meta.json"), JSON.stringify({ dataOwnerTag: targetOwnerTag })),
    writeFile(path.join(unrelatedFeedback, "meta.json"), JSON.stringify({ dataOwnerTag: unrelatedOwnerTag })),
    writeFile(path.join(deletableFeedback, "meta.json"), JSON.stringify({ feedbackId: "feedback-delete" })),
    writeFile(path.join(corruptFeedback, "meta.json"), "{invalid-json"),
  ]);
  const previousStorageDir = process.env.BETA_STORAGE_DIR;
  const previousRunsDir = process.env.BETA_CLI_RUN_DIR;
  const previousFeedbackDir = process.env.BETA_FEEDBACK_DIR;
  const previousExpectedCliSha256 = process.env.INFRA_CLI_EXPECTED_SHA256;
  const previousBusinessDbEnabled = process.env.BETA_BUSINESS_DB_ENABLED;
  process.env.BETA_STORAGE_DIR = storageRoot;
  process.env.BETA_CLI_RUN_DIR = runsRoot;
  process.env.BETA_FEEDBACK_DIR = feedbackRoot;
  process.env.INFRA_CLI_EXPECTED_SHA256 = "0".repeat(64);
  process.env.BETA_BUSINESS_DB_ENABLED = "0";
  const legacyPurgeMarker = path.join(storageRoot, ".skland-legacy-purge-v1.json");
  await writeFile(legacyPurgeMarker, JSON.stringify({ version: 1 }), "utf-8");
  context.after(() => {
    if (previousStorageDir === undefined) delete process.env.BETA_STORAGE_DIR;
    else process.env.BETA_STORAGE_DIR = previousStorageDir;
    if (previousRunsDir === undefined) delete process.env.BETA_CLI_RUN_DIR;
    else process.env.BETA_CLI_RUN_DIR = previousRunsDir;
    if (previousFeedbackDir === undefined) delete process.env.BETA_FEEDBACK_DIR;
    else process.env.BETA_FEEDBACK_DIR = previousFeedbackDir;
    if (previousExpectedCliSha256 === undefined) delete process.env.INFRA_CLI_EXPECTED_SHA256;
    else process.env.INFRA_CLI_EXPECTED_SHA256 = previousExpectedCliSha256;
    if (previousBusinessDbEnabled === undefined) delete process.env.BETA_BUSINESS_DB_ENABLED;
    else process.env.BETA_BUSINESS_DB_ENABLED = previousBusinessDbEnabled;
  });

  const { deleteFeedbackArtifacts, deletePlanRunArtifacts, deleteSklandOwnedData, maintainPrivateRecords, readFeedbackReproduction, readPlanReproduction, runPlan, saveFeedback, savePlanFailureArtifact, stopInfraServeClients } = await import("./infra.ts");
  const { assertPlanArtifactStorageReady } = await import("./infra.ts");
  await assertPlanArtifactStorageReady();
  assert.equal((await readdir(runsRoot)).some((name) => name.startsWith(".worker-storage-probe-")), false);
  delete process.env.BETA_STORAGE_DIR;
  await assert.rejects(assertPlanArtifactStorageReady, /absolute BETA_STORAGE_DIR/);
  process.env.BETA_STORAGE_DIR = "relative-storage";
  await assert.rejects(assertPlanArtifactStorageReady, /absolute BETA_STORAGE_DIR/);
  process.env.BETA_STORAGE_DIR = storageRoot;
  // runPlan can start an installed local solver even when the fingerprint is
  // deliberately invalid. Release the test-owned process after assertions.
  context.after(() => stopInfraServeClients("private record test finished"));

  const planInput = {
    layout: {
      template: "243",
      drone_cap: 200,
      scenario: {},
      rooms: [
        { id: "control", kind: "control_center", level: 5 },
        { id: "power", kind: "power_plant", level: 3 },
      ],
    },
    operbox: [{
      id: "char_002_amiya",
      name: "阿米娅",
      own: true,
      level: 80,
      elite: 2,
      potential: 6,
      rarity: 5,
    }],
    sourceName: "失败链路测试",
    rotation: "abc_12_6_6",
    fiammettaEnable: true,
  };
  for (const deferArtifacts of [false, true]) {
    const failed = await runPlan(planInput, { deferArtifacts });
    assert.equal(failed.success, false);
    assert.ok(failed.runId);
    const recorded = await readPlanReproduction(failed.runId!);
    assert.equal(recorded.available, true);
    assert.equal(recorded.layout?.template, "243");
    assert.equal(recorded.operbox?.[0]?.name, "阿米娅");
    assert.equal(recorded.rotationCount, 3);
    assert.equal(recorded.fiammettaEnabled, true);
    assert.equal("command" in recorded, false);

    const runName = (await readdir(runsRoot)).find((name) => name.includes(failed.runId!));
    assert.ok(runName);
    const files = await readdir(path.join(runsRoot, runName!));
    assert.ok(files.includes("layout.json"));
    assert.ok(files.includes("operbox.json"));
    assert.ok(files.includes("reproduction.json"));
    assert.ok(files.includes(deferArtifacts ? "run-envelope.json" : "result.json"));
    const storedOperbox = JSON.parse(await readFile(path.join(runsRoot, runName!, "operbox.json"), "utf8"));
    assert.equal(storedOperbox[0].name, "阿米娅");
    if (deferArtifacts) {
      const fullTaskOperbox = [
        ...planInput.operbox,
        {
          id: "char_unowned_deferred_fixture",
          name: "Unowned deferred fixture operator",
          own: false,
          level: 1,
          elite: 0,
          potential: 1,
          rarity: 4,
        },
      ];
      await savePlanFailureArtifact({
        ...planInput,
        diagnosticId: failed.runId!,
        layout: planInput.layout as BaseBlueprint,
        operbox: fullTaskOperbox,
        rotation: "abc_12_6_6",
        errorCode: "AIC-PLAN-3004",
      });
      const taskSnapshot = await readPlanReproduction(failed.runId!);
      assert.equal(taskSnapshot.operbox?.length, fullTaskOperbox.length);
      assert.equal(taskSnapshot.operbox?.[1]?.own, false);
    }
  }
  const workerFailureDiagnosticId = "12121212-1212-4212-8212-121212121212";
  const workerFailureOperbox = [
    ...planInput.operbox,
    {
      id: "char_unowned_fixture",
      name: "Unowned fixture operator",
      own: false,
      level: 1,
      elite: 0,
      potential: 1,
      rarity: 4,
    },
  ];
  const workerFailureArtifact = await savePlanFailureArtifact({
    diagnosticId: workerFailureDiagnosticId,
    layout: planInput.layout as BaseBlueprint,
    operbox: workerFailureOperbox,
    sourceName: "worker failure fixture",
    rotation: "main_backup_12_12",
    fiammettaEnable: false,
    dataOwnerTag: targetOwnerTag,
    errorCode: "AIC-SYS-5000",
    diagnosticReason: "solver unavailable token=private-fixture-secret",
  });
  assert.equal(workerFailureArtifact?.key, workerFailureDiagnosticId);
  const workerFailureReproduction = await readPlanReproduction(workerFailureDiagnosticId);
  assert.equal(workerFailureReproduction.available, true);
  assert.equal(workerFailureReproduction.operbox?.length, workerFailureOperbox.length);
  assert.equal(workerFailureReproduction.operbox?.[1]?.own, false);
  assert.equal(workerFailureReproduction.rotationCount, 2);
  assert.equal(workerFailureReproduction.fiammettaEnabled, false);
  assert.equal(workerFailureReproduction.error, "solver unavailable token=[已隐藏敏感值]");

  const incompleteFailureDiagnosticId = "13131313-1313-4313-8313-131313131313";
  const incompleteFailureDir = path.join(
    runsRoot,
    `2026-09-03T00-00-00-000Z_incomplete_${incompleteFailureDiagnosticId}`,
  );
  await mkdir(incompleteFailureDir);
  await writeFile(path.join(incompleteFailureDir, "pre-error-marker.txt"), "preserve me", "utf8");
  const repairedFailureArtifact = await savePlanFailureArtifact({
    diagnosticId: incompleteFailureDiagnosticId,
    layout: planInput.layout as BaseBlueprint,
    operbox: workerFailureOperbox,
    sourceName: "incomplete worker failure fixture",
    rotation: "main_backup_12_12",
    fiammettaEnable: false,
    dataOwnerTag: targetOwnerTag,
    errorCode: "AIC-BOX-1101",
  });
  assert.equal(repairedFailureArtifact?.key, incompleteFailureDiagnosticId);
  assert.equal(await readFile(path.join(incompleteFailureDir, "pre-error-marker.txt"), "utf8"), "preserve me");
  const repairedFailureReproduction = await readPlanReproduction(incompleteFailureDiagnosticId);
  assert.equal(repairedFailureReproduction.available, true);
  assert.equal(repairedFailureReproduction.operbox?.length, workerFailureOperbox.length);
  assert.equal(repairedFailureReproduction.rotationCount, 2);
  assert.equal(repairedFailureReproduction.fiammettaEnabled, false);
  assert.equal(repairedFailureReproduction.error, "AIC-BOX-1101");

  const reproduction = await readPlanReproduction(reproductionDiagnosticId);
  assert.equal(reproduction.available, true);
  assert.equal(reproduction.rotation, "abc_12_6_6");
  assert.equal(reproduction.rotationCount, 3);
  assert.equal(reproduction.fiammettaEnabled, false);
  assert.equal(reproduction.error, "solver exited");
  assert.equal(reproduction.stderrExcerpt, "debug tail");

  const feedbackDiagnosticId = "abababab-abab-4bab-8bab-abababababab";
  const savedFeedback = await saveFeedback({
    kind: "performance_issue",
    diagnosticId: feedbackDiagnosticId,
    note: "独立反馈快照测试",
    consent: true,
    reproduction: {
      layout: planInput.layout as BaseBlueprint,
      operbox: planInput.operbox,
      rotation: "main_backup_12_12",
      fiammettaEnabled: false,
      sourceType: "maa",
    },
  }, {
    userId: "user-feedback-test",
    dataOwnerTag: targetOwnerTag,
  });
  assert.deepEqual(Object.keys(savedFeedback).sort(), ["feedbackId", "savedAt"]);
  const feedbackDirectory = (await readdir(feedbackRoot))
    .find((name) => name.endsWith(`_${savedFeedback.feedbackId}`));
  assert.ok(feedbackDirectory);
  const feedbackFiles = await readdir(path.join(feedbackRoot, feedbackDirectory!));
  assert.deepEqual(feedbackFiles.sort(), ["issue.json", "layout.json", "meta.json", "operbox.json", "reproduction.json"]);
  const feedbackMeta = JSON.parse(await readFile(path.join(feedbackRoot, feedbackDirectory!, "meta.json"), "utf8"));
  assert.equal(feedbackMeta.dataOwnerTag, targetOwnerTag);
  const feedbackContext = JSON.parse(await readFile(path.join(feedbackRoot, feedbackDirectory!, "reproduction.json"), "utf8"));
  assert.equal(feedbackContext.rotationCount, 2);
  const feedbackReproduction = await readFeedbackReproduction(
    savedFeedback.feedbackId,
    feedbackDiagnosticId,
  );
  assert.equal(feedbackReproduction.available, true);
  assert.equal(feedbackReproduction.layout?.template, "243");
  assert.equal(feedbackReproduction.operbox?.[0]?.name, "阿米娅");
  assert.equal(feedbackReproduction.rotation, "main_backup_12_12");
  assert.equal(feedbackReproduction.rotationCount, 2);
  assert.equal(feedbackReproduction.fiammettaEnabled, false);

  const legacyReproduction = await readPlanReproduction(legacyDiagnosticId, {
    rotation: "abc_12_6_6",
    fiammettaEnabled: true,
    artifactKey: "legacy",
    executionSource: null,
  });
  assert.equal(legacyReproduction.available, true);
  assert.equal(legacyReproduction.unavailableReason, null);
  assert.equal(legacyReproduction.sourceName, "旧版 MAA 导入");
  assert.equal(legacyReproduction.layout?.template, "243");
  assert.equal(legacyReproduction.operbox?.[0]?.name, "阿米娅");
  assert.equal(legacyReproduction.fiammettaEnabled, false);
  assert.equal(legacyReproduction.stderrExcerpt, "legacy stderr tail");
  assert.equal(legacyReproduction.stdoutExcerpt, "legacy stdout tail");
  assert.equal("command" in legacyReproduction, false);

  const embeddedReproduction = await readPlanReproduction(embeddedDiagnosticId, {
    rotation: "abc_12_6_6",
    fiammettaEnabled: false,
    artifactKey: "embedded",
    executionSource: null,
  });
  assert.equal(embeddedReproduction.available, true);
  assert.equal(embeddedReproduction.sourceName, "内嵌旧版制品");
  assert.equal(embeddedReproduction.rotation, "abc_12_12_12");
  assert.equal(embeddedReproduction.fiammettaEnabled, true);
  assert.equal(embeddedReproduction.stderrExcerpt, "embedded stderr");

  const cacheWithoutArtifact = await readPlanReproduction("77777777-7777-4777-8777-777777777777", {
    rotation: "abc_12_6_6",
    fiammettaEnabled: false,
    executionSource: "cache",
  });
  assert.equal(cacheWithoutArtifact.available, false);
  assert.equal(cacheWithoutArtifact.unavailableReason, "cache_hit");

  const unavailableCases = [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      fallback: { artifactKey: null },
      reason: "not_recorded",
    },
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      fallback: { artifactKey: "missing" },
      reason: "missing",
    },
    {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      fallback: { artifactKey: "expired", expiresAt: new Date(Date.now() - 1_000) },
      reason: "expired",
    },
    {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      fallback: { artifactKey: null, artifactStatus: "pending" },
      reason: "finalizing",
    },
    {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      fallback: { artifactKey: null, artifactStatus: "failed" },
      reason: "finalization_failed",
    },
  ] as const;
  for (const item of unavailableCases) {
    const unavailable = await readPlanReproduction(item.id, item.fallback);
    assert.equal(unavailable.available, false);
    assert.equal(unavailable.unavailableReason, item.reason);
  }

  const invalidReproduction = await readPlanReproduction(invalidDiagnosticId, {
    rotation: "abc_12_6_6",
    fiammettaEnabled: false,
    artifactKey: "invalid",
  });
  assert.equal(invalidReproduction.available, false);
  assert.equal(invalidReproduction.unavailableReason, "invalid");

  assert.equal(await deleteFeedbackArtifacts(["feedback-delete"]), 1);
  await assert.rejects(stat(deletableFeedback), { code: "ENOENT" });
  await assert.doesNotReject(stat(unrelatedFeedback));
  assert.equal(await deleteFeedbackArtifacts([corruptFeedbackId]), 1);
  await assert.rejects(stat(corruptFeedback), { code: "ENOENT" });
  assert.equal(await deletePlanRunArtifacts([accountDiagnosticId]), 1);
  await assert.rejects(stat(accountRun), { code: "ENOENT" });
  assert.equal(await deletePlanRunArtifacts(["ffffffff-ffff-4fff-8fff-ffffffffffff"]), 0);

  const retainedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  await utimes(unrelatedRun, retainedAt, retainedAt);
  await maintainPrivateRecords();
  await rm(legacyPurgeMarker, { force: true });
  assert.deepEqual(await deleteSklandOwnedData([targetOwnerTag]), { runs: 2, feedback: 3 });
  await assert.rejects(stat(targetRun), { code: "ENOENT" });
  await assert.rejects(stat(linkedFeedback), { code: "ENOENT" });
  await assert.rejects(stat(ownedFeedback), { code: "ENOENT" });
  await assert.rejects(stat(path.join(feedbackRoot, feedbackDirectory!)), { code: "ENOENT" });
  await assert.doesNotReject(stat(unrelatedRun));
  await assert.doesNotReject(stat(unrelatedFeedback));
  await assert.rejects(stat(legacyPurgeMarker), { code: "ENOENT" });

  const expiredDiagnosticId = "88888888-8888-4888-8888-888888888888";
  const expiredRun = path.join(runsRoot, `2026-08-01_MAA_${expiredDiagnosticId}`);
  await mkdir(expiredRun);
  await writeFile(path.join(expiredRun, "result.json"), JSON.stringify({ runId: expiredDiagnosticId }));
  const expiredAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  await utimes(expiredRun, expiredAt, expiredAt);
  await maintainPrivateRecords();
  await assert.doesNotReject(stat(unrelatedRun));
  await assert.rejects(stat(expiredRun), { code: "ENOENT" });
});
