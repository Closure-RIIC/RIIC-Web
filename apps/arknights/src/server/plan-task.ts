import { createHmac, randomUUID } from "node:crypto";

import { and, count, eq, gt, gte, inArray, lt, or, sql } from "drizzle-orm";
import type { Notification, PoolClient } from "pg";

import type { BaseBlueprint, OperBoxEntry, PublicPlanData, SavedPlanCalculationContext } from "@/types";

import {
  MAX_CONCURRENT_AUTHENTICATED_PLAN_ADMISSIONS,
  MAX_CONCURRENT_NEW_ACCOUNT_PLAN_ADMISSIONS,
  MAX_CONCURRENT_PLAN_ACCOUNTS_PER_IP,
  MAX_PLAN_STARTS_PER_ACCOUNT,
  MAX_PLAN_STARTS_PER_IP,
  PLAN_START_WINDOW_MS,
  PublicApiError,
  type PlanAccountAdmissionClass,
} from "./api-contract.ts";
import { workspaceMasterKeys } from "./business-config.ts";
import { getDatabase, getDatabasePool } from "./db/index.ts";
import { planTask, planWorkerHeartbeat } from "./db/schema.ts";
import {
  decryptPlanTaskPayload,
  encryptPlanTaskPayload,
  type PlanTaskEnvelope,
} from "./workspace-crypto.ts";

export type PlanTaskStatus = "buffered" | "pending" | "running" | "done" | "failed" | "cancelled";

export type PlanTaskPayload = {
  layout: BaseBlueprint;
  operbox: OperBoxEntry[];
  sourceName: string | null;
  sourceType: "sample" | "maa" | "skland";
  rotation: string;
  fiammettaEnable: boolean;
  layoutTemplate: string;
  roomCount: number;
  operatorCount: number;
  dataOwnerTag: string | null;
  calculationContext: SavedPlanCalculationContext;
  operboxContentHmac: string | null;
  operboxHmacKeyVersion: string | null;
  cacheReferenceUserId: string | null;
};

export type PlanTaskRow = {
  id: string;
  userId: string;
  status: PlanTaskStatus;
  result: PublicPlanData | null;
  error: string | null;
  attempts: number;
  createdAt: Date;
  startedAt: Date | null;
  solverStartedAt: Date | null;
  solverFinishedAt: Date | null;
  executionSource: "cache" | "solver" | null;
  finishedAt: Date | null;
  expiresAt: Date;
};

export type ClaimedPlanTask = PlanTaskRow & { payload: PlanTaskPayload };

export const PLAN_TASK_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_BUFFERED_PLAN_TASKS = 2_000;
export const PLAN_TASK_ETA_PER_TASK_SECONDS = 3;
export const PLAN_TASK_MAX_ATTEMPTS = 3;
export const PLAN_TASK_WORKER_CONCURRENCY = 4;
export const PLAN_WORKER_HEARTBEAT_MAX_AGE_MS = 20_000;

const ACTIVE_STATUSES: PlanTaskStatus[] = ["pending", "running"];
const RESERVED_STATUSES: PlanTaskStatus[] = ["buffered", ...ACTIVE_STATUSES];
const WORKER_HEARTBEAT_ID = "plan-worker";
const PLAN_TASK_NOTIFY_CHANNEL = "plan_task_available";
let cachedWorkerEstimate: {
  expiresAt: number;
  value: { solverLanes: number; inFlight: number; serviceTimeEwmaMs: number | null; heartbeatAt: Date } | null;
} | null = null;

const publicPlanTaskColumns = {
  id: planTask.id,
  userId: planTask.userId,
  status: planTask.status,
  result: planTask.result,
  error: planTask.error,
  attempts: planTask.attempts,
  createdAt: planTask.createdAt,
  startedAt: planTask.startedAt,
  solverStartedAt: planTask.solverStartedAt,
  solverFinishedAt: planTask.solverFinishedAt,
  executionSource: planTask.executionSource,
  finishedAt: planTask.finishedAt,
  expiresAt: planTask.expiresAt,
};

type PublicPlanTaskRecord = {
  [Key in keyof typeof publicPlanTaskColumns]: typeof planTask.$inferSelect[Key];
};

