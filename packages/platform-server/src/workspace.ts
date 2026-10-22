import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";

import { PRIVACY_VERSION, TERMS_VERSION } from "@riic/arknights-domain/legal-policy";
import { assertOperbox } from "@riic/arknights-domain/operbox";
import { normalizePersistedPlanData } from "@riic/arknights-domain/persistence";
import type {
  CloudWorkspaceData,
  CloudWorkspaceState,
  OperBoxEntry,
  PublicPlanData,
  SavedPlanCalculationContext,
  SavedPlanData,
  SavedPlanListData,
} from "@riic/arknights-domain/types";
import { PublicApiError } from "./api-contract";
import {
  BUSINESS_DATA_TTL_MS,
  SAVED_PLAN_LIMIT,
  WORKSPACE_REVISION_LIMIT,
  workspaceMasterKeys,
} from "./business-config";
import { requireAccountDataConsent } from "./data-consent";
import { getDatabase } from "./db";
import {
  operboxSnapshot,
  planCache,
  planCacheReference,
  planRun,
  policyConsent,
  savedPlan,
  userWorkspace,
  workspaceRevision,
} from "./db/schema";
import {
  decryptOperboxSnapshot,
  encryptOperboxSnapshot,
  planOperboxContentHmac,
  verifyPlanOperboxContentHmac,
  type OperboxEnvelope,
} from "./workspace-crypto";
import {
  assertWorkspaceRevision,
  validateSavedPlanCalculationContext,
  validateWorkspacePutRequest,
  validateWorkspaceState,
  workspaceMatchesSavedPlanContext,
  type ValidatedWorkspace,
} from "./workspace-payload";
import { publicPlanSha256 } from "./plan-result-binding";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function snapshotEnvelope(row: typeof operboxSnapshot.$inferSelect): OperboxEnvelope {
  return {
    contentHmac: row.contentHmac,
    encryptedPayload: row.encryptedPayload,
    payloadIv: row.payloadIv,
    wrappedDataKey: row.wrappedDataKey,
    wrappedKeyIv: row.wrappedKeyIv,
    keyVersion: row.keyVersion,
    schemaVersion: row.schemaVersion,
  };
}

async function decryptSnapshot(userId: string, snapshotId: string | null): Promise<OperBoxEntry[] | null> {
  if (!snapshotId) return null;
  const [row] = await getDatabase().select().from(operboxSnapshot).where(and(
    eq(operboxSnapshot.id, snapshotId),
    eq(operboxSnapshot.userId, userId),
  )).limit(1);
  if (!row) throw new PublicApiError("AIC-DATA-8004");
  const keyring = workspaceMasterKeys();
  let plaintext: string;
  try {
    plaintext = decryptOperboxSnapshot({ userId, snapshotId, envelope: snapshotEnvelope(row), keys: keyring.keys });
  } catch (cause) {
    throw new PublicApiError("AIC-SYS-5000", { cause });
  }
  let parsed: unknown;
  try { parsed = JSON.parse(plaintext) as unknown; } catch (cause) { throw new PublicApiError("AIC-SYS-5000", { cause }); }
  let operbox: OperBoxEntry[];
  try { operbox = assertOperbox(parsed); } catch (cause) { throw new PublicApiError("AIC-SYS-5000", { cause }); }

  if (row.keyVersion !== keyring.activeVersion) {
    const activeKey = keyring.keys.get(keyring.activeVersion)!;
    const rotated = encryptOperboxSnapshot({
      userId,
      snapshotId,
      plaintext: JSON.stringify(operbox),
      activeVersion: keyring.activeVersion,
      masterKey: activeKey,
    });
    await getDatabase().update(operboxSnapshot).set({
      ...rotated,
      // Keep the stable deduplication token so key rotation cannot collide with
      // a concurrently uploaded copy encrypted under the new master key.
      contentHmac: row.contentHmac,
    }).where(eq(operboxSnapshot.id, snapshotId));
  }
  return operbox;
}

type WorkspaceWriter = Pick<ReturnType<typeof getDatabase>, "select" | "insert" | "update">;

