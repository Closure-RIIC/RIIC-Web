import { normalizePersistedPlanData } from "@riic/arknights-domain/persistence";
import { PublicApiError } from "@riic/platform-server/api-contract";
import { diagnosticText } from "@riic/platform-server/diagnostic-text";
import { makeDiagnostic, persistDiagnostic } from "@riic/platform-server/request-diagnostics";
import {
  recordPlanRunBestEffort,
  updatePlanRunExecutionBestEffort,
} from "@riic/platform-server/business-records";
import { getDatabase } from "@riic/platform-server/db";
import {
  assertPlanArtifactStorageReady,
  describePlanArtifact,
  enqueuePlanArtifactFinalization,
  getPlanCacheSolverIdentity,
  resumePendingPlanArtifactFinalizations,
  runPlan,
  savePlanFailureArtifact,
  stopInfraServeClients,
  waitForPlanArtifactFinalizers,
  warmPlanServeLane,
} from "@riic/platform-server/infra";
import {
  completePlanCache,
  evictPlanCacheKeys,
  recordPlanCacheReferenceBestEffort,
  releasePlanCacheLease,
  resolvePlanCache,
  type PlanCacheResolution,
} from "@riic/platform-server/plan-cache";
import { publicPlanSha256, resolveSavedPlanCalculationContext } from "@riic/platform-server/plan-result-binding";
import {
  claimNextPlanTask,
  cleanupExpiredPlanTasks,
  completePlanTask,
  listenForPlanTaskAvailability,
  markPlanTaskExecutionStarted,
  markPlanTaskSolverFinished,
  recordPlanWorkerHeartbeat,
  recoverStaleRunningTasks,
  PLAN_TASK_WORKER_CONCURRENCY,
  type ClaimedPlanTask,
} from "../apps/arknights/src/server/plan-task.ts";
import { toPublicPlanData } from "@riic/platform-server/public-plan";

const HEARTBEAT_INTERVAL_MS = 5_000;
const CLEANUP_INTERVAL_MS = 60_000;
// Keep one task computing while the sibling task for the same persistent solver lane
// performs cache/database/artifact work. The serve client still serializes plan.compute.
const PLAN_TASK_PIPELINE_DEPTH = 2;
const PLAN_EXECUTION_UPDATE_LIMIT = PLAN_TASK_WORKER_CONCURRENCY * PLAN_TASK_PIPELINE_DEPTH;
const pendingPlanExecutionUpdates = new Set<Promise<void>>();

function errorCodeOf(error: unknown) {
  return error instanceof PublicApiError ? error.code : "AIC-SYS-5000";
}

type PlanTaskExecutionDependencies = {
  getCacheSolverIdentity: typeof getPlanCacheSolverIdentity;
  resolveCache: typeof resolvePlanCache;
  markExecutionStarted: typeof markPlanTaskExecutionStarted;
  normalizePersisted: typeof normalizePersistedPlanData;
  resolveCalculationContext: typeof resolveSavedPlanCalculationContext;
  publicResultSha256: typeof publicPlanSha256;
  recordRun: typeof recordPlanRunBestEffort;
  recordCacheReference: typeof recordPlanCacheReferenceBestEffort;
  evictCacheKeys: typeof evictPlanCacheKeys;
  completeTask: typeof completePlanTask;
  runPlan: typeof runPlan;
  markSolverFinished: typeof markPlanTaskSolverFinished;
  toPublicPlanData: typeof toPublicPlanData;
  describeArtifact: typeof describePlanArtifact;
  saveFailureArtifact: typeof savePlanFailureArtifact;
  releaseCacheLease: typeof releasePlanCacheLease;
  completeCache: typeof completePlanCache;
  updateRunExecution: typeof updatePlanRunExecutionBestEffort;
  enqueueArtifact: typeof enqueuePlanArtifactFinalization;
};