function mapPlanTaskRow(row: PublicPlanTaskRecord): PlanTaskRow {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status as PlanTaskStatus,
    result: row.result as PublicPlanData | null,
    error: row.error,
    attempts: row.attempts,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    solverStartedAt: row.solverStartedAt,
    solverFinishedAt: row.solverFinishedAt,
    executionSource: row.executionSource === "cache" || row.executionSource === "solver" ? row.executionSource : null,
    finishedAt: row.finishedAt,
    expiresAt: row.expiresAt,
  };
}

function encryptedEnvelope(row: typeof planTask.$inferSelect): PlanTaskEnvelope {
  if (
    !row.encryptedPayload
    || !row.payloadIv
    || !row.wrappedDataKey
    || !row.wrappedKeyIv
    || !row.keyVersion
    || row.schemaVersion === null
  ) {
    throw new Error("Active plan task is missing its encrypted payload envelope.");
  }
  return {
    encryptedPayload: row.encryptedPayload,
    payloadIv: row.payloadIv,
    wrappedDataKey: row.wrappedDataKey,
    wrappedKeyIv: row.wrappedKeyIv,
    keyVersion: row.keyVersion,
    schemaVersion: row.schemaVersion,
  };
}

function parsePlanTaskPayload(value: string): PlanTaskPayload {
  const parsed = JSON.parse(value) as Partial<PlanTaskPayload> | null;
  if (
    !parsed
    || typeof parsed !== "object"
    || !parsed.layout
    || typeof parsed.layout !== "object"
    || !Array.isArray(parsed.operbox)
    || !parsed.calculationContext
    || typeof parsed.calculationContext !== "object"
    || !["sample", "maa", "skland"].includes(parsed.sourceType ?? "")
    || typeof parsed.rotation !== "string"
    || typeof parsed.fiammettaEnable !== "boolean"
    || typeof parsed.layoutTemplate !== "string"
    || typeof parsed.roomCount !== "number"
    || typeof parsed.operatorCount !== "number"
  ) {
    throw new Error("Plan task payload does not match the supported schema.");
  }
  return parsed as PlanTaskPayload;
}

function clearedPayloadColumns() {
  return {
    encryptedPayload: null,
    payloadIv: null,
    wrappedDataKey: null,
    wrappedKeyIv: null,
    keyVersion: null,
    schemaVersion: null,
  };
}

function expiredAtOrBefore(now: Date) {
  return sql`${planTask.expiresAt} <= ${now}`;
}

export function planTaskIpHmac(ip: string, key: Buffer): string {
  return createHmac("sha256", key)
    .update("arknights-infra-plan-task-ip-v1\0", "utf8")
    .update(ip, "utf8")
    .digest("hex");
}

export function planTaskAdmissionStatus(input: {
  activeTotal: number;
  activeNewAccounts: number;
  accountClass: PlanAccountAdmissionClass;
}): "buffered" | "pending" {
  return input.activeTotal >= MAX_CONCURRENT_AUTHENTICATED_PLAN_ADMISSIONS
    || (
      input.accountClass === "new"
      && input.activeNewAccounts >= MAX_CONCURRENT_NEW_ACCOUNT_PLAN_ADMISSIONS
    )
    ? "buffered"
    : "pending";
}

export function planTaskEtaSeconds(queuePosition: number, worker?: {
  solverLanes?: number | null;
  inFlight?: number | null;
  serviceTimeEwmaMs?: number | null;
}): number {
  const lanes = Math.max(1, Math.trunc(worker?.solverLanes ?? PLAN_TASK_WORKER_CONCURRENCY));
  const inFlight = Math.max(0, Math.trunc(worker?.inFlight ?? 0));
  const serviceSeconds = Math.max(1, Math.ceil((worker?.serviceTimeEwmaMs ?? PLAN_TASK_ETA_PER_TASK_SECONDS * 1_000) / 1_000));
  return Math.ceil((Math.max(1, queuePosition) + inFlight) / lanes) * serviceSeconds;
}

