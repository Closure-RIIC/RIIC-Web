import "@tanstack/react-start/server-only";

import { and, asc, count, desc, eq, gt, ilike, inArray, or } from "drizzle-orm";

import type {
  AdminSessionsData,
  AdminUserAction,
  AdminUsersData,
  AdminUserUpdateData,
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
import {
  canChangeWebsiteAdminRole,
  canModerateWebsiteUser,
  isEligibleForWebsiteAdmin,
  WEBSITE_ADMIN_ROLE,
  WEBSITE_REVIEWER_ROLE,
  WEBSITE_USER_ROLE,
  websiteAdminAccess,
} from "@riic/platform-server/auth/admin-access";
import { toAdminSessionData, toAdminUserData } from "./auth/admin-dto";
import { requireWebsiteAdmin, requireWebsiteSuperAdmin } from "@riic/platform-server/auth/authorization";
import { configuredAdminIds } from "@riic/platform-server/auth/config";
import { getDatabase } from "@riic/platform-server/db";
import { billingWallet, session, user } from "@riic/platform-server/db/schema";
import { sklandBindingSummariesByUserIds } from "@riic/platform-server/skland/bindings";

type AdminUserRoute =
  | "/api/admin/users"
  | "/api/admin/users/[id]"
  | "/api/admin/users/[id]/sessions";

type AdminUserMutation =
  | { kind: "admin"; enabled: boolean }
  | { kind: "reviewer"; enabled: boolean }
  | { kind: "banned"; enabled: boolean; reason?: string }
  | { kind: "revokeSessions" };

function deprecated(response: Response, successor: string): Response {
  response.headers.set("Deprecation", "true");
  response.headers.set("Link", `<${successor}>; rel="successor-version"`);
  return response;
}

function userPath(userId: string): string {
  return `/api/admin/users/${encodeURIComponent(userId)}`;
}

async function applyAdminUserMutation(request: Request, userId: string, mutation: AdminUserMutation) {
  assertSameOrigin(request);
  const actor = await requireWebsiteAdmin(request);
  enforceRateLimit("admin-users-write", requestClientIp(request), 30, 10 * 60_000);
  if (!userId || userId.length > 100) throw new PublicApiError("AIC-REQ-1001");

  await getDatabase().transaction(async tx => {
    // Lock both identities in a stable order. Role grants and moderation share
    // these locks, so an account promoted concurrently cannot be moderated using
    // an earlier, less privileged target role.
    const records = await tx.select({ id: user.id, role: user.role, emailVerified: user.emailVerified, banned: user.banned })
      .from(user).where(inArray(user.id, [...new Set([actor.userId, userId])])).orderBy(asc(user.id)).for("update");
    const actorRecord = records.find(record => record.id === actor.userId);
    const targetRecord = records.find(record => record.id === userId);
    if (!actorRecord || actorRecord.banned || !websiteAdminAccess(actor.userId, actorRecord.role).isAdmin) throw new PublicApiError("AIC-AUTH-2009");
    if (!targetRecord) throw new PublicApiError("AIC-REQ-1001", { message: "目标用户不存在。" });
    const currentActor = websiteAdminAccess(actor.userId, actorRecord.role);
    const targetAccess = websiteAdminAccess(targetRecord.id, targetRecord.role);

    if (mutation.kind === "admin" || mutation.kind === "reviewer") {
      if (!canChangeWebsiteAdminRole(currentActor, targetAccess)) {
        throw new PublicApiError("AIC-AUTH-2009", {
          message: targetAccess.isBootstrapAdmin
            ? "超级管理员名单只能通过服务器环境变量调整。"
            : "只有超级管理员可以调整后台角色。",
      });
    }
    if (mutation.enabled && !isEligibleForWebsiteAdmin(targetRecord.emailVerified, targetRecord.banned)) {
      throw new PublicApiError("AIC-REQ-1001", { message: "只能将已验证且未封禁的账号设为管理员或审阅人。" });
    }
    const role = mutation.kind === "admin" ? WEBSITE_ADMIN_ROLE : WEBSITE_REVIEWER_ROLE;
    // Revoking one role must not silently revoke a different role assigned meanwhile.
    if (!mutation.enabled && targetRecord.role !== role) return;
    await tx.update(user).set({
      role: mutation.enabled ? role : WEBSITE_USER_ROLE,
      updatedAt: new Date(),
    }).where(eq(user.id, userId));
    return;
  }

  if (mutation.kind === "revokeSessions") {
    if (!canModerateWebsiteUser(currentActor, targetAccess)) {
      throw new PublicApiError("AIC-AUTH-2009", { message: "普通管理员只能管理普通用户的 Session。" });
    }
    await tx.delete(session).where(eq(session.userId, userId));
    return;
  }

  if (userId === actor.userId && mutation.enabled) {
    throw new PublicApiError("AIC-REQ-1001", { message: "不能封禁当前管理员账号。" });
  }
  if (!canModerateWebsiteUser(currentActor, targetAccess)) {
    throw new PublicApiError("AIC-AUTH-2009", { message: "普通管理员只能封禁或解封普通用户。" });
  }
  await tx.update(user).set(mutation.enabled ? {
    banned: true,
    banReason: mutation.reason?.slice(0, 300) || "管理员封禁",
    updatedAt: new Date(),
  } : {
    banned: false,
    banReason: null,
    banExpires: null,
    updatedAt: new Date(),
  }).where(eq(user.id, userId));
  if (mutation.enabled) await tx.delete(session).where(eq(session.userId, userId));
  });
}

export async function handleGetAdminPermissions(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  let response: Response;
  try {
    const actor = await requireWebsiteSuperAdmin(request);
    enforceRateLimit("admin-permissions-read", actor.userId, 60, 60_000);
    const ids = [...configuredAdminIds()];
    const records = ids.length ? await getDatabase().select({ id: user.id, name: user.name, email: user.email, banned: user.banned })
      .from(user).where(inArray(user.id, ids)) : [];
    const byId = new Map(records.map(record => [record.id, record]));
    // Enumerate the configured IDs, including missing accounts. The ordinary user
    // search is capped at 100 rows and cannot represent the complete server list.
    response = successResponse({ superAdmins: ids.map(id => {
      const account = byId.get(id);
      return { id, name: account?.name ?? null, email: account?.email ?? null, banned: account?.banned ?? null, exists: !!account };
    }) }, requestId);
  } catch (error) {
    response = failureResponse(error, requestId, "/api/admin/permissions", startedAt);
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function handleListAdminUsers(request: Request, route: AdminUserRoute = "/api/admin/users") {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    const actor = await requireWebsiteAdmin(request);
    enforceRateLimit("admin-users", requestClientIp(request), 60, 10 * 60_000);
    const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100);
    const where = query ? or(ilike(user.email, `%${query}%`), ilike(user.name, `%${query}%`)) : undefined;
    const records = await getDatabase().select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      role: user.role,
      banned: user.banned,
      banReason: user.banReason,
      createdAt: user.createdAt,
      paidPoints: billingWallet.paidPoints,
      monthlyPoints: billingWallet.monthlyPoints,
      monthlyExpiresAt: billingWallet.monthlyExpiresAt,
    }).from(user).leftJoin(billingWallet, eq(billingWallet.userId, user.id)).where(where).orderBy(desc(user.createdAt)).limit(100);
    const [summary] = await getDatabase().select({ verifiedUsers: count() })
      .from(user).where(eq(user.emailVerified, true));
    const bindingSummaries = await sklandBindingSummariesByUserIds(records.map((record) => record.id));
    const bootstrapAdminIds = configuredAdminIds();
    return successResponse<AdminUsersData>({
      users: records.map((record) => {
        const bindingSummary = bindingSummaries.get(record.id);
        return toAdminUserData({
          ...record,
          sklandBindingCount: bindingSummary?.totalCount ?? 0,
          sklandActiveBindingCount: bindingSummary?.activeCount ?? 0,
          sklandRenewalDueCount: bindingSummary?.renewalDueCount ?? 0,
        }, bootstrapAdminIds, actor);
      }),
      permissions: { canManageAdminRoles: actor.canManageAdminRoles },
      summary,
    }, requestId);
  } catch (error) {
    return failureResponse(error, requestId, route, startedAt);
  }
}

