import { randomUUID } from "node:crypto";
import { PublicApiError } from "./api-contract";
import { feedbackOperators } from "../feedback-similarity.ts";

import { and, desc, eq, gt, gte, inArray, lte, lt, notInArray, or, sql, type SQL } from "drizzle-orm";

import { PRIVACY_VERSION, TERMS_VERSION } from "@/legal-policy";
import {
  ADMIN_SOLVER_ERROR_WINDOW_MINUTES,
  ADMIN_SOLVER_TREND_BUCKET_MINUTES,
  ADMIN_SOLVER_TREND_WINDOW_MINUTES,
} from "@/solver-metrics-config";
import { buildAdminSolverMetricsData } from "@/solver-metrics";
import type { AdminFeedbackFacility, AdminFeedbackStatus, AppErrorCode, FeedbackRequest, SavedPlanCalculationContext, SolverObservation } from "@/types";
import { buildAdminSolverTrendQuery } from "./admin-solver-metrics-trend";
import { BUSINESS_DATA_TTL_MS, isBusinessDatabaseEnabled, isPlanCacheEnabled } from "./business-config";
import { getDatabase } from "./db";
import {
  feedback,
  feedbackEvent,
  operboxSnapshot,
  planCache,
  planRun,
  planTask,
  policyConsent,
  savedPlan,
  telemetryEvent,
  userWorkspace,
  workspaceRevision,
} from "./db/schema";
import { toStoredFeedbackIssue } from "./feedback-record";

export type PrivateArtifactDescriptor = {
  key: string;
  bytes: number;
  sha256: string;
};

export type PlanRunSummaryInput = {
  diagnosticId: string;
  userId?: string | null;
  dataOwnerTag?: string | null;
  sourceType: "sample" | "maa" | "skland";
  status: "success" | "failed";
  layoutTemplate: string;
  roomCount: number;
  operatorCount: number;
  rotation: string;
  fiammettaEnable: boolean;
  durationMs?: number | null;
  executionSource?: "cache" | "solver" | null;
  solverDurationMs?: number | null;
  workerDurationMs?: number | null;
  errorCode?: AppErrorCode | null;
  solver?: SolverObservation | null;
  artifact?: PrivateArtifactDescriptor | null;
  artifactStatus?: "pending" | "complete" | "failed" | "none" | null;
  artifactFinalizedAt?: Date | null;
  calculationContext?: SavedPlanCalculationContext | null;
  publicResultSha256?: string | null;
  operboxContentHmac?: string | null;
  operboxHmacKeyVersion?: string | null;
  createdAt?: Date;
};

function expiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + BUSINESS_DATA_TTL_MS);
}

function hasSavedPlanBinding(input: PlanRunSummaryInput): boolean {
  return input.status === "success"
    && Boolean(input.userId)
    && Boolean(input.calculationContext)
    && /^[a-f0-9]{64}$/.test(input.publicResultSha256 ?? "")
    && /^[a-f0-9]{64}$/.test(input.operboxContentHmac ?? "")
    && Boolean(input.operboxHmacKeyVersion);
}