const productionTaskExecutionDependencies: PlanTaskExecutionDependencies = {
  getCacheSolverIdentity: getPlanCacheSolverIdentity,
  resolveCache: resolvePlanCache,
  markExecutionStarted: markPlanTaskExecutionStarted,
  normalizePersisted: normalizePersistedPlanData,
  resolveCalculationContext: resolveSavedPlanCalculationContext,
  publicResultSha256: publicPlanSha256,
  recordRun: recordPlanRunBestEffort,
  recordCacheReference: recordPlanCacheReferenceBestEffort,
  evictCacheKeys: evictPlanCacheKeys,
  completeTask: completePlanTask,
  runPlan,
  markSolverFinished: markPlanTaskSolverFinished,
  toPublicPlanData,
  describeArtifact: describePlanArtifact,
  saveFailureArtifact: savePlanFailureArtifact,
  releaseCacheLease: releasePlanCacheLease,
  completeCache: completePlanCache,
  updateRunExecution: updatePlanRunExecutionBestEffort,
  enqueueArtifact: enqueuePlanArtifactFinalization,
};

function enqueuePlanExecutionUpdate(update: () => Promise<void>, diagnosticId: string): boolean {
  if (pendingPlanExecutionUpdates.size >= PLAN_EXECUTION_UPDATE_LIMIT) {
    console.warn(JSON.stringify({
      level: "warn",
      event: "plan_run_timing_update_dropped",
      diagnosticId,
      pending: pendingPlanExecutionUpdates.size,
    }));
    return false;
  }
  const pending = Promise.resolve()
    .then(update)
    .catch((error) => console.error(JSON.stringify({
      level: "error",
      event: "plan_run_timing_update_failed",
      diagnosticId,
      message: error instanceof Error ? error.message : String(error),
    })))
    .finally(() => pendingPlanExecutionUpdates.delete(pending));
  pendingPlanExecutionUpdates.add(pending);
  return true;
}

export async function waitForPlanExecutionUpdates(timeoutMs: number): Promise<boolean> {
  if (pendingPlanExecutionUpdates.size === 0) return true;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<false>((resolve) => {
    timeout = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
  });
  const settled = Promise.allSettled([...pendingPlanExecutionUpdates]).then(() => true as const);
  const result = await Promise.race([settled, expired]);
  if (timeout) clearTimeout(timeout);
  return result;
}