async function storeSnapshot(userId: string, operbox: OperBoxEntry[] | null, now: Date, db: WorkspaceWriter): Promise<string | null> {
  if (!operbox) return null;
  const snapshotId = randomUUID();
  const keyring = workspaceMasterKeys();
  const envelope = encryptOperboxSnapshot({
    userId,
    snapshotId,
    plaintext: JSON.stringify(operbox),
    activeVersion: keyring.activeVersion,
    masterKey: keyring.keys.get(keyring.activeVersion)!,
  });
  const inserted = await db.insert(operboxSnapshot).values({
    id: snapshotId,
    userId,
    sourceType: "maa",
    ...envelope,
    createdAt: now,
    expiresAt: new Date(now.getTime() + BUSINESS_DATA_TTL_MS),
  }).onConflictDoNothing({ target: [operboxSnapshot.userId, operboxSnapshot.contentHmac] }).returning({ id: operboxSnapshot.id });
  if (inserted[0]) return inserted[0].id;
  const [existing] = await db.select({ id: operboxSnapshot.id }).from(operboxSnapshot).where(and(
    eq(operboxSnapshot.userId, userId),
    eq(operboxSnapshot.contentHmac, envelope.contentHmac),
  )).limit(1);
  if (!existing) throw new PublicApiError("AIC-SYS-5000");
  await db.update(operboxSnapshot).set({ expiresAt: new Date(now.getTime() + BUSINESS_DATA_TTL_MS) }).where(eq(operboxSnapshot.id, existing.id));
  return existing.id;
}

function planTitle(context: SavedPlanCalculationContext, sourceName: string | null): string {
  return `${context.presetLabel || context.layout.template} · ${sourceName || "排班"}`.slice(0, 120);
}

function invalidSavedPlanBinding(message: string): never {
  throw new PublicApiError("AIC-DATA-8003", {
    fieldErrors: [{ path: "result", code: "plan_context_mismatch", message }],
  });
}

type SavedPlanOperboxBinding = { contentHmac: string; keyVersion: string };

function activeOperboxBinding(
  userId: string,
  operbox: OperBoxEntry[] | null,
  contentHmac: unknown,
  keyVersion: unknown,
): SavedPlanOperboxBinding | null {
  if (!operbox || typeof keyVersion !== "string") return null;
  const { activeVersion, keys } = workspaceMasterKeys();
  const sourceKey = keys.get(keyVersion);
  if (!sourceKey || !verifyPlanOperboxContentHmac({
    userId,
    operbox,
    masterKey: sourceKey,
    expected: contentHmac,
  })) return null;
  const activeKey = keys.get(activeVersion);
  if (!activeKey) return null;
  return {
    contentHmac: planOperboxContentHmac({ userId, operbox, masterKey: activeKey }),
    keyVersion: activeVersion,
  };
}

