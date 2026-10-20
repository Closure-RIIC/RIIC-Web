import { randomUUID } from "node:crypto";
import { and, eq, inArray, asc } from "drizzle-orm";
import { getDatabase, getDatabasePool } from "../db/index.ts";
import { qualityBatch, qualityCase, qualityAttempt } from "../db/schema.ts";
import { createPlanComputeParams, parsePlanComputePayload } from "../plan-protocol.ts";
import { parseReproductionPackage } from "../../reproduction-package.ts";
import { QUALITY_TIMEOUT_MS } from "../../quality.ts";
import { extractSummaryV1, extractMaaRoomOperators, describeSummaryDelta } from "./core/summary.ts";
import { verifyBundle, bundleClient, stopBundleClient, processBundleSync } from "./bundles.ts";
import { readArtifact, writeArtifact, writeHeartbeat } from "./storage.ts";
import { cleanupQuality, readBatch } from "./service.ts";
import { boundedExecution } from "./execution.ts";

type VersionResult = { bundleId: string; ok: boolean; valid: boolean; elapsedMs: number; summary: ReturnType<typeof extractSummaryV1> | null; schedule: Record<string, string[]>[]; response?: unknown; error?: string };
export function compareVersions(results: VersionResult[]) {
  if (results.length !== 2) return null;
  const [baseline, candidate] = results;
  return {
    baselineOk: baseline.ok, candidateOk: candidate.ok, baselineValid: baseline.valid, candidateValid: candidate.valid,
    dailyDelta: describeSummaryDelta(baseline.summary, candidate.summary),
    scheduleChanged: JSON.stringify(baseline.schedule) !== JSON.stringify(candidate.schedule),
    elapsedDeltaMs: candidate.elapsedMs - baseline.elapsedMs,
    timingIsInformational: true,
  };
}
let stopping = false;
export function stopQualityWorker() { stopping = true; }

async function execute(batchId: string, caseId: string, attemptId: string, bundleIds: string[]) {
  const input = parseReproductionPackage(await readArtifact("batches", batchId, caseId, "input.json"));
  const results: VersionResult[] = [];
  const caseDeadline = performance.now() + QUALITY_TIMEOUT_MS;
  for (const bundleId of bundleIds) {
    if (stopping || (await readBatch(batchId)).status === "cancelled") throw new Error("cancelled");
    if (performance.now() >= caseDeadline) {
      results.push({ bundleId, ok: false, valid: false, elapsedMs: 0, summary: null, schedule: [], error: "Case deadline exhausted before this version" });
      continue;
    }
    const manifest = await verifyBundle(bundleId);
    const client = bundleClient(bundleId, manifest.embeddedData);
    const started = performance.now();
    try {
      const { response } = await boundedExecution(() => client.send("plan.compute", createPlanComputeParams({ layout: input.layout, operbox: input.operbox, rotation: input.rotation, fiammettaEnable: input.fiammetta_enable, sourceName: "Quality reproduction" })), () => stopBundleClient(client), { timeoutMs: caseDeadline - performance.now(), cancelled: async () => stopping || (await readBatch(batchId)).status === "cancelled" });
      const payload = parsePlanComputePayload(response);
      results.push({ bundleId, ok: response.ok === true, valid: !!payload, elapsedMs: performance.now() - started,
        summary: payload ? extractSummaryV1(payload) : null,
        schedule: payload ? payload.rotation.shifts.map((_, index) => extractMaaRoomOperators(payload.maa, index)) : [], response });
    } catch (error) {
      results.push({ bundleId, ok: false, valid: false, elapsedMs: performance.now() - started, summary: null, schedule: [], error: error instanceof Error ? error.message : "Execution failed" });
    }
  }
  const comparison = compareVersions(results);
  const status = results.every((result) => result.ok && result.valid) ? "completed" : "failed";
  await readBatch(batchId); // Never recreate expired files removed by the retention sweep.
  await writeArtifact(["batches", batchId, caseId, attemptId, "result.json"], { input, results, comparison });
  return { status, summary: { results: results.map((result) => ({ bundleId: result.bundleId, ok: result.ok, valid: result.valid, elapsedMs: result.elapsedMs, summary: result.summary, error: result.error })), comparison } };
}