export async function currentPlanTaskEtaSeconds(queuePosition: number, includeInFlight = true): Promise<number> {
  const now = Date.now();
  let worker = cachedWorkerEstimate?.expiresAt && cachedWorkerEstimate.expiresAt > now
    ? cachedWorkerEstimate.value
    : null;
  if (!cachedWorkerEstimate || cachedWorkerEstimate.expiresAt <= now) {
    [worker] = await getDatabase().select({
      solverLanes: planWorkerHeartbeat.solverLanes,
      inFlight: planWorkerHeartbeat.inFlight,
      serviceTimeEwmaMs: planWorkerHeartbeat.serviceTimeEwmaMs,
      heartbeatAt: planWorkerHeartbeat.heartbeatAt,
    }).from(planWorkerHeartbeat).where(eq(planWorkerHeartbeat.id, WORKER_HEARTBEAT_ID)).limit(1);
    cachedWorkerEstimate = { expiresAt: now + 5_000, value: worker ?? null };
  }
  if (!worker || Date.now() - worker.heartbeatAt.getTime() > PLAN_WORKER_HEARTBEAT_MAX_AGE_MS) {
    return planTaskEtaSeconds(queuePosition);
  }
  return planTaskEtaSeconds(queuePosition, {
    solverLanes: worker.solverLanes,
    inFlight: includeInFlight ? worker.inFlight : 0,
    serviceTimeEwmaMs: worker.serviceTimeEwmaMs,
  });
}

export function planTaskBufferIsFull(bufferedCount: number): boolean {
  return bufferedCount >= MAX_BUFFERED_PLAN_TASKS;
}

function startWindowRetryAfter(oldest: Date | null, now: Date): number {
  if (!oldest) return 1;
  return Math.max(1, Math.ceil((oldest.getTime() + PLAN_START_WINDOW_MS - now.getTime()) / 1_000));
}

