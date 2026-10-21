import assert from "node:assert/strict";
import console from "node:console";
import { register } from "node:module";
import test from "node:test";
import { setTimeout as schedule } from "node:timers";

register("./ts-path-loader.mjs", import.meta.url);

const {
  createPlanWorkerWakeSignal,
  executePlanTask,
  runPlanWorkerDispatcher,
  waitForPlanExecutionUpdates,
} = await import("./plan-worker-runtime.mts");
const { toPublicPlanData } = await import("@riic/platform-server/public-plan");

function claimedTask(id = "11111111-1111-4111-8111-111111111111") {
  const now = new Date("2026-09-02T00:00:00.000Z");
  return {
    id,
    userId: "user-1",
    status: "running",
    result: null,
    error: null,
    attempts: 1,
    createdAt: now,
    startedAt: now,
    solverStartedAt: null,
    solverFinishedAt: null,
    executionSource: null,
    finishedAt: null,
    expiresAt: new Date("2026-09-03T00:00:00.000Z"),
    payload: {
      layout: { template: "243", rooms: [] },
      operbox: [],
      sourceName: "fixture",
      sourceType: "maa",
      rotation: "abc_12_6_6",
      fiammettaEnable: false,
      layoutTemplate: "243",
      roomCount: 1,
      operatorCount: 1,
      dataOwnerTag: null,
      calculationContext: {},
      operboxContentHmac: null,
      operboxHmacKeyVersion: null,
      cacheReferenceUserId: "user-1",
    },
  };
}

function executionHarness(overrides = {}) {
  const calls = [];
  const result = { diagnosticId: "public-result", durationMs: 25 };
  const dependencies = {
    getCacheSolverIdentity: async () => null,
    resolveCache: async () => ({ kind: "bypass" }),
    markExecutionStarted: async (_id, source) => { calls.push(`start:${source}`); },
    normalizePersisted: (value) => value,
    resolveCalculationContext: () => ({}),
    publicResultSha256: () => "a".repeat(64),
    recordRun: async (input) => { calls.push(`record:${input.status}`); return true; },
    recordCacheReference: async () => { calls.push("cache-reference"); return true; },
    evictCacheKeys: async () => { calls.push("cache-evict"); },
    completeTask: async (_id, input) => { calls.push(`task:${input.status}`); return true; },
    runPlan: async () => ({
      success: true,
      runId: "22222222-2222-4222-8222-222222222222",
      durationMs: 30,
      solverDurationMs: 25,
      solverStartedAt: "2026-09-02T00:00:00.000Z",
      solverFinishedAt: "2026-09-02T00:00:00.025Z",
      artifactEnvelopePath: "private/run-envelope.json",
    }),
    markSolverFinished: async () => { calls.push("solver-finished"); return true; },
    toPublicPlanData: () => result,
    describeArtifact: async () => ({ key: "artifact", bytes: 1, sha256: "b".repeat(64) }),
    saveFailureArtifact: async () => { calls.push("failure-artifact"); return null; },
    releaseCacheLease: async () => { calls.push("lease-release"); },
    completeCache: async () => { calls.push("cache-complete"); },
    updateRunExecution: async () => { calls.push("timing"); return true; },
    enqueueArtifact: () => { calls.push("artifact-enqueue"); return true; },
    ...overrides,
  };
  return { calls, dependencies, result };
}

test("the worker wake signal latches notifications that arrive before wait", async () => {
  const wake = createPlanWorkerWakeSignal();
  wake.notify();

  let completed = false;
  await wake.wait(10_000).then(() => { completed = true; });

  assert.equal(completed, true);
});

