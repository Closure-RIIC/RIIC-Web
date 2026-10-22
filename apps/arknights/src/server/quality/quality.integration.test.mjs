import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import process from "node:process";
import test from "node:test";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";

if (!process.env.AUTH_INTEGRATION_DATABASE_URL || !["/riic_quality_test", "/arknights_auth_test"].includes(new URL(process.env.AUTH_INTEGRATION_DATABASE_URL).pathname)) throw new Error("An explicitly isolated quality or CI database is required");
process.env.DATABASE_URL = process.env.AUTH_INTEGRATION_DATABASE_URL;
const root = await mkdtemp(path.join(tmpdir(), "riic-quality-test-"));
process.env.ADMIN_QUALITY_STORAGE_DIR = root;
const { getDatabase, getDatabasePool } = await import("@riic/platform-server/db");
const schema = await import("@riic/platform-server/db/schema");
const service = await import("./service.ts");
const { runQualityWorker } = await import("./worker.ts");
const { writeArtifact } = await import("./storage.ts");
const id = randomUUID();
const versions = [id + "a", id + "b"];
const db = getDatabase();
const createdBatches = [];
const createdFeedback = [];
await db.insert(schema.user).values({ id, name: "Quality test reviewer", email: `${id}@example.invalid`, emailVerified: true, role: "reviewer" });
await db.insert(schema.qualityBundle).values(versions.map((id) => ({ id, label: "TEST ONLY", executableSha256: "0".repeat(64) })));
const input = { operbox: [{ id: "test", name: "测试", own: true, elite: 2, level: 90, rarity: 6, potential: 6 }], layout: { template: "243", drone_cap: 235, scenario: {}, rooms: [{ id: "control", kind: "control_center", level: 5 }, { id: "power", kind: "power_plant", level: 3 }] }, rotation: "abc_12_6_6", fiammetta_enable: false };
// Keep 500 distinct inputs within the real drone and operator-level bounds.
const draft = (number = 0) => service.createDraft({
  ...input,
  layout: { ...input.layout, drone_cap: number % 236 },
  operbox: input.operbox.map((operator) => ({ ...operator, level: 90 - Math.floor(number / 236) })),
}, id, [{ name: `generated-${number}` }]);
async function mockExecute(batchId, caseId, attemptId, bundles) {
  assert.deepEqual(bundles, versions);
  await writeArtifact(["batches", batchId, caseId, attemptId, "result.json"], { synthetic: true, bundles });
  return { status: "completed", summary: { synthetic: true } };
}
test.after(async () => {
  if (createdBatches.length) await db.delete(schema.qualityBatch).where(inArray(schema.qualityBatch.id, createdBatches));
  await db.delete(schema.qualityDraft).where(eq(schema.qualityDraft.creatorId, id));
  await db.delete(schema.qualityBundle).where(inArray(schema.qualityBundle.id, versions));
  if (createdFeedback.length) await db.delete(schema.feedback).where(inArray(schema.feedback.id, createdFeedback));
  await db.delete(schema.user).where(eq(schema.user.id, id));
  await getDatabasePool().end();
  assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
  assert.ok(path.basename(root).startsWith("riic-quality-test-"));
  await rm(root, { recursive: true, force: true });
});

test("import preview requires explicit invalid exclusions and preserves uploaded source names", async () => {
  const { stageImport, acceptImport } = await import("./import-preview.ts");
  const { previewImports } = await import("./import.ts");
  const preview = await stageImport(previewImports([{ name: "valid.json", data: Buffer.from(JSON.stringify(input)) }, { name: "invalid.json", data: Buffer.from("{") }]), id);
  await assert.rejects(acceptImport(preview.token, [], id), { code: "AIC-REQ-1001" });
  await assert.rejects(acceptImport(preview.token, ["1"], "other-reviewer"), { code: "AIC-DATA-8004" });
  const [created] = await acceptImport(preview.token, ["1"], id);
  assert.equal((await service.readDraft(created.id)).sources[0].name, "valid.json");
  await assert.rejects(acceptImport(preview.token, ["1"], id), { code: "AIC-DATA-8004" });
});