export async function executePlanTask(
  task: ClaimedPlanTask,
  serveLane: number,
  dependencies: PlanTaskExecutionDependencies = productionTaskExecutionDependencies,
): Promise<number | null> {
  const { id, payload } = task;
  const workerStartedAt = performance.now();
  let diagnosticId = id;
  let taskSource: "cache" | "solver" | "failed" = "failed";
  let solverDurationMs: number | null = null;
  let artifactResult: Awaited<ReturnType<typeof runPlan>> | null = null;
  let lease: Extract<PlanCacheResolution, { kind: "lease" }> | null = null;
  try {
    const cacheSolver = await dependencies.getCacheSolverIdentity();
    if (cacheSolver) {
      const cache = await dependencies.resolveCache({
        layout: payload.layout,
        operbox: payload.operbox,
        sourceType: payload.sourceType,
        sourceName: payload.sourceName ?? "",
        rotation: payload.rotation,
        fiammettaEnable: payload.fiammettaEnable,
        solver: cacheSolver,
      });
      if (cache.kind === "hit") {
        taskSource = "cache";
        diagnosticId = cache.result.diagnosticId;
        await dependencies.markExecutionStarted(id, "cache");
        const persistedResult = dependencies.normalizePersisted(cache.result, payload.rotation);
        if (!persistedResult) throw new PublicApiError("AIC-SYS-5000");
        const savedPlanContext = payload.operboxContentHmac && payload.operboxHmacKeyVersion
          ? dependencies.resolveCalculationContext(payload.calculationContext, persistedResult)
          : null;
        const runStored = await dependencies.recordRun({
          diagnosticId: cache.result.diagnosticId,
          userId: task.userId,
          dataOwnerTag: payload.dataOwnerTag,
          sourceType: payload.sourceType,
          status: "success",
          layoutTemplate: payload.layoutTemplate,
          roomCount: payload.roomCount,
          operatorCount: payload.operatorCount,
          rotation: payload.rotation,
          fiammettaEnable: payload.fiammettaEnable,
          durationMs: cache.result.durationMs,
          executionSource: "cache",
          solver: cacheSolver,
          artifact: null,
          calculationContext: savedPlanContext,
          publicResultSha256: savedPlanContext ? dependencies.publicResultSha256(persistedResult) : null,
          operboxContentHmac: savedPlanContext ? payload.operboxContentHmac : null,
          operboxHmacKeyVersion: savedPlanContext ? payload.operboxHmacKeyVersion : null,
        });
        const referenceStored = runStored && await dependencies.recordCacheReference({
          cacheKeyHmac: cache.keyHmac,
          diagnosticId: cache.result.diagnosticId,
          userId: payload.cacheReferenceUserId,
        });
        if (!referenceStored) await dependencies.evictCacheKeys([cache.keyHmac]).catch(() => undefined);
        await dependencies.completeTask(id, { status: "done", result: cache.result });
        return null;
      }
      if (cache.kind === "lease") lease = cache;
    }

    taskSource = "solver";
    await dependencies.markExecutionStarted(id, "solver");
    artifactResult = await dependencies.runPlan({
      // runPlan normalizes its input in place. Keep the encrypted task payload intact
      // so a later failure snapshot still contains the user's complete reproduction.
      layout: structuredClone(payload.layout),
      operbox: structuredClone(payload.operbox),
      sourceName: payload.sourceName,
      rotation: payload.rotation,
      fiammettaEnable: payload.fiammettaEnable,
      dataOwnerTag: payload.dataOwnerTag,
    }, { serveLane, deferArtifacts: true });
    await dependencies.markSolverFinished(id, {
      startedAt: artifactResult.solverStartedAt,
      finishedAt: artifactResult.solverFinishedAt,
    }).catch(() => undefined);
    const result = artifactResult;
    diagnosticId = result.runId ?? id;
    solverDurationMs = result.solverDurationMs ?? null;
    const publicResult = dependencies.toPublicPlanData(
      result,
      {
        layoutLabel: payload.layoutTemplate,
        sourceName: payload.sourceName ?? "已导入的干员数据",
        layout: payload.layout,
      },
      id,
    );
    const persistedResult = dependencies.normalizePersisted(publicResult, payload.rotation);
    const savedPlanContext = persistedResult && payload.operboxContentHmac && payload.operboxHmacKeyVersion
      ? dependencies.resolveCalculationContext(payload.calculationContext, persistedResult)
      : null;
    const artifact = await dependencies.describeArtifact(result);
    const runStored = await dependencies.recordRun({
      diagnosticId: result.runId ?? id,
      userId: task.userId,
      dataOwnerTag: payload.dataOwnerTag,
      sourceType: payload.sourceType,
      status: result.success ? "success" : "failed",
      layoutTemplate: payload.layoutTemplate,
      roomCount: payload.roomCount,
      operatorCount: payload.operatorCount,
      rotation: payload.rotation,
      fiammettaEnable: payload.fiammettaEnable,
      durationMs: result.durationMs,
      executionSource: "solver",
      solverDurationMs,
      errorCode: result.success ? null : "AIC-PLAN-3004",
      solver: result.solver,
      artifact,
      artifactStatus: result.artifactEnvelopePath ? "pending" : artifact ? "complete" : "none",
      calculationContext: savedPlanContext,
      publicResultSha256: savedPlanContext && persistedResult ? dependencies.publicResultSha256(persistedResult) : null,
      operboxContentHmac: savedPlanContext ? payload.operboxContentHmac : null,
      operboxHmacKeyVersion: savedPlanContext ? payload.operboxHmacKeyVersion : null,
      createdAt: result.startedAt ? new Date(result.startedAt) : new Date(),
    });
    if (lease) {
      const activeLease = lease;
      if (!runStored || result.fallbackUsed) {
        await dependencies.releaseCacheLease(activeLease);
      } else {
        const referenceStored = await dependencies.recordCacheReference({
          cacheKeyHmac: activeLease.keyHmac,
          diagnosticId: publicResult.diagnosticId,
          userId: payload.cacheReferenceUserId,
        });
        if (referenceStored) await dependencies.completeCache(activeLease, publicResult);
        else await dependencies.releaseCacheLease(activeLease);
      }
      lease = null;
    }
    await dependencies.completeTask(id, { status: "done", result: publicResult });
    return solverDurationMs === null ? null : Math.max(1, solverDurationMs);
  } catch (error) {
    if (lease) await dependencies.releaseCacheLease(lease).catch(() => undefined);
    const errorCode = errorCodeOf(error);
    const diagnosticReason = diagnosticText(artifactResult?.error)
      ?? diagnosticText(error instanceof Error ? error.message : String(error));
    const diagnosticCause = diagnosticText(error instanceof Error && error.cause instanceof Error ? error.cause.message : null);
    const deferredArtifact = artifactResult ? await dependencies.describeArtifact(artifactResult) : null;
    const fallbackArtifact = await dependencies.saveFailureArtifact({
      diagnosticId,
      layout: payload.layout,
      operbox: payload.operbox,
      sourceName: payload.sourceName,
      rotation: payload.rotation,
      fiammettaEnable: payload.fiammettaEnable,
      dataOwnerTag: payload.dataOwnerTag,
      errorCode,
      diagnosticReason,
    }).catch((artifactError) => {
      console.error(JSON.stringify({
        level: "error",
        event: "plan_failure_artifact_write_failed",
        taskId: id,
        diagnosticId,
        message: diagnosticText(artifactError instanceof Error ? artifactError.message : String(artifactError)),
        errorType: artifactError instanceof Error ? artifactError.name : typeof artifactError,
      }));
      return null;
    });
    const artifact = fallbackArtifact ?? deferredArtifact;
    await dependencies.recordRun({
      diagnosticId,
      userId: task.userId,
      dataOwnerTag: payload.dataOwnerTag,
      sourceType: payload.sourceType,
      status: "failed",
      layoutTemplate: payload.layoutTemplate,
      roomCount: payload.roomCount,
      operatorCount: payload.operatorCount,
      rotation: payload.rotation,
      fiammettaEnable: payload.fiammettaEnable,
      errorCode,
      executionSource: taskSource === "failed" ? null : taskSource,
      durationMs: artifactResult?.durationMs ?? Math.round(performance.now() - workerStartedAt),
      solver: artifactResult?.solver,
      solverDurationMs,
      artifact,
      artifactStatus: deferredArtifact && artifactResult?.artifactEnvelopePath
        ? "pending"
        : artifact ? "complete" : "none",
      createdAt: new Date(),
    });
    await dependencies.completeTask(id, { status: "failed", error: "排班失败，请重试。" });
    const diagnostic = makeDiagnostic({code:errorCode,status:error instanceof PublicApiError ? error.status : 500,
      route:"worker/plan",requestId:diagnosticId,reason:diagnosticReason,
      diagnosticId,error,durationMs:Math.round(performance.now()-workerStartedAt)});
    persistDiagnostic(diagnostic);
    console.error(JSON.stringify({
      ...diagnostic,
      level: "error",
      event: "plan_task_failed",
      taskId: id,
      diagnosticId,
      errorCode,
      message: diagnosticReason,
      cause: diagnosticCause,
      errorType: error instanceof Error ? error.name : typeof error,
    }));
    return solverDurationMs === null ? null : Math.max(1, solverDurationMs);
  } finally {
    const workerDurationMs = Math.round(performance.now() - workerStartedAt);
    if (artifactResult) dependencies.enqueueArtifact(artifactResult);
    enqueuePlanExecutionUpdate(() => dependencies.updateRunExecution({
      diagnosticId,
      executionSource: taskSource,
      solverDurationMs,
      workerDurationMs,
    }), diagnosticId);
    console.log(JSON.stringify({
      level: "info",
      event: "plan_task_timing",
      taskId: id,
      serveLane,
      source: taskSource,
      solverDurationMs,
      workerDurationMs,
      workerOutsideSolverMs: solverDurationMs === null ? null : Math.max(0, workerDurationMs - solverDurationMs),
    }));
  }
}