for (const sourceType of ["maa", "skland"]) test(`${sourceType}: a cache hit records current ownership without running the solver`, async () => {
  const task = claimedTask();
  task.payload.sourceType = sourceType;
  task.payload.dataOwnerTag = sourceType === "skland" ? "current-skland-owner" : null;
  const cacheResult = { diagnosticId: "cache-result", durationMs: 3 };
  const { calls, dependencies } = executionHarness({
    getCacheSolverIdentity: async () => ({
      protocol_version: 1,
      plan_schema_version: 3,
      solver_executable_sha256: "c".repeat(64),
      observed_at: "2026-09-02T00:00:00.000Z",
    }),
    resolveCache: async (input) => {
      assert.equal(input.sourceType, sourceType);
      return { kind: "hit", keyHmac: "cache-key", result: cacheResult, lookupDurationMs: 1 };
    },
    recordRun: async (input) => {
      assert.equal(input.userId, task.userId);
      assert.equal(input.dataOwnerTag, task.payload.dataOwnerTag);
      assert.equal(input.diagnosticId, cacheResult.diagnosticId);
      calls.push(`record:${input.status}`);
      return true;
    },
    runPlan: async () => assert.fail("A cache hit must not invoke the solver"),
  });

  assert.equal(await executePlanTask(task, 0, dependencies), null);
  assert.equal(await waitForPlanExecutionUpdates(1_000), true);
  assert.deepEqual(calls, [
    "start:cache",
    "record:success",
    "cache-reference",
    "task:done",
    "timing",
  ]);
});

test("a solver lease is cached and the artifact is queued only after task publication", async () => {
  const lease = { kind: "lease", keyHmac: "cache-key", leaseOwner: "lease-owner" };
  const { calls, dependencies } = executionHarness({
    getCacheSolverIdentity: async () => ({
      protocol_version: 1,
      plan_schema_version: 3,
      solver_executable_sha256: "c".repeat(64),
      observed_at: "2026-09-02T00:00:00.000Z",
    }),
    resolveCache: async () => lease,
  });

  assert.equal(await executePlanTask(claimedTask(), 2, dependencies), 25);
  assert.equal(await waitForPlanExecutionUpdates(1_000), true);
  assert.deepEqual(calls, [
    "start:solver",
    "solver-finished",
    "record:success",
    "cache-reference",
    "cache-complete",
    "task:done",
    "artifact-enqueue",
    "timing",
  ]);
});

test("a recovered fallback releases the primary cache lease without publishing into it", async () => {
  const lease = { kind: "lease", keyHmac: "cache-key", leaseOwner: "lease-owner" };
  const { calls, dependencies } = executionHarness({
    getCacheSolverIdentity: async () => ({protocol_version:1,plan_schema_version:3,
      solver_executable_sha256:"c".repeat(64),observed_at:"2026-09-02T00:00:00.000Z"}),
    resolveCache: async () => lease,
  });
  const primaryRun=dependencies.runPlan;
  dependencies.runPlan=async (...args)=>({...await primaryRun(...args),fallbackUsed:true});
  assert.equal(await executePlanTask(claimedTask(),2,dependencies),25);
  await waitForPlanExecutionUpdates(1_000);
  assert.ok(calls.includes("record:success"));assert.ok(calls.includes("task:done"));
  assert.ok(calls.includes("lease-release"));assert.ok(!calls.includes("cache-complete"));
  assert.ok(!calls.includes("cache-reference"));
});