export async function handleListAdminUserSessions(
  request: Request,
  userId: string,
  route: AdminUserRoute = "/api/admin/users/[id]/sessions",
) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    const actor = await requireWebsiteAdmin(request);
    enforceRateLimit("admin-users", requestClientIp(request), 60, 10 * 60_000);
    if (!userId || userId.length > 100) throw new PublicApiError("AIC-REQ-1001");
    const [target] = await getDatabase().select({ id: user.id, role: user.role }).from(user).where(eq(user.id, userId)).limit(1);
    if (!target || !canModerateWebsiteUser(actor, websiteAdminAccess(target.id, target.role))) throw new PublicApiError("AIC-AUTH-2009");
    const sessions = await getDatabase().select({
      id: session.id,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      expiresAt: session.expiresAt,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
    }).from(session).where(and(
      eq(session.userId, userId),
      gt(session.expiresAt, new Date()),
    )).orderBy(desc(session.createdAt)).limit(100);
    return successResponse<AdminSessionsData>({ sessions: sessions.map(toAdminSessionData) }, requestId);
  } catch (error) {
    return failureResponse(error, requestId, route, startedAt);
  }
}

export async function handleUpdateAdminUser(
  request: Request,
  userId: string,
  route: AdminUserRoute = "/api/admin/users/[id]",
) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSameOrigin(request);
    const body = await readJsonBody(request, 16 * 1024) as {
      banned?: unknown;
      isAdmin?: unknown;
      isReviewer?: unknown;
      reason?: unknown;
    } | null;
    const changesBanned = typeof body?.banned === "boolean";
    const changesAdmin = typeof body?.isAdmin === "boolean";
    const changesReviewer = typeof body?.isReviewer === "boolean";
    if ([changesBanned, changesAdmin, changesReviewer].filter(Boolean).length !== 1) throw new PublicApiError("AIC-REQ-1001");
    if (body?.isAdmin !== undefined && !changesAdmin) throw new PublicApiError("AIC-REQ-1001");
    if (body?.isReviewer !== undefined && !changesReviewer) throw new PublicApiError("AIC-REQ-1001");
    if (body?.banned !== undefined && !changesBanned) throw new PublicApiError("AIC-REQ-1001");
    if (body?.reason !== undefined && typeof body.reason !== "string") throw new PublicApiError("AIC-REQ-1001");
    if (typeof body?.reason === "string" && body.reason.length > 300) throw new PublicApiError("AIC-REQ-1001");
    await applyAdminUserMutation(request, userId, changesAdmin
      ? { kind: "admin", enabled: body?.isAdmin as boolean }
      : changesReviewer
        ? { kind: "reviewer", enabled: body?.isReviewer as boolean }
        : { kind: "banned", enabled: body?.banned as boolean, reason: body?.reason as string | undefined });
    return successResponse<AdminUserUpdateData>({ updated: true }, requestId);
  } catch (error) {
    return failureResponse(error, requestId, route, startedAt);
  }
}

