import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getDatabase } from "@riic/platform-server/db";
import { releaseNote } from "@riic/platform-server/db/schema";
import type { AdminRelease, ReleaseDraft, ReleaseEnvironment } from "@riic/arknights-domain/releases/types";
import { assertReleasePublishable, compareReleaseVersions, ReleaseValidationError } from "../releases/validation.ts";

export class ReleaseConflictError extends Error {}
export class ReleaseNotFoundError extends Error {}
type RecordRow = typeof releaseNote.$inferSelect;

function adminDto(row: RecordRow): AdminRelease {
  return {
    id: row.id, draft: row.draft, published: row.published, revision: row.revision,
    firstPublishedAt: row.firstPublishedAt?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error !== null && typeof error === "object"
    && (("code" in error && error.code === "23505") || ("cause" in error && isUniqueViolation(error.cause)));
}

export async function listPublishedReleases(environment: ReleaseEnvironment): Promise<ReleaseDraft[]> {
  // Only select the published snapshot: drafts and administrator identities never enter public DTOs.
  const rows = await getDatabase().select({ published: releaseNote.published }).from(releaseNote)
    .where(and(eq(releaseNote.environment, environment), isNotNull(releaseNote.published)));
  return rows.flatMap(({ published }) => published ? [published] : [])
    .sort((a, b) => compareReleaseVersions(b.version, a.version));
}

export async function listAdminReleases(environment: ReleaseEnvironment): Promise<AdminRelease[]> {
  return (await getDatabase().select().from(releaseNote).where(eq(releaseNote.environment, environment))
    .orderBy(desc(releaseNote.createdAt))).map(adminDto);
}

export async function createRelease(environment: ReleaseEnvironment, draft: ReleaseDraft, adminId: string): Promise<AdminRelease> {
  try {
    const [row] = await getDatabase().insert(releaseNote).values({
      id: randomUUID(), environment, version: draft.version, draft,
      createdByUserId: adminId, updatedByUserId: adminId,
    }).returning();
    return adminDto(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new ReleaseConflictError("当前环境已有这个版本号，请编辑已有日志。");
    throw error;
  }
}

export async function mutateRelease(environment: ReleaseEnvironment, id: string, mutation: {
  action: "save" | "publish" | "withdraw" | "delete"; revision: number; draft?: ReleaseDraft;
}, adminId: string): Promise<AdminRelease | null> {
  const db = getDatabase();
  const scope = and(eq(releaseNote.environment, environment), eq(releaseNote.id, id));
  const [current] = await db.select().from(releaseNote).where(scope).limit(1);
  if (!current) throw new ReleaseNotFoundError("当前环境中找不到这条日志。");
  if (current.revision !== mutation.revision) throw new ReleaseConflictError("日志已被其他操作修改，请刷新列表后重新编辑。");
  const cas = and(scope, eq(releaseNote.revision, mutation.revision));
  if (mutation.action === "delete") {
    if (current.firstPublishedAt) throw new ReleaseValidationError("发布过的日志只能撤回，不能删除。");
    const removed = await db.delete(releaseNote).where(cas).returning({ id: releaseNote.id });
    if (!removed.length) throw new ReleaseConflictError("日志已被修改，请刷新列表后重试。");
    return null;
  }
  const update: Partial<typeof releaseNote.$inferInsert> = {
    updatedAt: new Date(), updatedByUserId: adminId, revision: current.revision + 1,
  };
  if (mutation.action === "save") {
    const draft = mutation.draft;
    if (!draft) throw new ReleaseValidationError("缺少草稿内容。");
    if (current.firstPublishedAt && draft.version !== current.version) throw new ReleaseValidationError("发布过的版本号不可更改，请新建日志。");
    update.draft = draft;
    update.version = draft.version;
  } else if (mutation.action === "publish") {
    assertReleasePublishable(current.draft);
    update.published = current.draft;
    update.firstPublishedAt = current.firstPublishedAt ?? new Date();
    update.publishedAt = new Date();
  } else {
    update.published = null;
    update.publishedAt = null;
  }
  try {
    const [row] = await db.update(releaseNote).set(update).where(cas).returning();
    if (!row) throw new ReleaseConflictError("日志已被修改，请刷新列表后重试。");
    return adminDto(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new ReleaseConflictError("当前环境已有这个版本号。");
    throw error;
  }
}