test("a failed solver releases its cache lease before recording the terminal task", async () => {
  const lease = { kind: "lease", keyHmac: "cache-key", leaseOwner: "lease-owner" };
  const task = claimedTask();
  task.payload.operbox = [
    { id: "owned", name: "Owned", own: true, level: 80, elite: 2, potential: 6, rarity: 6 },
    { id: "unowned", name: "Unowned", own: false, level: 1, elite: 0, potential: 1, rarity: 5 },
  ];
  const expectedFailureOperbox = task.payload.operbox.map((operator) => ({ ...operator }));
  const recorded = [];
  const failureArtifacts = [];
  const { calls, dependencies } = executionHarness({
    getCacheSolverIdentity: async () => ({
      protocol_version: 1,
      plan_schema_version: 3,
      solver_executable_sha256: "c".repeat(64),
      observed_at: "2026-09-02T00:00:00.000Z",
    }),
    resolveCache: async () => lease,
    runPlan: async (input) => {
      input.operbox.splice(0, input.operbox.length, input.operbox[0]);
      throw new Error("solver unavailable");
    },
    saveFailureArtifact: async (input) => {
      calls.push("failure-artifact");
      failureArtifacts.push(input);
      return { key: input.diagnosticId, bytes: 1, sha256: "d".repeat(64) };
    },
    recordRun: async (input) => { recorded.push(input); calls.push(`record:${input.status}`); return true; },
  });

  assert.equal(await executePlanTask(task, 1, dependencies), null);
  assert.equal(await waitForPlanExecutionUpdates(1_000), true);
  assert.deepEqual(failureArtifacts, [{
    diagnosticId: task.id,
    layout: task.payload.layout,
    operbox: expectedFailureOperbox,
    sourceName: task.payload.sourceName,
    rotation: task.payload.rotation,
    fiammettaEnable: task.payload.fiammettaEnable,
    dataOwnerTag: task.payload.dataOwnerTag,
    errorCode: "AIC-SYS-5000",
    diagnosticReason: "solver unavailable",
  }]);
  assert.deepEqual(task.payload.operbox, expectedFailureOperbox);
  assert.equal(recorded[0].artifact.key, task.id);
  assert.equal(recorded[0].artifactStatus, "complete");
  assert.deepEqual(calls, [
    "start:solver",
    "lease-release",
    "failure-artifact",
    "record:failed",
    "task:failed",
    "timing",
  ]);
});

test("an unsuccessful solver response preserves its public error and queues the failure artifact", async () => {
  const recorded = [];
  const unsuccessfulResult = {
    success: false,
    runId: "33333333-3333-4333-8333-333333333333",
    durationMs: 30,
    solverDurationMs: 25,
    artifactEnvelopePath: "private/failed-run-envelope.json",
    error: "assignment room trade_1 exceeds capacity 2",
    solver: { solver_executable_sha256: "c".repeat(64) },
    profileJson: {
      schema_version: 4,
      rotation_profile: "abc_12_6_6",
      layout_label: "243",
      operbox_label: "fixture",
      baseline_label: "baseline",
      summary: { owned: 0, tier_up_owned: 0, trade_pool_ready: 0 },
      domains: [],
      rotation: {},
      baseline_rotation: {},
      actions: [],
      flags: [],
      narration_hints: [],
    },
    maaJson: { title: "fixture", plans: [] },
    rotationJson: { profile: "abc_12_6_6", shifts: [], daily: {} },
  };
  assert.doesNotThrow(() => toPublicPlanData(
    { ...unsuccessfulResult, success: true },
    { layoutLabel: "243", sourceName: "fixture" },
    "task-id",
  ));
  const { calls, dependencies } = executionHarness({
    runPlan: async () => unsuccessfulResult,
    toPublicPlanData,
    recordRun: async (input) => { recorded.push(input); calls.push(`record:${input.status}`); return true; },
  });

  assert.equal(await executePlanTask(claimedTask(), 1, dependencies), 25);
  assert.equal(await waitForPlanExecutionUpdates(1_000), true);
  assert.equal(recorded[0].status, "failed");
  assert.equal(recorded[0].errorCode, "AIC-PLAN-3004");
  assert.equal(recorded[0].artifactStatus, "pending");
  assert.equal(recorded[0].durationMs, 30);
  assert.deepEqual(recorded[0].solver, unsuccessfulResult.solver);
  assert.deepEqual(calls, [
    "start:solver",
    "solver-finished",
    "failure-artifact",
    "record:failed",
    "task:failed",
    "artifact-enqueue",
    "timing",
  ]);
});