async function storeSavedPlan(
  userId: string,
  state: CloudWorkspaceState,
  operbox: OperBoxEntry[] | null,
  result: PublicPlanData | null,
  now: Date,
  db: WorkspaceWriter,
): Promise<string | null> {
  if (!result) return null;
  const candidate = normalizePersistedPlanData(result, state.rotationProfile);
  if (!candidate) throw new PublicApiError("AIC-DATA-8003");
  const [ownedPlan] = await db.select({
    id: savedPlan.id,
    pinned: savedPlan.pinned,
    publicResult: savedPlan.publicResult,
    calculationContext: savedPlan.calculationContext,
    operboxContentHmac: savedPlan.operboxContentHmac,
    operboxHmacKeyVersion: savedPlan.operboxHmacKeyVersion,
  }).from(savedPlan).where(and(
    eq(savedPlan.userId, userId),
    eq(savedPlan.diagnosticId, candidate.diagnosticId),
  )).limit(1);
  if (ownedPlan) {
    const calculationContext = validateSavedPlanCalculationContext(ownedPlan.calculationContext);
    const storedResult = calculationContext
      ? normalizePersistedPlanData(ownedPlan.publicResult, calculationContext.rotationProfile)
      : null;
    const normalized = calculationContext
      ? normalizePersistedPlanData(result, calculationContext.rotationProfile)
      : null;
    const activeBinding = activeOperboxBinding(
      userId,
      operbox,
      ownedPlan.operboxContentHmac,
      ownedPlan.operboxHmacKeyVersion,
    );
    if (
      !calculationContext
      || !storedResult
      || !normalized
      || publicPlanSha256(normalized) !== publicPlanSha256(storedResult)
      || !activeBinding
    ) {
      return invalidSavedPlanBinding("排班结果与已保存的计算记录不一致，请重新求解后再同步。");
    }
    if (!workspaceMatchesSavedPlanContext(state, calculationContext, operbox)) {
      return invalidSavedPlanBinding("当前工作区配置与排班结果不一致，请重新求解后再同步。");
    }
    await db.update(savedPlan).set({
      title: planTitle(calculationContext, state.sourceName),
      operboxContentHmac: activeBinding.contentHmac,
      operboxHmacKeyVersion: activeBinding.keyVersion,
      updatedAt: now,
      expiresAt: ownedPlan.pinned ? null : new Date(now.getTime() + BUSINESS_DATA_TTL_MS),
    }).where(eq(savedPlan.id, ownedPlan.id));
    return ownedPlan.id;
  }
  const [binding] = await db.select({
    calculationContext: planRun.calculationContext,
    publicResultSha256: planRun.publicResultSha256,
    operboxContentHmac: planRun.operboxContentHmac,
    operboxHmacKeyVersion: planRun.operboxHmacKeyVersion,
  }).from(planRun).where(and(
    eq(planRun.diagnosticId, candidate.diagnosticId),
    eq(planRun.status, "success"),
    eq(planRun.userId, userId),
  )).limit(1);
  const calculationContext = validateSavedPlanCalculationContext(binding?.calculationContext);
  if (!calculationContext || !/^[a-f0-9]{64}$/.test(binding?.publicResultSha256 ?? "")) {
    return invalidSavedPlanBinding("找不到与该结果绑定的求解记录，请重新求解后再同步。");
  }
  const normalized = normalizePersistedPlanData(result, calculationContext.rotationProfile);
  if (!normalized || publicPlanSha256(normalized) !== binding.publicResultSha256) {
    return invalidSavedPlanBinding("排班结果校验失败，请重新求解后再同步。");
  }
  const activeBinding = activeOperboxBinding(
    userId,
    operbox,
    binding.operboxContentHmac,
    binding.operboxHmacKeyVersion,
  );
  if (!activeBinding) {
    return invalidSavedPlanBinding("当前 MAA Box 与该排班的求解输入不一致，请重新求解后再同步。");
  }
  if (!workspaceMatchesSavedPlanContext(state, calculationContext, operbox)) {
    return invalidSavedPlanBinding("当前工作区配置与排班结果不一致，请重新求解后再同步。");
  }
  const id = randomUUID();
  const inserted = await db.insert(savedPlan).values({
    id,
    userId,
    diagnosticId: normalized.diagnosticId,
    title: planTitle(calculationContext, state.sourceName),
    publicResult: normalized,
    calculationContext,
    operboxContentHmac: activeBinding.contentHmac,
    operboxHmacKeyVersion: activeBinding.keyVersion,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + BUSINESS_DATA_TTL_MS),
  }).onConflictDoNothing({ target: [savedPlan.userId, savedPlan.diagnosticId] }).returning({ id: savedPlan.id });
  if (inserted[0]) return inserted[0].id;
  return storeSavedPlan(userId, state, operbox, result, now, db);
}

async function pruneUserHistory(userId: string, now: Date): Promise<void> {
  await getDatabase().delete(workspaceRevision).where(lt(workspaceRevision.expiresAt, now));
  const revisions = await getDatabase().select({ id: workspaceRevision.id }).from(workspaceRevision)
    .where(eq(workspaceRevision.userId, userId)).orderBy(desc(workspaceRevision.revision));
  if (revisions.length > WORKSPACE_REVISION_LIMIT) {
    await getDatabase().delete(workspaceRevision).where(inArray(workspaceRevision.id, revisions.slice(WORKSPACE_REVISION_LIMIT).map((item) => item.id)));
  }
  await getDatabase().delete(savedPlan).where(and(
    eq(savedPlan.userId, userId),
    eq(savedPlan.pinned, false),
    lt(savedPlan.expiresAt, now),
  ));
  const normalPlans = await getDatabase().select({ id: savedPlan.id }).from(savedPlan).where(and(
    eq(savedPlan.userId, userId), eq(savedPlan.pinned, false),
  )).orderBy(desc(savedPlan.updatedAt));
  if (normalPlans.length > SAVED_PLAN_LIMIT) {
    await getDatabase().delete(savedPlan).where(inArray(savedPlan.id, normalPlans.slice(SAVED_PLAN_LIMIT).map((item) => item.id)));
  }
  await getDatabase().delete(operboxSnapshot).where(and(
    eq(operboxSnapshot.userId, userId),
    lt(operboxSnapshot.expiresAt, now),
  ));
}