function planRunValues(input: PlanRunSummaryInput, allowSavedPlanBinding = true) {
  const createdAt = input.createdAt ?? new Date();
  const includeSavedPlanBinding = allowSavedPlanBinding && hasSavedPlanBinding(input);
  const artifactStatus = input.artifactStatus ?? (input.artifact ? "complete" : "none");
  return {
    diagnosticId: input.diagnosticId,
    userId: input.userId ?? null,
    dataOwnerTag: input.dataOwnerTag ?? null,
    sourceType: input.sourceType,
    status: input.status,
    layoutTemplate: input.layoutTemplate.slice(0, 120),
    roomCount: input.roomCount,
    operatorCount: input.operatorCount,
    rotation: input.rotation.slice(0, 80),
    fiammettaEnable: input.fiammettaEnable,
    durationMs: input.durationMs == null ? null : Math.max(0, Math.round(input.durationMs)),
    executionSource: input.executionSource ?? null,
    solverDurationMs: input.solverDurationMs == null ? null : Math.max(0, Math.round(input.solverDurationMs)),
    workerDurationMs: input.workerDurationMs == null ? null : Math.max(0, Math.round(input.workerDurationMs)),
    errorCode: input.errorCode ?? null,
    solverExecutableSha256: input.solver?.solver_executable_sha256 ?? null,
    protocolVersion: input.solver?.protocol_version ?? null,
    planSchemaVersion: input.solver?.plan_schema_version ?? null,
    artifactKey: input.artifact?.key ?? null,
    artifactBytes: input.artifact?.bytes ?? null,
    artifactSha256: input.artifact?.sha256 ?? null,
    artifactStatus,
    artifactFinalizedAt: input.artifactFinalizedAt ?? (artifactStatus === "complete" ? createdAt : null),
    calculationContext: includeSavedPlanBinding ? input.calculationContext ?? null : null,
    publicResultSha256: includeSavedPlanBinding ? input.publicResultSha256 ?? null : null,
    operboxContentHmac: includeSavedPlanBinding ? input.operboxContentHmac ?? null : null,
    operboxHmacKeyVersion: includeSavedPlanBinding ? input.operboxHmacKeyVersion ?? null : null,
    createdAt,
    expiresAt: expiresAt(createdAt),
  };
}

export async function recordPlanRunStrict(input: PlanRunSummaryInput): Promise<boolean> {
  const database = getDatabase();
  if (!hasSavedPlanBinding(input) || !input.userId) {
    const inserted = await database
      .insert(planRun)
      .values(planRunValues(input))
      .onConflictDoNothing({ target: planRun.diagnosticId })
      .returning({ diagnosticId: planRun.diagnosticId });
    return inserted.length > 0;
  }
  const userId = input.userId;

  return database.transaction(async (tx) => {
    // Consent revocation takes this same account lock. A solve that finishes after
    // revocation may retain its minimal run summary, but cannot recreate cloud data.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    const [consent] = await tx.select({ revokedAt: policyConsent.revokedAt })
      .from(policyConsent)
      .where(and(
        eq(policyConsent.userId, userId),
        eq(policyConsent.termsVersion, TERMS_VERSION),
        eq(policyConsent.privacyVersion, PRIVACY_VERSION),
      ))
      .limit(1);
    const inserted = await tx
      .insert(planRun)
      .values(planRunValues(input, Boolean(consent && !consent.revokedAt)))
      .onConflictDoNothing({ target: planRun.diagnosticId })
      .returning({ diagnosticId: planRun.diagnosticId });
    return inserted.length > 0;
  });
}

export async function recordPlanRunBestEffort(input: PlanRunSummaryInput): Promise<boolean> {
  if (!isBusinessDatabaseEnabled()) return false;
  try {
    await recordPlanRunStrict(input);
    return true;
  } catch {
    console.error(JSON.stringify({
      level: "error",
      event: "plan_run_database_write_failed",
      diagnosticId: input.diagnosticId,
    }));
    return false;
  }
}

export async function updatePlanRunExecutionBestEffort(input: {
  diagnosticId: string;
  executionSource: "cache" | "solver" | "failed";
  solverDurationMs?: number | null;
  workerDurationMs: number;
}): Promise<void> {
  if (!isBusinessDatabaseEnabled()) return;
  await getDatabase().update(planRun).set({
    executionSource: input.executionSource === "failed" ? null : input.executionSource,
    solverDurationMs: input.solverDurationMs == null ? null : Math.max(0, Math.round(input.solverDurationMs)),
    workerDurationMs: Math.max(0, Math.round(input.workerDurationMs)),
  }).where(eq(planRun.diagnosticId, input.diagnosticId)).catch(() => {
    console.error(JSON.stringify({ level: "error", event: "plan_run_timing_update_failed", diagnosticId: input.diagnosticId }));
  });
}