test("human links preserve status and history, reject chains and stale edits, and split cleanly", async () => {
  const { relatedFeedback, linkFeedback } = await import("./related.ts");
  const diagnosticId = randomUUID();
  const entries = await db.insert(schema.feedback).values(Array.from({ length: 3 }, () => ({ id: randomUUID(), diagnosticId, kind: "room", note: "阿米娅 synthetic", room: { kind: "manufacture", operators: ["阿米娅"] }, consentAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }))).returning();
  createdFeedback.push(...entries.map((row) => row.id));
  const [child, parent, third] = entries;
  assert.ok((await relatedFeedback(child.id)).matches.some((match) => match.feedback.id === parent.id && match.rank === 0));
  await linkFeedback(child.id, parent.id, id, child.updatedAt.toISOString());
  await assert.rejects(linkFeedback(child.id, null, id, child.updatedAt.toISOString()), { code: "AIC-FEEDBACK-4003" });
  await assert.rejects(linkFeedback(parent.id, third.id, id, parent.updatedAt.toISOString()), { code: "AIC-REQ-1001" });
  const [updated] = await db.select().from(schema.feedback).where(eq(schema.feedback.id, child.id));
  assert.equal(updated.status, "unreviewed");
  await linkFeedback(child.id, null, id, updated.updatedAt.toISOString());
  assert.equal((await relatedFeedback(child.id)).links.length, 0);
  assert.equal((await db.select().from(schema.feedbackEvent).where(eq(schema.feedbackEvent.feedbackId, child.id))).length, 2);
});
test("independent immutable drafts, full-input deduplication, expiry and batch limits", async () => {
  const one = await draft(0), two = await draft(0);
  const batch = await service.createBatch([one.id, two.id], versions, "dedup", id); createdBatches.push(batch.id);
  assert.equal(batch.cases.length, 1); assert.equal(batch.cases[0].sources.length, 2);
  await service.editDraft(one.id, 1, { ...input, fiammetta_enable: true });
  assert.equal((await service.readDraft(one.id)).original.fiammetta_enable, false);
  assert.equal((await service.readBatch(batch.id)).cases[0].inputHash, batch.cases[0].inputHash);
  await assert.rejects(service.editDraft(one.id, 1, input), { code: "AIC-FEEDBACK-4003" });
  await assert.rejects(service.createBatch(Array(501).fill(one.id), versions, "over limit", id));
  await service.cancelBatch(batch.id);
  await db.update(schema.qualityDraft).set({ expiresAt: new Date(0) }).where(eq(schema.qualityDraft.id, two.id));
  await assert.rejects(service.readDraft(two.id), { code: "AIC-DATA-8004" });
  await service.cleanupQuality();
  await assert.rejects(access(path.join(root, "drafts", two.id)));
});
for (const count of [50, 500]) test(`${count} generated cases finish sequentially using the pinned version pair`, async () => {
  const drafts = [];
  for (let offset = 0; offset < count; offset += 10) drafts.push(...await Promise.all(Array.from({ length: Math.min(10, count - offset) }, (_, index) => draft(offset + index))));
  const batch = await service.createBatch(drafts.map((draft) => draft.id), versions, `${count} synthetic cases`, id); createdBatches.push(batch.id);
  assert.equal(batch.cases.length, count);
  await runQualityWorker({ once: true, execute: mockExecute });
  const completed = await service.readBatch(batch.id);
  assert.equal(completed.status, "completed");
  assert.ok(completed.cases.every((item) => item.attempts.length === 1 && item.status === "completed"));
});
test("failed retries preserve attempts, cancellation prevents later cases, restart retains interrupted attempts", async () => {
  const inputs = await Promise.all([draft(501), draft(502)]);
  const batch = await service.createBatch(inputs.map((draft) => draft.id), versions, "retry", id); createdBatches.push(batch.id);
  let executions = 0;
  await runQualityWorker({ once: true, execute: async (...args) => { if (++executions === 1) throw new Error("Synthetic solver failure"); return mockExecute(...args); } });
  assert.equal((await service.readBatch(batch.id)).status, "failed");
  await service.retryFailed(batch.id);
  await runQualityWorker({ once: true, execute: mockExecute });
  assert.deepEqual((await service.readBatch(batch.id)).cases.map((item) => item.attempts.length).sort(), [1, 2]);
  const interrupted = await service.createBatch(inputs.map((draft) => draft.id), versions, "restart", id); createdBatches.push(interrupted.id);
  const item = interrupted.cases[0];
  await db.update(schema.qualityBatch).set({ status: "running" }).where(eq(schema.qualityBatch.id, interrupted.id));
  await db.update(schema.qualityCase).set({ status: "running" }).where(eq(schema.qualityCase.id, item.id));
  await db.insert(schema.qualityAttempt).values({ id: randomUUID(), caseId: item.id, status: "running" });
  await runQualityWorker({ once: true, execute: async (...args) => { await service.cancelBatch(interrupted.id); return mockExecute(...args); } });
  const cancelled = await service.readBatch(interrupted.id);
  assert.equal(cancelled.status, "cancelled");
  assert.ok(cancelled.cases.some((entry) => entry.attempts.some((attempt) => attempt.status === "interrupted")));
  assert.equal(cancelled.cases.flatMap((entry) => entry.attempts).length, 2);
});
