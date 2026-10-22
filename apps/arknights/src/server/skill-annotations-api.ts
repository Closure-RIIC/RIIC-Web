import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";

import { asc, desc, eq } from "drizzle-orm";

import { OPERATOR_CATALOG } from "@/operatorPortraits";
import { SKILL_ANNOTATION_MAX_LENGTH } from "@/skill-annotations";
import type {
  AdminSkillAnnotationData,
  AdminSkillAnnotationDeleteData,
  AdminSkillAnnotationListData,
  AdminSkillAnnotationMutationData,
  SkillAnnotationData,
  SkillAnnotationListData,
} from "@riic/arknights-domain/types";
import {
  assertEmptyBody,
  assertSameOrigin,
  createRequestId,
  enforceRateLimit,
  failureResponse,
  PublicApiError,
  readJsonBody,
  requestClientIp,
  successResponse,
} from "@riic/platform-server/api-contract";
import { requireWebsiteAdmin } from "@riic/platform-server/auth/authorization";
import { getDatabase } from "@riic/platform-server/db";
import { skillAnnotation } from "@riic/platform-server/db/schema";
import { appDeploymentEnvironment } from "@riic/arknights-domain/deployment";
import { cachePublicResponse, createPublicDataCache } from "./public-data-cache.ts";

const publicAnnotations = createPublicDataCache<string, SkillAnnotationData[]>();

type AnnotationRecord = typeof skillAnnotation.$inferSelect;
type AdminSkillAnnotationRoute =
  | "/api/admin/skill-annotations"
  | "/api/admin/skill-annotations/[id]";

const operatorSkills = new Map(
  OPERATOR_CATALOG.map((operator) => [
    operator.id,
    new Set(operator.buildingSkills.map((skill) => skill.id)),
  ]),
);

function noStore(response: Response, isPrivate = false): Response {
  response.headers.set("Cache-Control", `${isPrivate ? "private, " : ""}no-store, max-age=0`);
  return response;
}

function toSkillAnnotationData(record: AnnotationRecord): SkillAnnotationData {
  return {
    id: record.id,
    operatorId: record.operatorId,
    skillId: record.skillId,
    note: record.note,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toAdminSkillAnnotationData(record: AnnotationRecord): AdminSkillAnnotationData {
  return {
    ...toSkillAnnotationData(record),
    createdAt: record.createdAt.toISOString(),
  };
}

function annotationId(value: string): string {
  const normalized = value.trim();
  const hasControlCharacter = [...normalized].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (!normalized || normalized.length > 100 || hasControlCharacter) {
    throw new PublicApiError("AIC-REQ-1001");
  }
  return normalized;
}

function annotationNote(value: unknown): string {
  if (typeof value !== "string") {
    throw new PublicApiError("AIC-REQ-1001", { message: "请填写技能的补充说明。" });
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new PublicApiError("AIC-REQ-1001", { message: "补充说明不能为空。" });
  }
  if (normalized.length > SKILL_ANNOTATION_MAX_LENGTH) {
    throw new PublicApiError("AIC-REQ-1001", {
      message: `补充说明不能超过 ${SKILL_ANNOTATION_MAX_LENGTH} 个字符。`,
    });
  }
  return normalized;
}

function annotationTarget(operatorIdValue: unknown, skillIdValue: unknown) {
  if (typeof operatorIdValue !== "string" || typeof skillIdValue !== "string") {
    throw new PublicApiError("AIC-REQ-1001");
  }
  const operatorId = operatorIdValue.trim();
  const skillId = skillIdValue.trim();
  if (
    !operatorId
    || operatorId.length > 100
    || !skillId
    || skillId.length > 200
    || !operatorSkills.get(operatorId)?.has(skillId)
  ) {
    throw new PublicApiError("AIC-REQ-1001", { message: "请选择当前资源中存在的干员和基建技能。" });
  }
  return { operatorId, skillId };
}

export async function handleListSkillAnnotations(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    enforceRateLimit("skill-annotations-read", requestClientIp(request), 300, 10 * 60_000);
    const annotations = await publicAnnotations.get(appDeploymentEnvironment(), async () => {
      const records = await getDatabase()
        .select()
        .from(skillAnnotation)
        .orderBy(asc(skillAnnotation.operatorId), asc(skillAnnotation.skillId));
      return records.map(toSkillAnnotationData);
    });
    return cachePublicResponse(successResponse<SkillAnnotationListData>({
      annotations,
    }, requestId));
  } catch (error) {
    return noStore(failureResponse(error, requestId, "/api/skill-annotations", startedAt));
  }
}

export async function handleListAdminSkillAnnotations(
  request: Request,
  route: AdminSkillAnnotationRoute = "/api/admin/skill-annotations",
) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    await requireWebsiteAdmin(request);
    enforceRateLimit("admin-skill-annotations-read", requestClientIp(request), 120, 10 * 60_000);
    const records = await getDatabase()
      .select()
      .from(skillAnnotation)
      .orderBy(desc(skillAnnotation.updatedAt));
    return noStore(successResponse<AdminSkillAnnotationListData>({
      annotations: records.map(toAdminSkillAnnotationData),
    }, requestId), true);
  } catch (error) {
    return noStore(failureResponse(error, requestId, route, startedAt), true);
  }
}