export async function updatePlanRunArtifactBestEffort(input: {
  diagnosticId: string;
  status: "complete" | "failed";
  artifact?: PrivateArtifactDescriptor | null;
  finalizedAt?: Date;
}): Promise<"updated" | "missing" | "unavailable"> {
  if (!isBusinessDatabaseEnabled()) return "updated";
  try {
    const updated = await getDatabase().update(planRun).set({
      artifactKey: input.artifact?.key ?? null,
      artifactBytes: input.artifact?.bytes ?? null,
      artifactSha256: input.artifact?.sha256 ?? null,
      artifactStatus: input.status,
      artifactFinalizedAt: input.status === "complete" ? input.finalizedAt ?? new Date() : null,
    }).where(eq(planRun.diagnosticId, input.diagnosticId))
      .returning({ diagnosticId: planRun.diagnosticId });
    return updated.length === 1 ? "updated" : "missing";
  } catch {
    console.error(JSON.stringify({ level: "error", event: "plan_run_artifact_update_failed", diagnosticId: input.diagnosticId }));
    return "unavailable";
  }
}

export type FeedbackSummaryInput = {
  feedbackId: string;
  savedAt: Date;
  body: FeedbackRequest;
  userId?: string | null;
  artifact?: PrivateArtifactDescriptor | null;
};

export async function recordFeedbackStrict(input: FeedbackSummaryInput): Promise<boolean> {
  const issue = toStoredFeedbackIssue(input.body);
  return getDatabase().transaction(async (tx) => {
    const linked = await tx
      .select({ diagnosticId: planRun.diagnosticId, userId: planRun.userId })
      .from(planRun)
      .where(eq(planRun.diagnosticId, input.body.diagnosticId))
      .limit(1);
    const inserted = await tx.insert(feedback).values({
      id: input.feedbackId,
      diagnosticId: input.body.diagnosticId,
      planRunDiagnosticId: linked[0]?.diagnosticId ?? null,
      userId: input.userId ?? linked[0]?.userId ?? null,
      kind: input.body.kind ?? "room_issue",
      room: "room" in issue ? issue.room : null,
      note: issue.note,
      consentAt: input.savedAt,
      status: "unreviewed",
      artifactKey: input.artifact?.key ?? null,
      artifactBytes: input.artifact?.bytes ?? null,
      artifactSha256: input.artifact?.sha256 ?? null,
      createdAt: input.savedAt,
      updatedAt: input.savedAt,
      expiresAt: expiresAt(input.savedAt),
    }).onConflictDoNothing({ target: feedback.id }).returning({ id: feedback.id });
    if (inserted.length === 0) return false;
    await tx.insert(feedbackEvent).values({
      id: randomUUID(),
      feedbackId: input.feedbackId,
      status: "unreviewed",
      note: null,
      createdAt: input.savedAt,
    });
    return true;
  });
}

export async function recordFeedbackIfEnabled(input: FeedbackSummaryInput): Promise<void> {
  if (!isBusinessDatabaseEnabled()) return;
  await recordFeedbackStrict(input);
}

export type BusinessRecordQuery = {
  search?: string;
  kind: "runs" | "feedback";
  limit?: number;
  offset?: number;
  from?: Date;
  to?: Date;
  status?: string;
  facility?: AdminFeedbackFacility;
  errorCode?: string;
  solverExecutableSha256?: string;
};

const ROOM_FEEDBACK_FACILITIES: Exclude<AdminFeedbackFacility, "solver" | "unknown">[] = [
  "trading",
  "manufacture",
  "power",
  "control",
  "dormitory",
  "meeting",
  "hire",
  "processing",
  "training",
];