export async function createPlanTask(input: {
  userId: string;
  accountClass: PlanAccountAdmissionClass;
  requestIpHmac: string;
  payload: PlanTaskPayload;
}): Promise<PlanTaskRow> {
  const now = new Date();
  const taskId = randomUUID();
  const { activeVersion, keys } = workspaceMasterKeys();
  const activeKey = keys.get(activeVersion);
  if (!activeKey) throw new Error("Active workspace key is unavailable.");
  const envelope = encryptPlanTaskPayload({
    userId: input.userId,
    taskId,
    plaintext: JSON.stringify(input.payload),
    activeVersion,
    masterKey: activeKey,
  });
  const expiresAt = new Date(now.getTime() + PLAN_TASK_TTL_MS);
  const startsSince = new Date(now.getTime() - PLAN_START_WINDOW_MS);

  const transactionStartedAt = performance.now();
  let lockWaitMs = 0;
  return getDatabase().transaction(async (tx) => {
    const lockStartedAt = performance.now();
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('plan-task-admission-v1'))`);
    lockWaitMs = performance.now() - lockStartedAt;
    // Release only this account's expired reservation. Global retention cleanup is
    // owned by the worker and no longer runs on every submission.
    await tx.update(planTask).set({
      status: "failed",
      error: "任务已过期，请重新提交。",
      finishedAt: now,
      ...clearedPayloadColumns(),
    }).where(and(
      eq(planTask.userId, input.userId),
      inArray(planTask.status, RESERVED_STATUSES),
      expiredAtOrBefore(now),
    ));
    const active = and(inArray(planTask.status, ACTIVE_STATUSES), gt(planTask.expiresAt, now));
    const reserved = and(inArray(planTask.status, RESERVED_STATUSES), gt(planTask.expiresAt, now));
    const [existing] = await tx.select({ id: planTask.id }).from(planTask).where(and(
      reserved,
      eq(planTask.userId, input.userId),
    )).limit(1);
    if (existing) throw new PublicApiError("AIC-PLAN-3005");

    const [activeCounts] = await tx.select({
      total: count(),
      newAccounts: sql<number>`count(*) filter (where ${planTask.accountClass} = 'new')`.mapWith(Number),
      ip: sql<number>`count(*) filter (where ${planTask.requestIpHmac} = ${input.requestIpHmac})`.mapWith(Number),
    }).from(planTask).where(active);
    const accountMatch = eq(planTask.userId, input.userId);
    const ipMatch = eq(planTask.requestIpHmac, input.requestIpHmac);
    const [starts] = await tx.select({
      account: sql<number>`count(*) filter (where ${accountMatch})`.mapWith(Number),
      ip: sql<number>`count(*) filter (where ${ipMatch})`.mapWith(Number),
      accountOldest: sql<Date | null>`min(${planTask.createdAt}) filter (where ${accountMatch})`.mapWith(planTask.createdAt),
      ipOldest: sql<Date | null>`min(${planTask.createdAt}) filter (where ${ipMatch})`.mapWith(planTask.createdAt),
    }).from(planTask).where(and(
      or(accountMatch, ipMatch),
      gte(planTask.createdAt, startsSince),
    ));

    if ((activeCounts?.ip ?? 0) >= MAX_CONCURRENT_PLAN_ACCOUNTS_PER_IP) {
      throw new PublicApiError("AIC-PLAN-3007", { retryAfter: 5 });
    }
    if ((starts?.account ?? 0) >= MAX_PLAN_STARTS_PER_ACCOUNT) {
      throw new PublicApiError("AIC-PLAN-3006", {
        retryAfter: startWindowRetryAfter(starts?.accountOldest ?? null, now),
      });
    }
    if ((starts?.ip ?? 0) >= MAX_PLAN_STARTS_PER_IP) {
      throw new PublicApiError("AIC-PLAN-3007", {
        retryAfter: startWindowRetryAfter(starts?.ipOldest ?? null, now),
      });
    }

    const status = planTaskAdmissionStatus({
      activeTotal: activeCounts?.total ?? 0,
      activeNewAccounts: activeCounts?.newAccounts ?? 0,
      accountClass: input.accountClass,
    });
    if (status === "buffered") {
      const [bufferedCount] = await tx.select({ value: count() }).from(planTask).where(and(
        eq(planTask.status, "buffered"),
        gt(planTask.expiresAt, now),
      ));
      if (planTaskBufferIsFull(bufferedCount?.value ?? 0)) {
        throw new PublicApiError("AIC-PLAN-3008", { retryAfter: 30 });
      }
    }

    const [inserted] = await tx.insert(planTask).values({
      id: taskId,
      userId: input.userId,
      accountClass: input.accountClass,
      requestIpHmac: input.requestIpHmac,
      status,
      ...envelope,
      attempts: 0,
      createdAt: now,
      expiresAt,
    }).returning();
    if (!inserted) throw new Error("Plan task insert did not return a row.");
    if (status === "pending") await tx.execute(sql`select pg_notify(${PLAN_TASK_NOTIFY_CHANNEL}, ${taskId})`);
    return mapPlanTaskRow(inserted);
  }).finally(() => {
    const transactionMs = performance.now() - transactionStartedAt;
    if (transactionMs >= 100 || lockWaitMs >= 100) {
      console.log(JSON.stringify({
        level: "info",
        event: "plan_task_admission_slow",
        lockWaitMs: Math.round(lockWaitMs),
        transactionMs: Math.round(transactionMs),
      }));
    }
  });
}

export async function getPlanTask(id: string): Promise<PlanTaskRow | null> {
  const [row] = await getDatabase().select(publicPlanTaskColumns).from(planTask).where(and(
    eq(planTask.id, id),
    gt(planTask.expiresAt, new Date()),
  )).limit(1);
  return row ? mapPlanTaskRow(row) : null;
}

async function claimPendingPlanTask(): Promise<typeof planTask.$inferSelect | null> {
  return getDatabase().transaction(async (tx) => {
    const result = await tx.execute<{ id: string }>(sql`
      UPDATE ${planTask}
      SET status = 'running', started_at = now(), attempts = attempts + 1
      WHERE id = (
        SELECT id FROM ${planTask}
        WHERE status = 'pending' AND expires_at > now() AND attempts < ${PLAN_TASK_MAX_ATTEMPTS}
        ORDER BY created_at, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `);
    const claimedId = result.rows[0]?.id;
    if (!claimedId) return null;
    const [claimed] = await tx.select().from(planTask).where(eq(planTask.id, claimedId)).limit(1);
    return claimed ?? null;
  });
}

async function promoteBufferedPlanTask(): Promise<boolean> {
  const [waiting] = await getDatabase().select({ id: planTask.id }).from(planTask).where(and(
    eq(planTask.status, "buffered"),
    gt(planTask.expiresAt, new Date()),
  )).limit(1);
  if (!waiting) return false;

  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('plan-task-admission-v1'))`);
    const now = new Date();
    const active = and(inArray(planTask.status, ACTIVE_STATUSES), gt(planTask.expiresAt, now));
    const [globalCount] = await tx.select({ value: count() }).from(planTask).where(active);
    const [newAccountCount] = await tx.select({ value: count() }).from(planTask).where(and(
      active,
      eq(planTask.accountClass, "new"),
    ));

    if ((globalCount?.value ?? 0) >= MAX_CONCURRENT_AUTHENTICATED_PLAN_ADMISSIONS) return false;
    const promoted = await tx.execute<{ id: string }>(sql`
        UPDATE ${planTask}
        SET status = 'pending'
        WHERE id = (
          SELECT candidate.id FROM ${planTask} AS candidate
          WHERE candidate.status = 'buffered'
            AND candidate.expires_at > now()
            AND candidate.attempts < ${PLAN_TASK_MAX_ATTEMPTS}
            AND (
              candidate.account_class <> 'new'
              OR ${newAccountCount?.value ?? 0} < ${MAX_CONCURRENT_NEW_ACCOUNT_PLAN_ADMISSIONS}
            )
            AND (
              SELECT count(*) FROM ${planTask} AS active_for_ip
              WHERE active_for_ip.status IN ('pending', 'running')
                AND active_for_ip.expires_at > now()
                AND active_for_ip.request_ip_hmac = candidate.request_ip_hmac
            ) < ${MAX_CONCURRENT_PLAN_ACCOUNTS_PER_IP}
          ORDER BY random()
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id
      `);
    const promotedId = promoted.rows[0]?.id;
    if (promotedId) await tx.execute(sql`select pg_notify(${PLAN_TASK_NOTIFY_CHANNEL}, ${promotedId})`);
    return Boolean(promotedId);
  });
}