test("failed artifact writes still publish terminal tasks and log redacted diagnostic reasons", async (context) => {
  const logs = [];
  context.mock.method(console, "error", (value) => logs.push(JSON.parse(value)));
  const { calls, dependencies } = executionHarness({
    runPlan: async () => { throw new Error("solver failed token=private-test-value", { cause: new Error("upstream password=private-test-password") }); },
    saveFailureArtifact: async () => { throw new Error("EACCES: mkdir /private/server/storage"); },
  });
  await executePlanTask(claimedTask(), 0, dependencies);
  await waitForPlanExecutionUpdates(1000);
  assert.ok(calls.includes("task:failed"));
  assert.equal(logs[0].event, "plan_failure_artifact_write_failed");
  assert.equal(logs[1].event, "plan_task_failed");
  assert.equal(logs[1].code, "AIC-SYS-5000");
  assert.equal(logs[1].status, 500);
  assert.match(logs[1].message, /solver failed/);
  assert.match(logs[1].cause, /upstream/);
  assert.doesNotMatch(JSON.stringify(logs), /private-test-value|private-test-password|\/private\/server/);
});

test("a missing run record releases the solver lease instead of caching an unowned result", async () => {
  const lease = { kind: "lease", keyHmac: "cache-key", leaseOwner: "lease-owner" };
  const { calls, dependencies } = executionHarness({
    getCacheSolverIdentity: async () => ({
      protocol_version: 1,
      plan_schema_version: 3,
      solver_executable_sha256: "c".repeat(64),
      observed_at: "2026-09-02T00:00:00.000Z",
    }),
    resolveCache: async () => lease,
    recordRun: async (input) => { calls.push(`record:${input.status}`); return false; },
  });

  assert.equal(await executePlanTask(claimedTask(), 3, dependencies), 25);
  assert.equal(await waitForPlanExecutionUpdates(1_000), true);
  assert.deepEqual(calls, [
    "start:solver",
    "solver-finished",
    "record:success",
    "lease-release",
    "task:done",
    "artifact-enqueue",
    "timing",
  ]);
});

test("slow best-effort timing updates do not retain a dispatcher execution slot", async () => {
  let releaseTiming;
  const { calls, dependencies } = executionHarness({
    updateRunExecution: () => new Promise((resolve) => { releaseTiming = resolve; }),
  });

  assert.equal(await executePlanTask(claimedTask(), 0, dependencies), 25);
  assert.ok(calls.includes("artifact-enqueue"));
  assert.equal(await waitForPlanExecutionUpdates(0), false);
  releaseTiming();
  assert.equal(await waitForPlanExecutionUpdates(1_000), true);
});

test("the dispatcher fills two bounded slots on each of four least-loaded lanes", async () => {
  const wake = createPlanWorkerWakeSignal();
  const assignments = [];
  const releases = [];
  let claimCount = 0;
  let shuttingDown = false;
  let active = 0;
  let maximumActive = 0;
  const activeByLane = [0, 0, 0, 0];
  const maximumByLane = [0, 0, 0, 0];
  const state = { inFlight: 0, serviceTimeEwmaMs: null };

  await runPlanWorkerDispatcher({
    isShuttingDown: () => shuttingDown,
    state,
    wake,
  }, {
    idlePollMs: 1,
    claim: async () => {
      if (claimCount >= 8) return null;
      claimCount += 1;
      if (claimCount === 8) {
        shuttingDown = true;
        schedule(() => releases.splice(0).forEach((release) => release()), 0);
      }
      return { id: `task-${claimCount}`, attempts: 1 };
    },
    execute: async (_task, serveLane) => {
      assignments.push(serveLane);
      active += 1;
      activeByLane[serveLane] += 1;
      maximumActive = Math.max(maximumActive, active);
      maximumByLane[serveLane] = Math.max(maximumByLane[serveLane], activeByLane[serveLane]);
      await new Promise((resolve) => releases.push(resolve));
      active -= 1;
      activeByLane[serveLane] -= 1;
      return 1_000;
    },
  });

  assert.deepEqual(assignments, [0, 1, 2, 3, 0, 1, 2, 3]);
  assert.equal(maximumActive, 8);
  assert.deepEqual(maximumByLane, [2, 2, 2, 2]);
  assert.equal(state.inFlight, 0);
  assert.equal(state.serviceTimeEwmaMs, 1_000);
});