export async function queryBusinessRecords(query: BusinessRecordQuery) {
  const requestedLimit = Number(query.limit ?? 50);
  const requestedOffset = Number(query.offset ?? 0);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.trunc(requestedLimit))) : 50;
  const offset = Number.isFinite(requestedOffset) ? Math.max(0, Math.trunc(requestedOffset)) : 0;
  if (query.kind === "runs") {
    const conditions: SQL[] = [];
    if (query.from) conditions.push(gte(planRun.createdAt, query.from));
    if (query.to) conditions.push(lte(planRun.createdAt, query.to));
    if (query.status) conditions.push(eq(planRun.status, query.status));
    if (query.errorCode) conditions.push(eq(planRun.errorCode, query.errorCode));
    if (query.solverExecutableSha256) conditions.push(eq(planRun.solverExecutableSha256, query.solverExecutableSha256));
    const where = conditions.length ? and(...conditions) : undefined;
    const [items, total] = await Promise.all([
      getDatabase().select({
        diagnosticId: planRun.diagnosticId,
        sourceType: planRun.sourceType,
        status: planRun.status,
        layoutTemplate: planRun.layoutTemplate,
        roomCount: planRun.roomCount,
        operatorCount: planRun.operatorCount,
        rotation: planRun.rotation,
        fiammettaEnable: planRun.fiammettaEnable,
        durationMs: planRun.durationMs,
        errorCode: planRun.errorCode,
        solverExecutableSha256: planRun.solverExecutableSha256,
        protocolVersion: planRun.protocolVersion,
        planSchemaVersion: planRun.planSchemaVersion,
        artifactKey: planRun.artifactKey,
        artifactBytes: planRun.artifactBytes,
        artifactSha256: planRun.artifactSha256,
        createdAt: planRun.createdAt,
        expiresAt: planRun.expiresAt,
      }).from(planRun).where(where).orderBy(desc(planRun.createdAt)).limit(limit).offset(offset),
      getDatabase().select({ count: sql<number>`count(*)::int` }).from(planRun).where(where),
    ]);
    return { items, total: total[0]?.count ?? 0, limit, offset };
  }

  const conditions: SQL[] = [];
  if (query.from) conditions.push(gte(feedback.createdAt, query.from));
  if (query.search?.trim()) {
    const terms = [query.search.trim(), ...feedbackOperators(null, query.search)];
    conditions.push(or(...terms.map((term) => {
      const search = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
      return sql`(concat_ws(' ', ${feedback.id}, ${feedback.diagnosticId}, ${feedback.note}, ${feedback.adminNote}, ${feedback.room} -> 'operators') ilike ${search}
        or exists (select 1 from ${feedbackEvent} where ${feedbackEvent.feedbackId} = ${feedback.id} and ${feedbackEvent.note} ilike ${search}))`;
    }))!);
  }
  if (query.errorCode) conditions.push(sql`exists (select 1 from ${planRun} where ${planRun.diagnosticId} = ${feedback.diagnosticId} and ${planRun.errorCode} = ${query.errorCode})`);
  if (query.solverExecutableSha256) conditions.push(sql`exists (select 1 from ${planRun} where ${planRun.diagnosticId} = ${feedback.diagnosticId} and ${planRun.solverExecutableSha256} = ${query.solverExecutableSha256})`);
  if (query.to) conditions.push(lte(feedback.createdAt, query.to));
  if (query.status) conditions.push(eq(feedback.status, query.status));
  if (query.facility === "solver") {
    conditions.push(eq(feedback.kind, "performance_issue"));
  } else if (query.facility) {
    conditions.push(eq(feedback.kind, "room_issue"));
    const group = sql<string>`${feedback.room} ->> 'group'`;
    if (query.facility === "unknown") {
      conditions.push(or(sql`${group} is null`, notInArray(group, ROOM_FEEDBACK_FACILITIES))!);
    } else {
      conditions.push(eq(group, query.facility));
    }
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const [items, total] = await Promise.all([
    getDatabase().select({
      id: feedback.id,
      diagnosticId: feedback.diagnosticId,
      planRunDiagnosticId: feedback.planRunDiagnosticId,
      kind: feedback.kind,
      room: feedback.room,
      note: feedback.note,
      consentAt: feedback.consentAt,
      status: feedback.status,
      adminNote: feedback.adminNote,
      artifactKey: feedback.artifactKey,
      artifactBytes: feedback.artifactBytes,
      artifactSha256: feedback.artifactSha256,
      createdAt: feedback.createdAt,
      updatedAt: feedback.updatedAt,
      expiresAt: feedback.expiresAt,
    }).from(feedback).where(where).orderBy(desc(feedback.createdAt), desc(feedback.id)).limit(limit).offset(offset),
    getDatabase().select({ count: sql<number>`count(*)::int` }).from(feedback).where(where),
  ]);
  return { items, total: total[0]?.count ?? 0, limit, offset };
}

