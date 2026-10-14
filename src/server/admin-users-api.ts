import "@tanstack/react-start/server-only";

import { and, count, desc, eq, gt, ilike, or } from "drizzle-orm";

import type {
  AdminSessionsData,
  AdminUserAction,
  AdminUsersData,
  AdminUserUpdateData,
} from "@/types";
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
} from "./api-contract";
import {
  canChangeWebsiteAdminRole,
  canModerateWebsiteUser,
  isEligibleForWebsiteAdmin,
  WEBSITE_ADMIN_ROLE,
  WEBSITE_REVIEWER_ROLE,
  WEBSITE_USER_ROLE,
  websiteAdminAccess,
} from "./auth/admin-access";
import { toAdminSessionData, toAdminUserData } from "./auth/admin-dto";
import { requireWebsiteAdmin } from "./auth/authorization";
import { configuredAdminIds } from "./auth/config";
import { getDatabase } from "./db";
import { billingWallet, session, user } from "./db/schema";
import { sklandBindingSummariesByUserIds } from "./skland/bindings";

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

  const [targetRecord] = await getDatabase().select({
    id: user.id,
    role: user.role,
    emailVerified: user.emailVerified,
    banned: user.banned,
  }).from(user).where(eq(user.id, userId)).limit(1);
  if (!targetRecord) throw new PublicApiError("AIC-REQ-1001", { message: "目标用户不存在。" });
  const targetAccess = websiteAdminAccess(targetRecord.id, targetRecord.role);

  if (mutation.kind === "admin" || mutation.kind === "reviewer") {
    if (!canChangeWebsiteAdminRole(actor, targetAccess)) {
      throw new PublicApiError("AIC-AUTH-2009", {
        message: targetAccess.isBootstrapAdmin
          ? "初始管理员权限只能通过服务器环境变量调整。"
          : "只有管理员可以调整后台角色。",
      });
    }
    if (mutation.enabled && !isEligibleForWebsiteAdmin(targetRecord.emailVerified, targetRecord.banned)) {
      throw new PublicApiError("AIC-REQ-1001", { message: "只能将已验证且未封禁的账号设为管理员或审阅人。" });
    }
    const role = mutation.kind === "admin" ? WEBSITE_ADMIN_ROLE : WEBSITE_REVIEWER_ROLE;
    // Revoking one role must not silently revoke a different role assigned meanwhile.
    if (!mutation.enabled && targetRecord.role !== role) return;
    await getDatabase().update(user).set({
      role: mutation.enabled ? role : WEBSITE_USER_ROLE,
      updatedAt: new Date(),
    }).where(eq(user.id, userId));
    return;
  }

  if (mutation.kind === "revokeSessions") {
    if (!canModerateWebsiteUser(actor, targetAccess)) {
      throw new PublicApiError("AIC-AUTH-2009", { message: "受委派管理员不能撤销初始管理员的 Session。" });
    }
    await getDatabase().delete(session).where(eq(session.userId, userId));
    return;
  }

  if (userId === actor.userId && mutation.enabled) {
    throw new PublicApiError("AIC-REQ-1001", { message: "不能封禁当前管理员账号。" });
  }
  if (mutation.enabled && !canModerateWebsiteUser(actor, targetAccess)) {
    throw new PublicApiError("AIC-AUTH-2009", { message: "受委派管理员不能封禁初始管理员。" });
  }
  await getDatabase().update(user).set(mutation.enabled ? {
    banned: true,
    banReason: mutation.reason?.slice(0, 300) || "管理员封禁",
    updatedAt: new Date(),
  } : {
    banned: false,
    banReason: null,
    banExpires: null,
    updatedAt: new Date(),
  }).where(eq(user.id, userId));
  if (mutation.enabled) await getDatabase().delete(session).where(eq(session.userId, userId));
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
        }, bootstrapAdminIds);
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
    await requireWebsiteAdmin(request);
    enforceRateLimit("admin-users", requestClientIp(request), 60, 10 * 60_000);
    if (!userId || userId.length > 100) throw new PublicApiError("AIC-REQ-1001");
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