async function savedPlanAttachment(
  userId: string,
  id: string | null,
): Promise<{
  id: string;
  result: PublicPlanData;
  calculationContext: SavedPlanCalculationContext;
  operboxContentHmac: string | null;
  operboxHmacKeyVersion: string | null;
} | null> {
  if (!id) return null;
  const [row] = await getDatabase().select({
    id: savedPlan.id,
    result: savedPlan.publicResult,
    calculationContext: savedPlan.calculationContext,
    operboxContentHmac: savedPlan.operboxContentHmac,
    operboxHmacKeyVersion: savedPlan.operboxHmacKeyVersion,
  }).from(savedPlan).where(and(
    eq(savedPlan.id, id), eq(savedPlan.userId, userId),
  )).limit(1);
  const calculationContext = validateSavedPlanCalculationContext(row?.calculationContext);
  const result = calculationContext
    ? normalizePersistedPlanData(row?.result, calculationContext.rotationProfile)
    : null;
  return result && calculationContext ? {
    id: row.id,
    result,
    calculationContext,
    operboxContentHmac: row.operboxContentHmac,
    operboxHmacKeyVersion: row.operboxHmacKeyVersion,
  } : null;
}

async function putValidatedWorkspace(userId: string, value: ValidatedWorkspace & { baseRevision: number }): Promise<CloudWorkspaceData> {
  const now = new Date();
  const written = await getDatabase().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    const [consent] = await tx.select({ revokedAt: policyConsent.revokedAt })
      .from(policyConsent)
      .where(and(
        eq(policyConsent.userId, userId),
        eq(policyConsent.termsVersion, TERMS_VERSION),
        eq(policyConsent.privacyVersion, PRIVACY_VERSION),
      ))
      .limit(1);
    if (!consent || consent.revokedAt) {
      // Commit cleanup before returning the consent error so a stale request
      // cannot recreate data after revocation.
      await tx.delete(workspaceRevision).where(eq(workspaceRevision.userId, userId));
      await tx.delete(userWorkspace).where(eq(userWorkspace.userId, userId));
      await tx.delete(savedPlan).where(eq(savedPlan.userId, userId));
      await tx.delete(operboxSnapshot).where(eq(operboxSnapshot.userId, userId));
      return null;
    }
    const [current] = await tx.select().from(userWorkspace).where(eq(userWorkspace.userId, userId)).limit(1);
    assertWorkspaceRevision(value.baseRevision, current?.currentRevision ?? 0);
    const savedPlanId = await storeSavedPlan(userId, value.state, value.operbox, value.result, now, tx);
    const snapshotId = await storeSnapshot(userId, value.operbox, now, tx);
    const revision = (current?.currentRevision ?? 0) + 1;
    if (current) {
      const revisionExpiresAt = new Date(now.getTime() + BUSINESS_DATA_TTL_MS);
      await tx.insert(workspaceRevision).values({
        id: randomUUID(),
        userId,
        revision: current.currentRevision,
        state: current.state,
        operboxSnapshotId: current.operboxSnapshotId,
        savedPlanId: current.currentSavedPlanId,
        createdAt: current.updatedAt,
        expiresAt: revisionExpiresAt,
      }).onConflictDoNothing({ target: [workspaceRevision.userId, workspaceRevision.revision] });
      if (current.operboxSnapshotId) {
        await tx.update(operboxSnapshot).set({ expiresAt: revisionExpiresAt }).where(eq(operboxSnapshot.id, current.operboxSnapshotId));
      }
      if (current.currentSavedPlanId) {
        await tx.update(savedPlan).set({ expiresAt: revisionExpiresAt }).where(and(
          eq(savedPlan.id, current.currentSavedPlanId),
          eq(savedPlan.pinned, false),
        ));
      }
      await tx.update(userWorkspace).set({
        currentRevision: revision,
        state: value.state,
        operboxSnapshotId: snapshotId,
        currentSavedPlanId: savedPlanId,
        updatedAt: now,
        syncedAt: now,
      }).where(eq(userWorkspace.userId, userId));
    } else {
      await tx.insert(userWorkspace).values({
        userId,
        currentRevision: revision,
        state: value.state,
        operboxSnapshotId: snapshotId,
        currentSavedPlanId: savedPlanId,
        createdAt: now,
        updatedAt: now,
        syncedAt: now,
      });
    }
    const revisions = await tx.select({
      id: workspaceRevision.id,
      revision: workspaceRevision.revision,
      createdAt: workspaceRevision.createdAt,
      expiresAt: workspaceRevision.expiresAt,
    }).from(workspaceRevision).where(eq(workspaceRevision.userId, userId))
      .orderBy(desc(workspaceRevision.revision)).limit(WORKSPACE_REVISION_LIMIT);
    // Acknowledge this write, not a later writer's data or revision.
    return {
      exists: true,
      revision,
      state: value.state,
      operbox: value.operbox,
      result: value.result,
      updatedAt: now.toISOString(),
      syncedAt: now.toISOString(),
      revisions: revisions.map((item) => ({ ...item, createdAt: item.createdAt.toISOString(), expiresAt: item.expiresAt.toISOString() })),
    };
  });
  if (!written) throw new PublicApiError("AIC-DATA-8001");
  await pruneUserHistory(userId, now);
  return written;
}