export async function queryAdminSolverMetrics(now = new Date()) {
  const windowStartedAt = new Date(now.getTime() - ADMIN_SOLVER_ERROR_WINDOW_MINUTES * 60_000);
  const trendStartedAt = new Date(now.getTime() - ADMIN_SOLVER_TREND_WINDOW_MINUTES * 60_000);
  const trendBucketSeconds = ADMIN_SOLVER_TREND_BUCKET_MINUTES * 60;
  const database = getDatabase();
  const [solverRows, trendRows, taskRows, cacheRows] = await Promise.all([
    database.select({
      successCount: sql<number>`count(*) filter (where ${planRun.status} = 'success')::int`,
      failureCount: sql<number>`count(*) filter (where ${planRun.status} = 'failed')::int`,
      averageDurationMs: sql<number | null>`round(avg(${planRun.durationMs}) filter (where ${planRun.status} = 'success' and ${planRun.durationMs} is not null))::int`,
      p95DurationMs: sql<number | null>`round(percentile_cont(0.95) within group (order by ${planRun.durationMs}) filter (where ${planRun.status} = 'success' and ${planRun.durationMs} is not null))::int`,
      averageSolverDurationMs: sql<number | null>`round(avg(${planRun.solverDurationMs}) filter (where ${planRun.status} = 'success' and ${planRun.solverDurationMs} is not null))::int`,
      p95SolverDurationMs: sql<number | null>`round(percentile_cont(0.95) within group (order by ${planRun.solverDurationMs}) filter (where ${planRun.status} = 'success' and ${planRun.solverDurationMs} is not null))::int`,
      averageWorkerDurationMs: sql<number | null>`round(avg(${planRun.workerDurationMs}) filter (where ${planRun.status} = 'success' and ${planRun.workerDurationMs} is not null))::int`,
      cacheHitCount: sql<number>`count(*) filter (where ${planRun.executionSource} = 'cache')::int`,
      cacheMissCount: sql<number>`count(*) filter (where ${planRun.executionSource} = 'solver')::int`,
      maaCount: sql<number>`count(*) filter (where ${planRun.sourceType} = 'maa')::int`,
      sklandCount: sql<number>`count(*) filter (where ${planRun.sourceType} = 'skland')::int`,
      sampleCount: sql<number>`count(*) filter (where ${planRun.sourceType} = 'sample')::int`,
    }).from(planRun).where(and(
      gte(planRun.createdAt, windowStartedAt),
      lte(planRun.createdAt, now),
    )),
    buildAdminSolverTrendQuery(database, trendStartedAt, now, trendBucketSeconds),
    database.select({
      bufferedCount: sql<number>`count(*) filter (where ${planTask.status} = 'buffered')::int`,
      pendingCount: sql<number>`count(*) filter (where ${planTask.status} = 'pending')::int`,
      runningCount: sql<number>`count(*) filter (where ${planTask.status} = 'running')::int`,
      averageWaitMs: sql<number | null>`round(avg(extract(epoch from (${planTask.startedAt} - ${planTask.createdAt})) * 1000) filter (where ${planTask.startedAt} is not null and ${planTask.createdAt} >= ${windowStartedAt}))::int`,
      p95WaitMs: sql<number | null>`round(percentile_cont(0.95) within group (order by extract(epoch from (${planTask.startedAt} - ${planTask.createdAt})) * 1000) filter (where ${planTask.startedAt} is not null and ${planTask.createdAt} >= ${windowStartedAt}))::int`,
    }).from(planTask).where(or(
      inArray(planTask.status, ["buffered", "pending", "running"]),
      and(gte(planTask.createdAt, windowStartedAt), lte(planTask.createdAt, now)),
    )),
    database.select({
      readyEntryCount: sql<number>`count(*) filter (where ${planCache.publicResult} is not null)::int`,
      fillingEntryCount: sql<number>`count(*) filter (where ${planCache.publicResult} is null and ${planCache.leaseExpiresAt} > ${now})::int`,
    }).from(planCache).where(gt(planCache.expiresAt, now)),
  ]);

  return buildAdminSolverMetricsData({
    generatedAt: now,
    cacheEnabled: isPlanCacheEnabled(),
    successCount: solverRows[0]?.successCount ?? 0,
    failureCount: solverRows[0]?.failureCount ?? 0,
    averageDurationMs: solverRows[0]?.averageDurationMs ?? null,
    p95DurationMs: solverRows[0]?.p95DurationMs ?? null,
    averageSolverDurationMs: solverRows[0]?.averageSolverDurationMs ?? null,
    p95SolverDurationMs: solverRows[0]?.p95SolverDurationMs ?? null,
    averageWorkerDurationMs: solverRows[0]?.averageWorkerDurationMs ?? null,
    maaCount: solverRows[0]?.maaCount ?? 0,
    sklandCount: solverRows[0]?.sklandCount ?? 0,
    sampleCount: solverRows[0]?.sampleCount ?? 0,
    bufferedTaskCount: taskRows[0]?.bufferedCount ?? 0,
    pendingTaskCount: taskRows[0]?.pendingCount ?? 0,
    runningTaskCount: taskRows[0]?.runningCount ?? 0,
    averageWaitMs: taskRows[0]?.averageWaitMs ?? null,
    p95WaitMs: taskRows[0]?.p95WaitMs ?? null,
    trend: trendRows,
    cacheHitCount: solverRows[0]?.cacheHitCount ?? 0,
    cacheMissCount: solverRows[0]?.cacheMissCount ?? 0,
    readyCacheEntryCount: cacheRows[0]?.readyEntryCount ?? 0,
    fillingCacheEntryCount: cacheRows[0]?.fillingEntryCount ?? 0,
  });
}