type DispatcherState = {
  inFlight: number;
  serviceTimeEwmaMs: number | null;
};

export function createPlanWorkerWakeSignal() {
  let pending = false;
  let waiter: (() => void) | null = null;
  return {
    notify() {
      pending = true;
      const wake = waiter;
      waiter = null;
      wake?.();
    },
    async wait(timeoutMs: number) {
      if (pending) {
        pending = false;
        return;
      }
      await new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const finish = () => {
          if (timer) clearTimeout(timer);
          if (waiter === finish) waiter = null;
          pending = false;
          resolve();
        };
        waiter = finish;
        timer = setTimeout(finish, Math.max(0, timeoutMs));
      });
    },
  };
}

type PlanWorkerDispatcherDependencies = {
  claim: typeof claimNextPlanTask;
  execute: typeof executePlanTask;
  idlePollMs: number;
};

export async function runPlanWorkerDispatcher(input: {
  isShuttingDown: () => boolean;
  state: DispatcherState;
  wake: ReturnType<typeof createPlanWorkerWakeSignal>;
}, dependencies: PlanWorkerDispatcherDependencies = {
  claim: claimNextPlanTask,
  execute: executePlanTask,
  idlePollMs: 2_000,
}): Promise<void> {
  const laneLoads = Array.from({ length: PLAN_TASK_WORKER_CONCURRENCY }, () => 0);
  const executions = new Set<Promise<void>>();
  const capacity = PLAN_TASK_WORKER_CONCURRENCY * PLAN_TASK_PIPELINE_DEPTH;

  while (!input.isShuttingDown()) {
    let claimedAny = false;
    while (!input.isShuttingDown() && executions.size < capacity) {
      const minimumLaneLoad = Math.min(...laneLoads);
      const serveLane = minimumLaneLoad < PLAN_TASK_PIPELINE_DEPTH
        ? laneLoads.findIndex((load) => load === minimumLaneLoad)
        : -1;
      if (serveLane < 0) break;
      let task: ClaimedPlanTask | null;
      try {
        task = await dependencies.claim();
      } catch (error) {
        console.error("[plan-worker] dispatcher claim failed:", error);
        break;
      }
      if (!task) break;
      claimedAny = true;
      laneLoads[serveLane] += 1;
      input.state.inFlight = executions.size + 1;
      const execution = dependencies.execute(task, serveLane)
        .then((serviceTimeMs) => {
          if (serviceTimeMs === null) return;
          input.state.serviceTimeEwmaMs = input.state.serviceTimeEwmaMs === null
            ? serviceTimeMs
            : Math.round(input.state.serviceTimeEwmaMs * 0.8 + serviceTimeMs * 0.2);
        })
        .catch((error) => console.error(`[plan-worker] lane=${serveLane} unexpected task error:`, error))
        .finally(() => {
          laneLoads[serveLane] -= 1;
          executions.delete(execution);
          input.state.inFlight = executions.size;
          input.wake.notify();
        });
      executions.add(execution);
      console.log(`[plan-worker] lane=${serveLane} executing task ${task.id} attempt=${task.attempts} inFlight=${executions.size}`);
    }
    if (!claimedAny) await input.wake.wait(dependencies.idlePollMs);
  }
  await Promise.allSettled(executions);
}