/**
 * 读取当前云端工作区里最近一次 MAA 上传的干员快照（加密存储）。
 * 供 agent 干员来源三级降级（森空岛 → MAA → 示例 Box）的中间层使用。
 * 未上传过、未开云同步或快照已过期时返回 null。
 */
export async function getMaaOperboxSnapshot(userId: string): Promise<OperBoxEntry[] | null> {
  await requireAccountDataConsent(userId);
  const [current] = await getDatabase().select().from(userWorkspace).where(eq(userWorkspace.userId, userId)).limit(1);
  if (!current) return null;
  const state = validateWorkspaceState(current.state);
  if (state.boxSource !== "maa") return null;
  try {
    return await decryptSnapshot(userId, current.operboxSnapshotId);
  } catch {
    return null;
  }
}

export async function getWorkspace(userId: string): Promise<CloudWorkspaceData> {
  await requireAccountDataConsent(userId);
  const [current] = await getDatabase().select().from(userWorkspace).where(eq(userWorkspace.userId, userId)).limit(1);
  const revisions = await getDatabase().select({
    id: workspaceRevision.id,
    revision: workspaceRevision.revision,
    createdAt: workspaceRevision.createdAt,
    expiresAt: workspaceRevision.expiresAt,
  }).from(workspaceRevision).where(eq(workspaceRevision.userId, userId)).orderBy(desc(workspaceRevision.revision)).limit(WORKSPACE_REVISION_LIMIT);
  if (!current) {
    return { exists: false, revision: 0, state: null, operbox: null, result: null, updatedAt: null, syncedAt: null, revisions: [] };
  }
  const syncedAt = new Date();
  const activeExpiresAt = new Date(syncedAt.getTime() + BUSINESS_DATA_TTL_MS);
  await getDatabase().transaction(async (tx) => {
    await tx.update(userWorkspace).set({ syncedAt }).where(eq(userWorkspace.userId, userId));
    if (current.operboxSnapshotId) {
      await tx.update(operboxSnapshot).set({ expiresAt: activeExpiresAt }).where(eq(operboxSnapshot.id, current.operboxSnapshotId));
    }
    if (current.currentSavedPlanId) {
      await tx.update(savedPlan).set({ expiresAt: activeExpiresAt }).where(and(
        eq(savedPlan.id, current.currentSavedPlanId),
        eq(savedPlan.pinned, false),
      ));
    }
  });
  const state = validateWorkspaceState(current.state);
  const operbox = state.boxSource === "maa" ? await decryptSnapshot(userId, current.operboxSnapshotId) : null;
  const attachment = await savedPlanAttachment(userId, current.currentSavedPlanId);
  const attachmentBinding = attachment ? activeOperboxBinding(
    userId,
    operbox,
    attachment.operboxContentHmac,
    attachment.operboxHmacKeyVersion,
  ) : null;
  if (attachment && attachmentBinding && (
    attachmentBinding.contentHmac !== attachment.operboxContentHmac
    || attachmentBinding.keyVersion !== attachment.operboxHmacKeyVersion
  )) {
    await getDatabase().update(savedPlan).set({
      operboxContentHmac: attachmentBinding.contentHmac,
      operboxHmacKeyVersion: attachmentBinding.keyVersion,
    }).where(and(eq(savedPlan.id, attachment.id), eq(savedPlan.userId, userId)));
  }
  return {
    exists: true,
    revision: current.currentRevision,
    state,
    operbox,
    result: attachment
      && workspaceMatchesSavedPlanContext(state, attachment.calculationContext, operbox)
      && attachmentBinding
      ? attachment.result
      : null,
    updatedAt: current.updatedAt.toISOString(),
    syncedAt: syncedAt.toISOString(),
    revisions: revisions.map((item) => ({ ...item, createdAt: item.createdAt.toISOString(), expiresAt: item.expiresAt.toISOString() })),
  };
}