async function promoteBufferedPlanTaskBestEffort(): Promise<boolean> {
  try {
    return await promoteBufferedPlanTask();
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      event: "plan_task_buffer_promotion_failed",
      message: error instanceof Error ? error.message : String(error),
    }));
    return false;
  }
}

export async function claimNextPlanTask(): Promise<ClaimedPlanTask | null> {
  let row = await claimPendingPlanTask();
  if (row) {
    // Claiming does not consume another admission slot. If a previous completion
    // opened one, refill it from the randomized buffer without serializing the claim.
    await promoteBufferedPlanTaskBestEffort();
  } else if (await promoteBufferedPlanTaskBestEffort()) {
    row = await claimPendingPlanTask();
  }
  if (!row) return null;
  try {
    const { keys } = workspaceMasterKeys();
    const plaintext = decryptPlanTaskPayload({
      userId: row.userId,
      taskId: row.id,
      envelope: encryptedEnvelope(row),
      keys,
    });
    return { ...mapPlanTaskRow(row), payload: parsePlanTaskPayload(plaintext) };
  } catch (error) {
    await completePlanTask(row.id, { status: "failed", error: "任务数据无法读取，请重新提交。" });
    console.error(JSON.stringify({
      level: "error",
      event: "plan_task_payload_decrypt_failed",
      taskId: row.id,
      message: error instanceof Error ? error.message : String(error),
    }));
    return null;
  }
}

export async function markPlanTaskExecutionStarted(id: string, source: "cache" | "solver"): Promise<void> {
  const now = new Date();
  await getDatabase().update(planTask).set({
    executionSource: source,
    solverStartedAt: source === "solver" ? now : null,
    solverFinishedAt: null,
  }).where(and(eq(planTask.id, id), eq(planTask.status, "running")));
}

export async function markPlanTaskSolverFinished(id: string, timing?: {
  startedAt?: string;
  finishedAt?: string;
}): Promise<void> {
  const startedAt = timing?.startedAt ? new Date(timing.startedAt) : null;
  const finishedAt = timing?.finishedAt ? new Date(timing.finishedAt) : new Date();
  await getDatabase().update(planTask).set({
    ...(startedAt && Number.isFinite(startedAt.getTime()) ? { solverStartedAt: startedAt } : {}),
    solverFinishedAt: Number.isFinite(finishedAt.getTime()) ? finishedAt : new Date(),
  })
    .where(and(eq(planTask.id, id), eq(planTask.status, "running")));
}

export async function completePlanTask(
  id: string,
  input:
    | { status: "done"; result: PublicPlanData }
    | { status: "failed"; error?: string | null },
): Promise<void> {
  await getDatabase()
    .update(planTask)
    .set({
      status: input.status,
      result: input.status === "done" ? input.result : null,
      error: input.status === "failed" ? input.error?.slice(0, 500) ?? null : null,
      finishedAt: new Date(),
      ...clearedPayloadColumns(),
    })
    .where(eq(planTask.id, id));
  await getDatabase().execute(sql`select pg_notify(${PLAN_TASK_NOTIFY_CHANNEL}, ${id})`);
}