export async function runPlanWorker(): Promise<void> {
  const releaseSha = process.env.APP_RELEASE_SHA?.trim() ?? "";
  if (!/^[0-9a-f]{40}$/.test(releaseSha)) throw new Error("APP_RELEASE_SHA must be a full lowercase Git commit SHA.");
  await assertPlanArtifactStorageReady();

  const startedAt = new Date();
  await Promise.all(Array.from(
    { length: PLAN_TASK_WORKER_CONCURRENCY },
    (_, serveLane) => warmPlanServeLane(serveLane),
  ));
  const recovery = await recoverStaleRunningTasks(startedAt);
  await cleanupExpiredPlanTasks(startedAt);
  const dispatcherState: DispatcherState = { inFlight: 0, serviceTimeEwmaMs: null };
  const wake = createPlanWorkerWakeSignal();
  await recordPlanWorkerHeartbeat({
    releaseSha,
    startedAt,
    solverLanes: PLAN_TASK_WORKER_CONCURRENCY,
    pipelineDepth: PLAN_TASK_PIPELINE_DEPTH,
    inFlight: 0,
  });
  console.log(`[plan-worker] started release=${releaseSha} solverLanes=${PLAN_TASK_WORKER_CONCURRENCY} pipelineDepth=${PLAN_TASK_PIPELINE_DEPTH} capacity=${PLAN_TASK_WORKER_CONCURRENCY * PLAN_TASK_PIPELINE_DEPTH} recovered=${recovery.recovered} failed=${recovery.failed}`);

  let shuttingDown = false;
  let heartbeatInFlight = false;
  let cleanupInFlight = false;
  const heartbeatTimer = setInterval(() => {
    if (heartbeatInFlight) return;
    heartbeatInFlight = true;
    void recordPlanWorkerHeartbeat({
      releaseSha,
      startedAt,
      solverLanes: PLAN_TASK_WORKER_CONCURRENCY,
      pipelineDepth: PLAN_TASK_PIPELINE_DEPTH,
      inFlight: dispatcherState.inFlight,
      serviceTimeEwmaMs: dispatcherState.serviceTimeEwmaMs,
    })
      .catch((error) => console.error("[plan-worker] heartbeat failed:", error))
      .finally(() => { heartbeatInFlight = false; });
  }, HEARTBEAT_INTERVAL_MS);
  const cleanupTimer = setInterval(() => {
    if (cleanupInFlight) return;
    cleanupInFlight = true;
    void cleanupExpiredPlanTasks()
      .catch((error) => console.error("[plan-worker] cleanup failed:", error))
      .finally(() => { cleanupInFlight = false; });
  }, CLEANUP_INTERVAL_MS);
  heartbeatTimer.unref();
  cleanupTimer.unref();

  void resumePendingPlanArtifactFinalizations()
    .then((resumedArtifacts) => console.log(`[plan-worker] artifact recovery queued=${resumedArtifacts}`))
    .catch((error) => console.error("[plan-worker] artifact recovery scan failed:", error));

  const stopListening = await listenForPlanTaskAvailability(() => wake.notify()).catch((error) => {
    console.error("[plan-worker] LISTEN unavailable; using 2s fallback polling:", error);
    return null;
  });
  const beginShutdown = () => {
    shuttingDown = true;
    wake.notify();
  };
  process.on("SIGINT", beginShutdown);
  process.on("SIGTERM", beginShutdown);

  await runPlanWorkerDispatcher({
    isShuttingDown: () => shuttingDown,
    state: dispatcherState,
    wake,
  });

  clearInterval(heartbeatTimer);
  clearInterval(cleanupTimer);
  await stopListening?.();
  process.off("SIGINT", beginShutdown);
  process.off("SIGTERM", beginShutdown);
  console.log("[plan-worker] shutting down");
  const [executionUpdatesDrained, artifactsDrained] = await Promise.all([
    waitForPlanExecutionUpdates(30_000),
    waitForPlanArtifactFinalizers(30_000),
  ]);
  if (!executionUpdatesDrained) console.warn("[plan-worker] timing updates exceeded the 30s shutdown budget");
  if (!artifactsDrained) console.warn("[plan-worker] artifact finalizers exceeded the 30s shutdown budget; pending envelopes will resume on startup");
  stopInfraServeClients("计划任务 Worker 正在退出。");
  await (getDatabase().$client as { end: () => Promise<void> }).end().catch(() => undefined);
  console.log("[plan-worker] stopped");
}