export async function putWorkspace(userId: string, body: unknown): Promise<CloudWorkspaceData> {
  await requireAccountDataConsent(userId);
  const request = validateWorkspacePutRequest(body);
  if ("restoreRevisionId" in request) {
    const [revision] = await getDatabase().select().from(workspaceRevision).where(and(
      eq(workspaceRevision.id, request.restoreRevisionId),
      eq(workspaceRevision.userId, userId),
    )).limit(1);
    if (!revision || revision.expiresAt <= new Date()) throw new PublicApiError("AIC-DATA-8004");
    const state = validateWorkspaceState(revision.state);
    const operbox = state.boxSource === "maa" ? await decryptSnapshot(userId, revision.operboxSnapshotId) : null;
    const attachment = await savedPlanAttachment(userId, revision.savedPlanId);
    const attachmentBinding = attachment ? activeOperboxBinding(
      userId,
      operbox,
      attachment.operboxContentHmac,
      attachment.operboxHmacKeyVersion,
    ) : null;
    return putValidatedWorkspace(userId, {
      baseRevision: request.baseRevision,
      state,
      operbox,
      result: attachment
        && workspaceMatchesSavedPlanContext(state, attachment.calculationContext, operbox)
        && attachmentBinding
        ? attachment.result
        : null,
    });
  }
  return putValidatedWorkspace(userId, request);
}

function toSavedPlanData(row: typeof savedPlan.$inferSelect, boxMatchesWorkspace: boolean): SavedPlanData | null {
  const calculationContext = validateSavedPlanCalculationContext(row.calculationContext);
  const result = normalizePersistedPlanData(
    row.publicResult,
    calculationContext?.rotationProfile ?? "abc_12_6_6",
  );
  if (!result) return null;
  return {
    id: row.id,
    diagnosticId: row.diagnosticId,
    title: row.title,
    calculationContext,
    boxMatchesWorkspace,
    pinned: row.pinned,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    result,
  };
}

export async function listSavedPlans(userId: string): Promise<SavedPlanListData> {
  await requireAccountDataConsent(userId);
  await pruneUserHistory(userId, new Date());
  const rows = await getDatabase().select().from(savedPlan).where(eq(savedPlan.userId, userId)).orderBy(desc(savedPlan.pinned), desc(savedPlan.updatedAt));
  const [current] = await getDatabase().select({
    operboxSnapshotId: userWorkspace.operboxSnapshotId,
  }).from(userWorkspace).where(eq(userWorkspace.userId, userId)).limit(1);
  const operbox = current?.operboxSnapshotId ? await decryptSnapshot(userId, current.operboxSnapshotId) : null;
  const plans: SavedPlanData[] = [];
  for (const row of rows) {
    const binding = activeOperboxBinding(
      userId,
      operbox,
      row.operboxContentHmac,
      row.operboxHmacKeyVersion,
    );
    if (binding && (
      binding.contentHmac !== row.operboxContentHmac
      || binding.keyVersion !== row.operboxHmacKeyVersion
    )) {
      await getDatabase().update(savedPlan).set({
        operboxContentHmac: binding.contentHmac,
        operboxHmacKeyVersion: binding.keyVersion,
      }).where(and(eq(savedPlan.id, row.id), eq(savedPlan.userId, userId)));
    }
    const data = toSavedPlanData(row, Boolean(binding));
    if (data) plans.push(data);
  }
  return { plans };
}