export async function cancelPlanTask(id: string): Promise<"cancelled" | "running" | "unavailable"> {
  const updated = await getDatabase()
    .update(planTask)
    .set({ status: "cancelled", finishedAt: new Date(), ...clearedPayloadColumns() })
    .where(and(eq(planTask.id, id), inArray(planTask.status, ["buffered", "pending"])))
    .returning({ id: planTask.id });
  if (updated.length > 0) {
    await getDatabase().execute(sql`select pg_notify(${PLAN_TASK_NOTIFY_CHANNEL}, ${id})`);
    return "cancelled";
  }
  const [row] = await getDatabase()
    .select({ status: planTask.status })
    .from(planTask)
    .where(and(eq(planTask.id, id), gt(planTask.expiresAt, new Date())))
    .limit(1);
  if (!row) return "unavailable";
  return row.status === "running" ? "running" : "unavailable";
}

export async function planQueuePosition(id: string): Promise<number> {
  const [task] = await getDatabase()
    .select({ id: planTask.id, createdAt: planTask.createdAt })
    .from(planTask)
    .where(and(eq(planTask.id, id), gt(planTask.expiresAt, new Date())))
    .limit(1);
  if (!task) return 1;
  const [row] = await getDatabase()
    .select({ value: count() })
    .from(planTask)
    .where(and(
      eq(planTask.status, "pending"),
      or(
        lt(planTask.createdAt, task.createdAt),
        and(eq(planTask.createdAt, task.createdAt), lt(planTask.id, task.id)),
      ),
      gt(planTask.expiresAt, new Date()),
    ));
  return (row?.value ?? 0) + 1;
}

export async function planSelectionPoolSize(): Promise<number> {
  const [row] = await getDatabase()
    .select({ value: count() })
    .from(planTask)
    .where(and(eq(planTask.status, "buffered"), gt(planTask.expiresAt, new Date())));
  return row?.value ?? 0;
}

export async function cleanupExpiredPlanTasks(now = new Date()): Promise<number> {
  return getDatabase().transaction(async (tx) => {
    await tx.update(planTask).set({
      status: "failed",
      error: "任务已过期，请重新提交。",
      finishedAt: now,
      ...clearedPayloadColumns(),
    }).where(and(expiredAtOrBefore(now), eq(planTask.status, "running")));
    const deleted = await tx.delete(planTask)
      .where(expiredAtOrBefore(now))
      .returning({ id: planTask.id });
    return deleted.length;
  });
}

export async function recoverStaleRunningTasks(now = new Date()): Promise<{ recovered: number; failed: number }> {
  return getDatabase().transaction(async (tx) => {
    const failed = await tx.update(planTask).set({
      status: "failed",
      error: "任务执行中断，请重新提交。",
      finishedAt: now,
      ...clearedPayloadColumns(),
    }).where(and(
      eq(planTask.status, "running"),
      or(expiredAtOrBefore(now), gte(planTask.attempts, PLAN_TASK_MAX_ATTEMPTS)),
    )).returning({ id: planTask.id });
    const recovered = await tx.update(planTask).set({
      status: "pending",
      startedAt: null,
      solverStartedAt: null,
      solverFinishedAt: null,
      executionSource: null,
    }).where(and(
      eq(planTask.status, "running"),
      gt(planTask.expiresAt, now),
      lt(planTask.attempts, PLAN_TASK_MAX_ATTEMPTS),
    )).returning({ id: planTask.id });
    if (recovered.length > 0) await tx.execute(sql`select pg_notify(${PLAN_TASK_NOTIFY_CHANNEL}, 'recovery')`);
    return { recovered: recovered.length, failed: failed.length };
  });
}

export async function recordPlanWorkerHeartbeat(input: {
  releaseSha: string;
  startedAt: Date;
  heartbeatAt?: Date;
  solverLanes?: number;
  pipelineDepth?: number;
  inFlight?: number;
  serviceTimeEwmaMs?: number | null;
}): Promise<void> {
  const heartbeatAt = input.heartbeatAt ?? new Date();
  await getDatabase().insert(planWorkerHeartbeat).values({
    id: WORKER_HEARTBEAT_ID,
    releaseSha: input.releaseSha,
    startedAt: input.startedAt,
    heartbeatAt,
    solverLanes: input.solverLanes ?? PLAN_TASK_WORKER_CONCURRENCY,
    pipelineDepth: input.pipelineDepth ?? 2,
    inFlight: input.inFlight ?? 0,
    serviceTimeEwmaMs: input.serviceTimeEwmaMs ?? null,
  }).onConflictDoUpdate({
    target: planWorkerHeartbeat.id,
    set: {
      releaseSha: input.releaseSha,
      startedAt: input.startedAt,
      heartbeatAt,
      solverLanes: input.solverLanes ?? PLAN_TASK_WORKER_CONCURRENCY,
      pipelineDepth: input.pipelineDepth ?? 2,
      inFlight: input.inFlight ?? 0,
      serviceTimeEwmaMs: input.serviceTimeEwmaMs ?? null,
    },
  });
}

