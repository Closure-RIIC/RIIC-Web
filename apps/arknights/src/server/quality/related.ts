import { and, eq, gt, inArray, or, sql } from "drizzle-orm";
import { getDatabase } from "../db/index.ts";
import { feedback, feedbackLink, feedbackEvent, planRun } from "../db/schema.ts";
import { toAdminFeedbackRecordData } from "../admin-record-dto.ts";
import { feedbackMatch, feedbackOperators } from "../../feedback-similarity.ts";
import { hash } from "./storage.ts";
import { reproductionInputKey } from "../../reproduction-package.ts";
import type { SavedPlanCalculationContext } from "../../types.ts";
import { PublicApiError } from "../api-contract.ts";
import { randomUUID } from "node:crypto";

export async function relatedFeedback(id: string) {
  const rows = await getDatabase().select({ feedback, code: planRun.errorCode, context: planRun.calculationContext, boxHash: planRun.operboxContentHmac, hashVersion: planRun.operboxHmacKeyVersion }).from(feedback)
    .leftJoin(planRun, eq(feedback.diagnosticId, planRun.diagnosticId)).where(gt(feedback.expiresAt, new Date()));
  const normalized = rows.map((row) => {
    const dto = toAdminFeedbackRecordData(row.feedback);
    const context = row.context as SavedPlanCalculationContext | null;
    return { dto, id: dto.id, diagnosticId: dto.diagnosticId, facility: dto.facility, operators: feedbackOperators(dto.room, dto.note), errorCode: row.code,
      inputFingerprint: row.boxHash && row.hashVersion && context?.layout && context.rotationProfile && typeof context.fiammettaEnabled === "boolean" ? hash(`${row.hashVersion}:${row.boxHash}:${reproductionInputKey({ format: "riic-reproduction", version: 1, operbox: [], layout: context.layout, rotation: context.rotationProfile, fiammetta_enable: context.fiammettaEnabled })}`) : null };
  });
  const current = normalized.find((row) => row.id === id);
  if (!current) throw new PublicApiError("AIC-DATA-8004");
  const matches = normalized.flatMap((row) => { const match = feedbackMatch(current, row); return match ? [{ feedback: row.dto, ...match }] : []; }).sort((a, b) => a.rank - b.rank || b.feedback.createdAt.localeCompare(a.feedback.createdAt) || a.feedback.id.localeCompare(b.feedback.id)).slice(0, 20);
  const links = await getDatabase().select().from(feedbackLink).where(and(or(eq(feedbackLink.feedbackId, id), eq(feedbackLink.masterId, id)), gt(feedbackLink.expiresAt, new Date())));
  return { operators: current.operators, matches, links };
}
export async function linkFeedback(id: string, masterId: string | null, actorId: string, expectedUpdatedAt: string) {
  if (masterId === id) throw new PublicApiError("AIC-REQ-1001");
  await getDatabase().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(914731027)`);
    const rows = await tx.select().from(feedback).where(inArray(feedback.id, masterId ? [id, masterId] : [id])).orderBy(feedback.id).for("update");
    const child = rows.find((row) => row.id === id);
    const parent = rows.find((row) => row.id === masterId);
    if (!child || (masterId && !parent) || rows.some((row) => row.expiresAt.getTime() <= Date.now())) throw new PublicApiError("AIC-DATA-8004");
    if (child.updatedAt.toISOString() !== expectedUpdatedAt) throw new PublicApiError("AIC-FEEDBACK-4003");
    if (masterId) {
      const chained = await tx.select().from(feedbackLink).where(or(eq(feedbackLink.masterId, id), eq(feedbackLink.feedbackId, masterId)));
      if (chained.length) throw new PublicApiError("AIC-REQ-1001", { message: "请先拆分已有分组，不支持链式归并。" });
      await tx.insert(feedbackLink).values({ feedbackId: id, masterId, actorId, expiresAt: new Date(Math.min(child.expiresAt.getTime(), parent!.expiresAt.getTime())) }).onConflictDoUpdate({ target: feedbackLink.feedbackId, set: { masterId, actorId, createdAt: new Date(), expiresAt: new Date(Math.min(child.expiresAt.getTime(), parent!.expiresAt.getTime())) } });
    } else await tx.delete(feedbackLink).where(eq(feedbackLink.feedbackId, id));
    const now = new Date(Math.max(Date.now(), child.updatedAt.getTime() + 1));
    await tx.update(feedback).set({ updatedAt: now }).where(eq(feedback.id, id));
    await tx.insert(feedbackEvent).values({ id: randomUUID(), feedbackId: id, actorUserId: actorId, status: child.status, note: masterId ? `关联主问题：${masterId}` : "已拆分关联", createdAt: now });
  });
}