export async function runQualityWorker(options: { once?: boolean; execute?: typeof execute } = {}) {
  stopping = false;
  const lock = await getDatabasePool().connect();
  const acquired = await lock.query("select pg_try_advisory_lock(914731026) as acquired");
  if (!acquired.rows[0]?.acquired) { lock.release(); throw new Error("A private quality worker already owns the queue"); }
  lock.on("error", () => { stopping = true; });
  const db = getDatabase();
  let syncError: string | null = null;
  let cleanupTask: Promise<void> | null = null;
  const cleanup = () => cleanupTask ??= cleanupQuality().finally(() => { cleanupTask = null; });
  const retention = setInterval(() => { void cleanup().catch(() => { stopping = true; }); }, 60_000);
  const heartbeat = setInterval(() => { void writeHeartbeat({ at: new Date().toISOString(), releaseSha: process.env.APP_RELEASE_SHA ?? null, concurrency: 1, syncError }).catch(() => { stopping = true; }); }, 3000);
  try {
    // Preserve interrupted attempts; a recovered case receives a new immutable attempt.
    await db.update(qualityAttempt).set({ status: "interrupted", finishedAt: new Date() }).where(eq(qualityAttempt.status, "running"));
    await db.update(qualityCase).set({ status: "queued" }).where(eq(qualityCase.status, "running"));
    const cancelled = await db.select({ id: qualityBatch.id }).from(qualityBatch).where(eq(qualityBatch.status, "cancelled"));
    if (cancelled.length) await db.update(qualityCase).set({ status: "cancelled" }).where(and(inArray(qualityCase.batchId, cancelled.map((row) => row.id)), eq(qualityCase.status, "queued")));
    await db.update(qualityBatch).set({ status: "queued" }).where(eq(qualityBatch.status, "running"));
    let lastCleanup = 0;
    while (!stopping) {
      if (Date.now() - lastCleanup > 60_000) { await cleanup(); lastCleanup = Date.now(); }
      const synced = await processBundleSync();
      if (synced !== undefined) syncError = synced;
      const [batch] = await db.select().from(qualityBatch).where(eq(qualityBatch.status, "queued")).orderBy(asc(qualityBatch.createdAt)).limit(1);
      if (!batch) { if (options.once) break; await new Promise((resolve) => setTimeout(resolve, 1000)); continue; }
      await readBatch(batch.id);
      await db.update(qualityBatch).set({ status: "running" }).where(and(eq(qualityBatch.id, batch.id), eq(qualityBatch.status, "queued")));
      const cases = await db.select().from(qualityCase).where(and(eq(qualityCase.batchId, batch.id), eq(qualityCase.status, "queued"))).orderBy(qualityCase.id);
      for (const item of cases) {
        if (stopping || (await readBatch(batch.id)).status === "cancelled") break;
        const attemptId = randomUUID();
        const claimed = await db.transaction(async (tx) => {
          const [current] = await tx.select().from(qualityBatch).where(eq(qualityBatch.id, batch.id)).for("update");
          if (!current || current.status !== "running") return false;
          await tx.insert(qualityAttempt).values({ id: attemptId, caseId: item.id, status: "running" });
          await tx.update(qualityCase).set({ status: "running" }).where(eq(qualityCase.id, item.id));
          return true;
        });
        if (!claimed) break;
        let outcome: { status: string; summary: unknown };
        try { outcome = await (options.execute ?? execute)(batch.id, item.id, attemptId, batch.bundleIds); }
        catch (error) {
          outcome = { status: "failed", summary: { error: error instanceof Error ? error.message : "Execution failed" } };
          if (await readBatch(batch.id).catch(() => null)) await writeArtifact(["batches", batch.id, item.id, attemptId, "result.json"], outcome);
        }
        const current = await readBatch(batch.id).catch(() => null);
        if (!current || current.status === "cancelled") outcome.status = "cancelled";
        else if (stopping) outcome.status = "interrupted";
        await db.transaction(async (tx) => {
          await tx.update(qualityAttempt).set({ ...outcome, finishedAt: new Date() }).where(eq(qualityAttempt.id, attemptId));
          await tx.update(qualityCase).set({ status: outcome.status === "interrupted" ? "queued" : outcome.status }).where(eq(qualityCase.id, item.id));
        });
      }
      const remaining = await db.select().from(qualityCase).where(eq(qualityCase.batchId, batch.id));
      const status = stopping ? "queued" : remaining.some((item) => item.status === "failed") ? "failed" : "completed";
      await db.update(qualityBatch).set({ status }).where(and(eq(qualityBatch.id, batch.id), inArray(qualityBatch.status, ["running"])));
      if (options.once) break;
    }
  } finally { clearInterval(heartbeat); clearInterval(retention); await cleanupTask; await lock.query("select pg_advisory_unlock(914731026)").catch(() => undefined); lock.release(); }
}