export async function handleCreateAdminSkillAnnotation(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSameOrigin(request);
    const admin = await requireWebsiteAdmin(request);
    enforceRateLimit("admin-skill-annotations-write", requestClientIp(request), 60, 10 * 60_000);
    const body = await readJsonBody(request, 16 * 1024) as {
      operatorId?: unknown;
      skillId?: unknown;
      note?: unknown;
    } | null;
    const target = annotationTarget(body?.operatorId, body?.skillId);
    const note = annotationNote(body?.note);
    const now = new Date();
    const [created] = await getDatabase().insert(skillAnnotation).values({
      id: randomUUID(),
      ...target,
      note,
      createdByUserId: admin.session.user.id,
      updatedByUserId: admin.session.user.id,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing({
      target: [skillAnnotation.operatorId, skillAnnotation.skillId],
    }).returning();
    if (!created) {
      throw new PublicApiError("AIC-REQ-1001", { message: "这个干员技能已经有补充说明，请直接编辑现有卡片。" });
    }
    publicAnnotations.invalidate(appDeploymentEnvironment());
    return noStore(successResponse<AdminSkillAnnotationMutationData>({
      annotation: toAdminSkillAnnotationData(created),
    }, requestId, 201), true);
  } catch (error) {
    return noStore(failureResponse(error, requestId, "/api/admin/skill-annotations", startedAt), true);
  }
}

export async function handleUpdateAdminSkillAnnotation(
  request: Request,
  idValue: string,
  route: AdminSkillAnnotationRoute = "/api/admin/skill-annotations/[id]",
) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSameOrigin(request);
    const admin = await requireWebsiteAdmin(request);
    enforceRateLimit("admin-skill-annotations-write", requestClientIp(request), 60, 10 * 60_000);
    const body = await readJsonBody(request, 16 * 1024) as { note?: unknown } | null;
    const [updated] = await getDatabase().update(skillAnnotation).set({
      note: annotationNote(body?.note),
      updatedByUserId: admin.session.user.id,
      updatedAt: new Date(),
    }).where(eq(skillAnnotation.id, annotationId(idValue))).returning();
    if (!updated) throw new PublicApiError("AIC-DATA-8004", { message: "这条补充说明已不存在，请刷新列表。" });
    publicAnnotations.invalidate(appDeploymentEnvironment());
    return noStore(successResponse<AdminSkillAnnotationMutationData>({
      annotation: toAdminSkillAnnotationData(updated),
    }, requestId), true);
  } catch (error) {
    return noStore(failureResponse(error, requestId, route, startedAt), true);
  }
}

export async function handleDeleteAdminSkillAnnotation(
  request: Request,
  idValue: string,
  route: AdminSkillAnnotationRoute = "/api/admin/skill-annotations/[id]",
) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSameOrigin(request);
    await assertEmptyBody(request, 1024);
    await requireWebsiteAdmin(request);
    enforceRateLimit("admin-skill-annotations-write", requestClientIp(request), 60, 10 * 60_000);
    const deleted = await getDatabase().delete(skillAnnotation)
      .where(eq(skillAnnotation.id, annotationId(idValue)))
      .returning({ id: skillAnnotation.id });
    if (!deleted.length) throw new PublicApiError("AIC-DATA-8004", { message: "这条补充说明已不存在，请刷新列表。" });
    publicAnnotations.invalidate(appDeploymentEnvironment());
    return noStore(successResponse<AdminSkillAnnotationDeleteData>({ deleted: true }, requestId), true);
  } catch (error) {
    return noStore(failureResponse(error, requestId, route, startedAt), true);
  }
}
