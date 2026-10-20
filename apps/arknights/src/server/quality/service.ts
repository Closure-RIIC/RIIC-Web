import { randomUUID } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { and, eq, gt, inArray, desc, lte } from "drizzle-orm";
import { getDatabase } from "../db/index.ts";
import { feedback, qualityDraft, qualityBatch, qualityCase, qualityAttempt, qualityBundle } from "../db/schema.ts";
import { PublicApiError } from "../api-contract.ts";
import { parseReproductionPackage, reproductionInputKey, type ReproductionPackage } from "../../reproduction-package.ts";
import { QUALITY_CASE_LIMIT, QUALITY_TOTAL_LIMIT, type QualitySource } from "../../quality.ts";
import { hash, readArtifact, writeArtifact, removeArtifacts, qualityPath, ensurePrivateDirectory } from "./storage.ts";

const ttl = 30 * 24 * 60 * 60_000;
function parseInput(input: unknown) {
  if (Buffer.byteLength(JSON.stringify(input) ?? "") > 2 * 1024 * 1024) throw new PublicApiError("AIC-REQ-1002");
  try { return parseReproductionPackage(input); }
  catch (error) { throw new PublicApiError("AIC-REQ-1001", { message: error instanceof Error ? error.message : "Invalid reproduction" }); }
}
const missing = () => new PublicApiError("AIC-DATA-8004");
export async function assertSources(sources: QualitySource[], expiresAt: Date) {
  if (expiresAt.getTime() <= Date.now()) throw missing();
  const ids = [...new Set(sources.flatMap((source) => source.feedbackId ? [source.feedbackId] : []))];
  if (!ids.length) return;
  const rows = await getDatabase().select({ id: feedback.id, expiresAt: feedback.expiresAt }).from(feedback).where(inArray(feedback.id, ids));
  if (rows.length !== ids.length || rows.some((row) => row.expiresAt.getTime() < expiresAt.getTime() || row.expiresAt.getTime() <= Date.now())) throw missing();
}
export async function createDraft(input: unknown, actorId: string, sources: QualitySource[], expiry = new Date(Date.now() + ttl)) {
  const parsed = parseInput(input);
  const expiresAt = new Date(Math.min(expiry.getTime(), Date.now() + ttl));
  await assertSources(sources, expiresAt);
  const id = randomUUID();
  await writeArtifact(["drafts", id, "retention.json"], { expiresAt: expiresAt.toISOString() });
  await writeArtifact(["drafts", id, "original.json"], parsed);
  await writeArtifact(["drafts", id, `1-${hash(reproductionInputKey(parsed))}.json`], parsed);
  try {
    await getDatabase().insert(qualityDraft).values({ id, creatorId: actorId, sources, expiresAt, inputHash: hash(reproductionInputKey(parsed)) });
  } catch (error) { await removeArtifacts("drafts", id); throw error; }
  return readDraft(id);
}
export async function readDraft(id: string) {
  const [row] = await getDatabase().select().from(qualityDraft).where(eq(qualityDraft.id, id));
  if (!row) throw missing();
  await assertSources(row.sources, row.expiresAt);
  return { ...row, original: await readArtifact<ReproductionPackage>("drafts", id, "original.json"), input: await readArtifact<ReproductionPackage>("drafts", id, `${row.revision}-${row.inputHash}.json`) };
}
export async function editDraft(id: string, revision: number, input: unknown) {
  const parsed = parseInput(input);
  await getDatabase().transaction(async (tx) => {
    const [row] = await tx.select().from(qualityDraft).where(eq(qualityDraft.id, id)).for("update");
    if (!row) throw missing();
    await assertSources(row.sources, row.expiresAt);
    if (row.revision !== revision) throw new PublicApiError("AIC-FEEDBACK-4003");
    // Immutable revisions prevent a submitted batch from observing later edits.
    const next = revision + 1;
    const inputHash = hash(reproductionInputKey(parsed));
    const key = ["drafts", id, `${next}-${inputHash}.json`];
    try { await writeArtifact(key, parsed); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || hash(reproductionInputKey(await readArtifact<ReproductionPackage>(...key))) !== inputHash) throw error;
    }
    await tx.update(qualityDraft).set({ revision: next, inputHash }).where(eq(qualityDraft.id, id));
  });
  return readDraft(id);
}
export async function listVersions() {
  return getDatabase().select().from(qualityBundle).orderBy(desc(qualityBundle.createdAt), desc(qualityBundle.id));
}
export async function listDrafts() {
  return getDatabase().select().from(qualityDraft).where(gt(qualityDraft.expiresAt, new Date())).orderBy(desc(qualityDraft.createdAt)).limit(500);
}
export async function createBatch(ids: string[], bundleIds: string[], label: string, actorId: string) {
  if (!ids.length || ids.length > QUALITY_CASE_LIMIT || !bundleIds.length || bundleIds.length > 2 || new Set(bundleIds).size !== bundleIds.length) throw new PublicApiError("AIC-REQ-1001");
  const versions = await listVersions();
  if (bundleIds.some((id) => !versions.some((version) => version.id === id))) throw missing();
  const drafts = await Promise.all([...new Set(ids)].map(readDraft));
  if (drafts.reduce((size, draft) => size + Buffer.byteLength(JSON.stringify(draft.input)), 0) > QUALITY_TOTAL_LIMIT) throw new PublicApiError("AIC-REQ-1002");
  const expiresAt = new Date(Math.min(...drafts.map((draft) => draft.expiresAt.getTime())));
  const batchId = randomUUID();
  await writeArtifact(["batches", batchId, "retention.json"], { expiresAt: expiresAt.toISOString() });
  const unique = new Map<string, { input: ReproductionPackage; sources: QualitySource[] }>();
  for (const draft of drafts) {
    const key = hash(reproductionInputKey(draft.input));
    const current = unique.get(key);
    if (current) current.sources.push(...draft.sources); else unique.set(key, { input: draft.input, sources: [...draft.sources] });
  }
  const cases: typeof qualityCase.$inferInsert[] = [];
  for (const [inputHash, item] of unique) {
    const id = randomUUID();
    await writeArtifact(["batches", batchId, id, "input.json"], item.input);
    cases.push({ id, batchId, inputHash, sources: item.sources });
  }
  try {
    await getDatabase().transaction(async (tx) => {
      await tx.insert(qualityBatch).values({ id: batchId, creatorId: actorId, label: label.slice(0, 120), bundleIds, expiresAt });
      await tx.insert(qualityCase).values(cases);
    });
  } catch (error) { await removeArtifacts("batches", batchId); throw error; }
  return readBatch(batchId);
}
export async function readBatch(id: string) {
  const [batch] = await getDatabase().select().from(qualityBatch).where(and(eq(qualityBatch.id, id), gt(qualityBatch.expiresAt, new Date())));
  if (!batch) throw missing();
  const cases = await getDatabase().select().from(qualityCase).where(eq(qualityCase.batchId, id)).orderBy(qualityCase.id);
  await assertSources(cases.flatMap((item) => item.sources), batch.expiresAt);
  const attempts = cases.length ? await getDatabase().select().from(qualityAttempt).where(inArray(qualityAttempt.caseId, cases.map((item) => item.id))).orderBy(desc(qualityAttempt.startedAt)) : [];
  return { ...batch, cases: cases.map((item) => ({ ...item, attempts: attempts.filter((attempt) => attempt.caseId === item.id) })) };
}
export async function listBatches() {
  const rows = await getDatabase().select().from(qualityBatch).where(gt(qualityBatch.expiresAt, new Date())).orderBy(desc(qualityBatch.createdAt)).limit(50);
  return rows;
}
export async function cancelBatch(id: string) {
  await readBatch(id);
  await getDatabase().update(qualityBatch).set({ status: "cancelled" }).where(and(eq(qualityBatch.id, id), inArray(qualityBatch.status, ["queued", "running"])));
  await getDatabase().update(qualityCase).set({ status: "cancelled" }).where(and(eq(qualityCase.batchId, id), eq(qualityCase.status, "queued")));
}
export async function retryFailed(id: string) {
  await readBatch(id);
  await getDatabase().transaction(async (tx) => {
    const [batch] = await tx.select().from(qualityBatch).where(eq(qualityBatch.id, id)).for("update");
    if (!batch || !["completed", "failed"].includes(batch.status)) throw new PublicApiError("AIC-REQ-1001");
    const updated = await tx.update(qualityCase).set({ status: "queued" }).where(and(eq(qualityCase.batchId, id), eq(qualityCase.status, "failed"))).returning();
    if (!updated.length) throw new PublicApiError("AIC-REQ-1001");
    await tx.update(qualityBatch).set({ status: "queued" }).where(eq(qualityBatch.id, id));
  });
}
export async function readAttempt(batchId: string, attemptId: string) {
  const batch = await readBatch(batchId);
  const item = batch.cases.find((entry) => entry.attempts.some((attempt) => attempt.id === attemptId && attempt.status !== "running"));
  if (!item) throw missing();
  return readArtifact<Record<string, unknown>>("batches", batchId, item.id, attemptId, "result.json");
}
export async function cleanupQuality() {
  const db = getDatabase();
  for (const row of await db.select().from(qualityDraft)) {
    let expired = row.expiresAt.getTime() <= Date.now();
    try { await assertSources(row.sources, row.expiresAt); } catch (error) { if (error instanceof PublicApiError && error.code === "AIC-DATA-8004") expired = true; else throw error; }
    if (expired) { await removeArtifacts("drafts", row.id); await db.delete(qualityDraft).where(eq(qualityDraft.id, row.id)); }
  }
  for (const batch of await db.select().from(qualityBatch)) {
    const cases = await db.select().from(qualityCase).where(eq(qualityCase.batchId, batch.id));
    let expired = batch.expiresAt.getTime() <= Date.now();
    try { await assertSources(cases.flatMap((item) => item.sources), batch.expiresAt); } catch (error) { if (error instanceof PublicApiError && error.code === "AIC-DATA-8004") expired = true; else throw error; }
    if (expired) { await removeArtifacts("batches", batch.id); await db.delete(qualityBatch).where(eq(qualityBatch.id, batch.id)); }
  }
  const { feedbackLink } = await import("../db/schema.ts");
  await db.delete(feedbackLink).where(lte(feedbackLink.expiresAt, new Date()));
  await ensurePrivateDirectory("imports");
  for (const id of await readdir(qualityPath("imports"))) {
    if (!/^[0-9a-f-]{36}$/.test(id)) continue;
    const retention = await readArtifact<{ expiresAt: string }>("imports", id, "retention.json").catch(() => null);
    if (retention && Date.parse(retention.expiresAt) <= Date.now()) await removeArtifacts("imports", id);
  }
  // Recover files left behind by a process failure before metadata was committed.
  for (const kind of ["drafts", "batches"] as const) {
    await ensurePrivateDirectory(kind);
    const table = kind === "drafts" ? qualityDraft : qualityBatch;
    const known = new Set((await db.select({ id: table.id }).from(table)).map((row) => row.id));
    for (const id of await readdir(qualityPath(kind))) {
      if (!/^[0-9a-f-]{36}$/.test(id) || known.has(id)) continue;
      const info = await stat(qualityPath(kind, id));
      const retention = await readArtifact<{ expiresAt: string }>(kind, id, "retention.json").catch(() => null);
      if ((retention && Date.parse(retention.expiresAt) <= Date.now()) || Date.now() - info.mtimeMs > 60 * 60_000) await removeArtifacts(kind, id);
    }
  }
}