test("the dispatcher drains cleanly after a claim failure", async () => {
  const wake = createPlanWorkerWakeSignal();
  let shuttingDown = false;
  let executeCount = 0;
  wake.notify();

  await runPlanWorkerDispatcher({
    isShuttingDown: () => shuttingDown,
    state: { inFlight: 0, serviceTimeEwmaMs: null },
    wake,
  }, {
    idlePollMs: 10_000,
    claim: async () => {
      shuttingDown = true;
      throw new Error("database unavailable");
    },
    execute: async () => {
      executeCount += 1;
      return 1;
    },
  });

  assert.equal(executeCount, 0);
});

test("the dispatcher retries a transient claim failure after its safety poll", async () => {
  const wake = createPlanWorkerWakeSignal();
  let claimCount = 0;
  let executeCount = 0;
  let shuttingDown = false;

  await runPlanWorkerDispatcher({
    isShuttingDown: () => shuttingDown,
    state: { inFlight: 0, serviceTimeEwmaMs: null },
    wake,
  }, {
    idlePollMs: 0,
    claim: async () => {
      claimCount += 1;
      if (claimCount === 1) throw new Error("temporary database error");
      shuttingDown = true;
      return { id: "recovered-task", attempts: 1 };
    },
    execute: async () => {
      executeCount += 1;
      return 1_000;
    },
  });

  assert.equal(claimCount, 2);
  assert.equal(executeCount, 1);
});

test("the dispatcher refills a ninth task as soon as one pipeline slot completes", async () => {
  const wake = createPlanWorkerWakeSignal();
  const releases = new Map();
  const assignments = [];
  let claimCount = 0;
  let shuttingDown = false;

  await runPlanWorkerDispatcher({
    isShuttingDown: () => shuttingDown,
    state: { inFlight: 0, serviceTimeEwmaMs: null },
    wake,
  }, {
    idlePollMs: 10_000,
    claim: async () => {
      if (claimCount >= 9) return null;
      claimCount += 1;
      if (claimCount === 8) schedule(() => releases.get("task-1")?.(), 0);
      if (claimCount === 9) {
        shuttingDown = true;
        schedule(() => releases.forEach((release) => release()), 0);
      }
      return { id: `task-${claimCount}`, attempts: 1 };
    },
    execute: async (task, serveLane) => {
      assignments.push([task.id, serveLane]);
      await new Promise((resolve) => releases.set(task.id, resolve));
      return 1_000;
    },
  });

  assert.equal(claimCount, 9);
  assert.equal(assignments.length, 9);
  assert.deepEqual(assignments[8], ["task-9", 0]);
});

test("the dispatcher excludes cache hits and missing solver timings from the service EWMA", async () => {
  const wake = createPlanWorkerWakeSignal();
  const samples = [1_000, null, 2_000, null];
  let claimCount = 0;
  let shuttingDown = false;
  const state = { inFlight: 0, serviceTimeEwmaMs: null };

  await runPlanWorkerDispatcher({
    isShuttingDown: () => shuttingDown,
    state,
    wake,
  }, {
    idlePollMs: 1,
    claim: async () => {
      if (claimCount >= samples.length) return null;
      const index = claimCount;
      claimCount += 1;
      if (claimCount === samples.length) shuttingDown = true;
      return { id: `sample-${index}`, attempts: 1, sample: samples[index] };
    },
    execute: async (task) => task.sample,
  });

  assert.equal(state.serviceTimeEwmaMs, 1_200);
});