type FeedbackReviewUpdate = {
  feedbackId: string;
  status: AdminFeedbackStatus;
  note: string;
  actorUserId?: string | null;
  expectedUpdatedAt?: string;
};

export async function updateFeedbackRecord(input: FeedbackReviewUpdate) {
  return (await updateFeedbackRecords([input]))[0] ?? null;
}

export async function updateFeedbackRecords(inputs: FeedbackReviewUpdate[]) {
  return getDatabase().transaction(async (tx) => {
    const results = [];
    // Stable lock ordering avoids deadlocks between overlapping batches.
    for (const input of [...inputs].sort((a, b) => a.feedbackId.localeCompare(b.feedbackId))) {
      const now = new Date();
      const note = input.note.trim().slice(0, 2000);
      const [current] = await tx.select({ updatedAt: feedback.updatedAt }).from(feedback)
        .where(eq(feedback.id, input.feedbackId)).for("update");
      if (!current) throw new PublicApiError("AIC-DATA-8004");
      if (!input.expectedUpdatedAt || current.updatedAt.toISOString() !== input.expectedUpdatedAt) {
        throw new PublicApiError("AIC-FEEDBACK-4003");
      }
      if (input.status === "ignored" && !note) throw new PublicApiError("AIC-FEEDBACK-4001");
      now.setTime(Math.max(now.getTime(), current.updatedAt.getTime() + 1));
      const updated = await tx.update(feedback).set({
        status: input.status,
        adminNote: note || null,
        updatedAt: now,
      }).where(eq(feedback.id, input.feedbackId)).returning({ id: feedback.id });
      if (!updated.length) throw new PublicApiError("AIC-DATA-8004");
      await tx.insert(feedbackEvent).values({
        id: randomUUID(),
        feedbackId: input.feedbackId,
        actorUserId: input.actorUserId ?? null,
        status: input.status,
        note: note || null,
        createdAt: now,
      });
      results.push({ id: input.feedbackId, status: input.status, note, updatedAt: now.toISOString() });
    }
    return results;
  });
}

export async function feedbackHistory(feedbackId: string) {
  return getDatabase().select({
    id: feedbackEvent.id, actorUserId: feedbackEvent.actorUserId,
    status: feedbackEvent.status, note: feedbackEvent.note, createdAt: feedbackEvent.createdAt,
  }).from(feedbackEvent).where(eq(feedbackEvent.feedbackId, feedbackId))
    .orderBy(desc(feedbackEvent.createdAt), desc(feedbackEvent.id));
}

export async function findFeedbackRecord(feedbackId: string) {
  const [item] = await getDatabase().select({
    id: feedback.id,
    diagnosticId: feedback.diagnosticId,
    planRunDiagnosticId: feedback.planRunDiagnosticId,
    kind: feedback.kind,
    room: feedback.room,
    note: feedback.note,
    status: feedback.status,
    adminNote: feedback.adminNote,
    createdAt: feedback.createdAt,
    updatedAt: feedback.updatedAt,
    expiresAt: feedback.expiresAt,
  }).from(feedback).where(eq(feedback.id, feedbackId)).limit(1);
  return item ?? null;
}