export async function handleDeleteAdminUserSessions(
  request: Request,
  userId: string,
  route: AdminUserRoute = "/api/admin/users/[id]/sessions",
) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    await assertEmptyBody(request, 1024);
    await applyAdminUserMutation(request, userId, { kind: "revokeSessions" });
    return successResponse<AdminUserUpdateData>({ updated: true }, requestId);
  } catch (error) {
    return failureResponse(error, requestId, route, startedAt);
  }
}

export async function handleLegacyAdminUsersGet(request: Request) {
  const userId = new URL(request.url).searchParams.get("userId")?.trim();
  if (!userId) return handleListAdminUsers(request);
  return deprecated(
    await handleListAdminUserSessions(request, userId, "/api/admin/users"),
    `${userPath(userId)}/sessions`,
  );
}

export async function handleLegacyAdminUsersPost(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  let successor = "/api/admin/users";
  try {
    assertSameOrigin(request);
    const body = await readJsonBody(request, 16 * 1024) as {
      userId?: unknown;
      action?: unknown;
      reason?: unknown;
    } | null;
    const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
    const action = typeof body?.action === "string" ? body.action : "";
    if (!userId || !["ban", "unban", "revokeSessions", "grantAdmin", "revokeAdmin"].includes(action)) {
      throw new PublicApiError("AIC-REQ-1001");
    }
    const validatedAction = action as AdminUserAction;
    const mutation: AdminUserMutation = validatedAction === "revokeSessions"
      ? { kind: "revokeSessions" }
      : validatedAction === "grantAdmin" || validatedAction === "revokeAdmin"
        ? { kind: "admin", enabled: validatedAction === "grantAdmin" }
        : {
            kind: "banned",
            enabled: validatedAction === "ban",
            reason: typeof body?.reason === "string" ? body.reason : undefined,
          };
    successor = validatedAction === "revokeSessions"
      ? `${userPath(userId)}/sessions`
      : userPath(userId);
    await applyAdminUserMutation(request, userId, mutation);
    return deprecated(successResponse<AdminUserUpdateData>({ updated: true }, requestId), successor);
  } catch (error) {
    return deprecated(failureResponse(error, requestId, "/api/admin/users", startedAt), successor);
  }
}