export async function updateSavedPlan(userId: string, id: string, value: unknown): Promise<SavedPlanData> {
  await requireAccountDataConsent(userId);
  if (!isObject(value) || typeof value.pinned !== "boolean") throw new PublicApiError("AIC-DATA-8003");
  const pinnedValue = value.pinned;
  const [current] = await getDatabase().select({ operboxSnapshotId: userWorkspace.operboxSnapshotId })
    .from(userWorkspace).where(eq(userWorkspace.userId, userId)).limit(1);
  const operbox = current?.operboxSnapshotId ? await decryptSnapshot(userId, current.operboxSnapshotId) : null;
  return getDatabase().transaction(async (tx) => {
    // Serialize pin-count checks per account so concurrent devices cannot exceed
    // the five long-lived plans limit.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    const [existing] = await tx.select().from(savedPlan).where(and(
      eq(savedPlan.id, id),
      eq(savedPlan.userId, userId),
    )).limit(1);
    if (!existing) throw new PublicApiError("AIC-DATA-8004");
    if (pinnedValue && !existing.pinned) {
      const pinned = await tx.select({ count: sql<number>`count(*)::int` }).from(savedPlan).where(and(
        eq(savedPlan.userId, userId),
        eq(savedPlan.pinned, true),
      ));
      if ((pinned[0]?.count ?? 0) >= SAVED_PLAN_LIMIT) {
        throw new PublicApiError("AIC-DATA-8003", { message: "最多固定 5 条排班。" });
      }
    }
    const binding = activeOperboxBinding(
      userId,
      operbox,
      existing.operboxContentHmac,
      existing.operboxHmacKeyVersion,
    );
    const [updated] = await tx.update(savedPlan).set({
      pinned: pinnedValue,
      expiresAt: pinnedValue ? null : new Date(Date.now() + BUSINESS_DATA_TTL_MS),
      updatedAt: new Date(),
      ...(binding ? {
        operboxContentHmac: binding.contentHmac,
        operboxHmacKeyVersion: binding.keyVersion,
      } : {}),
    }).where(and(eq(savedPlan.id, id), eq(savedPlan.userId, userId))).returning();
    const result = updated && toSavedPlanData(updated, Boolean(binding));
    if (!result) throw new PublicApiError("AIC-DATA-8004");
    return result;
  });
}

export async function deleteSavedPlan(userId: string, id: string): Promise<void> {
  await requireAccountDataConsent(userId);
  const deleted = await getDatabase().delete(savedPlan).where(and(eq(savedPlan.id, id), eq(savedPlan.userId, userId))).returning({ id: savedPlan.id });
  if (!deleted.length) throw new PublicApiError("AIC-DATA-8004");
}

export async function revokeAccountDataConsentAndPurgeCloudData(userId: string): Promise<void> {
  await requireAccountDataConsent(userId);
  await getDatabase().transaction(async (tx) => {
    // Serialize revocation with late plan-run writes. The writer rechecks current
    // consent while holding this same lock before persisting any cloud binding.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    const referencedCaches = await tx.selectDistinct({ key: planCacheReference.cacheKeyHmac })
      .from(planCacheReference)
      .where(eq(planCacheReference.userId, userId));
    if (referencedCaches.length) {
      await tx.delete(planCache).where(inArray(
        planCache.keyHmac,
        referencedCaches.map((row) => row.key),
      ));
    }
    await tx.delete(workspaceRevision).where(eq(workspaceRevision.userId, userId));
    await tx.delete(userWorkspace).where(eq(userWorkspace.userId, userId));
    await tx.delete(savedPlan).where(eq(savedPlan.userId, userId));
    await tx.delete(operboxSnapshot).where(eq(operboxSnapshot.userId, userId));
    await tx.update(planRun).set({
      calculationContext: null,
      publicResultSha256: null,
      operboxContentHmac: null,
      operboxHmacKeyVersion: null,
    }).where(eq(planRun.userId, userId));
    await tx.update(policyConsent).set({ revokedAt: new Date() }).where(and(
      eq(policyConsent.userId, userId),
      eq(policyConsent.termsVersion, TERMS_VERSION),
      eq(policyConsent.privacyVersion, PRIVACY_VERSION),
    ));
  });
}