export async function findPlanRunRecord(diagnosticId: string) {
  const [item] = await getDatabase().select({
    diagnosticId: planRun.diagnosticId,
    sourceType: planRun.sourceType,
    status: planRun.status,
    layoutTemplate: planRun.layoutTemplate,
    roomCount: planRun.roomCount,
    operatorCount: planRun.operatorCount,
    rotation: planRun.rotation,
    fiammettaEnable: planRun.fiammettaEnable,
    durationMs: planRun.durationMs,
    errorCode: planRun.errorCode,
    solverExecutableSha256: planRun.solverExecutableSha256,
    protocolVersion: planRun.protocolVersion,
    planSchemaVersion: planRun.planSchemaVersion,
    artifactKey: planRun.artifactKey,
    artifactStatus: planRun.artifactStatus,
    executionSource: planRun.executionSource,
    createdAt: planRun.createdAt,
    expiresAt: planRun.expiresAt,
  }).from(planRun).where(eq(planRun.diagnosticId, diagnosticId)).limit(1);
  return item ?? null;
}

export async function accountPrivateArtifactReferences(userId: string): Promise<{
  diagnosticIds: string[];
  feedbackIds: string[];
}> {
  const runs = await getDatabase().select({ diagnosticId: planRun.diagnosticId })
    .from(planRun)
    .where(eq(planRun.userId, userId));
  const diagnosticIds = runs.map((item) => item.diagnosticId);
  const feedbackCondition = diagnosticIds.length
    ? or(eq(feedback.userId, userId), inArray(feedback.planRunDiagnosticId, diagnosticIds))
    : eq(feedback.userId, userId);
  const feedbackItems = await getDatabase().select({ id: feedback.id })
    .from(feedback)
    .where(feedbackCondition);
  return {
    diagnosticIds,
    feedbackIds: feedbackItems.map((item) => item.id),
  };
}

export async function deleteFeedbackRecords(feedbackIds: string[]): Promise<string[]> {
  if (!feedbackIds.length) return [];
  const deleted = await getDatabase().delete(feedback)
    .where(inArray(feedback.id, feedbackIds))
    .returning({ id: feedback.id });
  const deletedSet = new Set(deleted.map((item) => item.id));
  return feedbackIds.filter((id) => deletedSet.has(id));
}

export async function deleteExpiredBusinessRecords(now = new Date()): Promise<void> {
  if (!isBusinessDatabaseEnabled()) return;
  const workspaceCutoff = new Date(now.getTime() - BUSINESS_DATA_TTL_MS);
  await getDatabase().transaction(async (tx) => {
    await tx.delete(feedback).where(lt(feedback.expiresAt, now));
    await tx.delete(planRun).where(lt(planRun.expiresAt, now));
    await tx.delete(planCache).where(lt(planCache.expiresAt, now));
    await tx.delete(workspaceRevision).where(lt(workspaceRevision.expiresAt, now));
    await tx.delete(userWorkspace).where(lt(userWorkspace.syncedAt, workspaceCutoff));
    await tx.delete(savedPlan).where(and(
      eq(savedPlan.pinned, false),
      lt(savedPlan.expiresAt, now),
    ));
    await tx.delete(operboxSnapshot).where(lt(operboxSnapshot.expiresAt, now));
  });
  // Separate transactions bound lock duration and avoid making other retention
  // work wait for the full telemetry backlog. The cutoff is fixed for this run.
  for (;;) {
    const deleted = await getDatabase().execute(sql`
      DELETE FROM ${telemetryEvent}
      WHERE ${telemetryEvent.id} IN (
        SELECT ${telemetryEvent.id} FROM ${telemetryEvent}
        WHERE ${telemetryEvent.expiresAt} < ${now}
        ORDER BY ${telemetryEvent.expiresAt}, ${telemetryEvent.id}
        LIMIT 1000
        FOR UPDATE SKIP LOCKED
      )
      RETURNING ${telemetryEvent.id}
    `);
    if (deleted.rows.length < 1000) break;
  }
}