type PlanTaskListenerDependencies = {
  connect: () => Promise<PoolClient>;
  reconnectDelayMs: number;
};

export async function listenForPlanTaskAvailability(
  onNotify: () => void,
  dependencies: PlanTaskListenerDependencies = {
    connect: () => getDatabasePool().connect(),
    reconnectDelayMs: 2_000,
  },
): Promise<() => Promise<void>> {
  type ActiveListener = {
    client: PoolClient;
    notification: (message: Notification) => void;
    error: (error: Error) => void;
    end: () => void;
    released: boolean;
  };

  let stopped = false;
  let active: ActiveListener | null = null;
  let connecting: Promise<void> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, Math.max(0, dependencies.reconnectDelayMs));
    reconnectTimer.unref();
  };

  const release = (listener: ActiveListener, error?: Error) => {
    if (listener.released) return;
    listener.released = true;
    listener.client.off("notification", listener.notification);
    listener.client.off("error", listener.error);
    listener.client.off("end", listener.end);
    if (active === listener) active = null;
    try {
      listener.client.release(error);
    } catch {
      // The pool may already have discarded a broken client.
    }
  };

  const connectionFailed = (listener: ActiveListener, error: Error) => {
    if (listener.released) return;
    console.error("[plan-worker] LISTEN connection lost; retrying:", error);
    release(listener, error);
    scheduleReconnect();
  };

  const connect = async () => {
    if (stopped || connecting || active) return;
    const task = (async () => {
      let listener: ActiveListener | null = null;
      try {
        const client = await dependencies.connect();
        listener = {
          client,
          notification: (message) => {
            if (message.channel === PLAN_TASK_NOTIFY_CHANNEL) onNotify();
          },
          error: (error) => {
            if (listener) connectionFailed(listener, error);
          },
          end: () => {
            if (listener) connectionFailed(listener, new Error("PostgreSQL LISTEN connection ended."));
          },
          released: false,
        };
        active = listener;
        client.on("notification", listener.notification);
        client.on("error", listener.error);
        client.on("end", listener.end);
        await client.query(`LISTEN ${PLAN_TASK_NOTIFY_CHANNEL}`);
        if (stopped) release(listener);
      } catch (error) {
        if (listener) release(listener, error instanceof Error ? error : new Error(String(error)));
        console.error("[plan-worker] LISTEN unavailable; retrying while safety polling remains active:", error);
        scheduleReconnect();
      }
    })();
    connecting = task;
    try {
      await task;
    } finally {
      if (connecting === task) connecting = null;
      if (!stopped && !active && !reconnectTimer) scheduleReconnect();
    }
  };

  await connect();
  return async () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    await connecting?.catch(() => undefined);
    const listener = active;
    if (!listener) return;
    listener.client.off("error", listener.error);
    listener.client.off("end", listener.end);
    await listener.client.query(`UNLISTEN ${PLAN_TASK_NOTIFY_CHANNEL}`).catch(() => undefined);
    release(listener);
  };
}

export async function getPlanWorkerHealth(input: {
  expectedReleaseSha: string;
  now?: Date;
}): Promise<{ ready: boolean; releaseSha: string | null; heartbeatAt: Date | null }> {
  const [row] = await getDatabase().select().from(planWorkerHeartbeat)
    .where(eq(planWorkerHeartbeat.id, WORKER_HEARTBEAT_ID))
    .limit(1);
  const now = input.now ?? new Date();
  const ready = Boolean(
    row
    && /^[0-9a-f]{40}$/.test(input.expectedReleaseSha)
    && row.releaseSha === input.expectedReleaseSha
    && now.getTime() - row.heartbeatAt.getTime() <= PLAN_WORKER_HEARTBEAT_MAX_AGE_MS,
  );
  return { ready, releaseSha: row?.releaseSha ?? null, heartbeatAt: row?.heartbeatAt ?? null };
}
