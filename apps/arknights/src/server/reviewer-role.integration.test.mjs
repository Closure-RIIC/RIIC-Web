import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import process from "node:process";
import test from "node:test";
import { hashPassword } from "better-auth/crypto";

/* global Request */
const marker = registerHooks({
  resolve(specifier, context, next) {
    return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context);
  },
});
process.once("exit", () => marker.deregister());
const databaseUrl = process.env.AUTH_INTEGRATION_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("AUTH_INTEGRATION_DATABASE_URL is required for reviewer integration tests.");
const origin = "http://127.0.0.1:5197";
const bootstrapId = `review-bootstrap-${randomUUID()}`;
process.env.DATABASE_URL = databaseUrl;
process.env.APP_DEPLOYMENT_ENV = "local";
process.env.BETTER_AUTH_URL = origin;
process.env.BETTER_AUTH_SECRET = "reviewer-integration-secret-not-for-production";
process.env.BETTER_AUTH_ADMIN_USER_IDS = bootstrapId;
process.env.BETA_PUBLIC_ORIGIN = origin;
process.env.BETA_RATE_LIMIT_ENABLED = "0";
process.env.BETA_BUSINESS_DB_ENABLED = "1";
process.env.BETA_BUSINESS_DB_READ_ENABLED = "1";
const { getDatabasePool } = await import("./db/index.ts");
const { getAuth } = await import("./auth/index.ts");
const { requireWebsiteAdmin, requireWebsiteReviewer } = await import("./auth/authorization.ts");
const { handleListAdminUsers, handleUpdateAdminUser, handleListAdminUserSessions, handleDeleteAdminUserSessions, handleLegacyAdminUsersPost } = await import("./admin-users-api.ts");
const { handleListAdminRecords, handleUpdateAdminFeedback, handleGetAdminFeedbackDetail, handleGetAdminPlanRunDetail } = await import("./admin-records-api.ts");
const { handleGetAdminSolverMetrics } = await import("./admin-solver-metrics-api.ts");
const { handleAdminReleases } = await import("./release-notes-api.ts");

test("reviewer roles enforce real-session API boundaries and take effect without signing in again", async () => {
  const pool = getDatabasePool();
  const targetId = `review-target-${randomUUID()}`;
  const adminId = `review-admin-${randomUUID()}`;
  const password = "Reviewer-Integration-2026!";
  function request(cookie, body, path = "/api/admin/users", method = body === undefined ? "GET" : "PATCH") {
    return new Request(`${origin}${path}`, {
      method, headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function status(response, expected = 200) {
    assert.equal(response.status, expected, await response.clone().text());
    return response.json();
  }
  async function login(id) {
    const response = await getAuth().handler(request(undefined, { email: `${id}@example.test`, password }, "/api/auth/sign-in/email", "POST"));
    assert.equal(response.status, 200, await response.clone().text());
    return response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
  }
  try {
    const hash = await hashPassword(password);
    for (const [id, role] of [[bootstrapId, "user"], [targetId, "user"], [adminId, "admin"]]) {
      await pool.query('INSERT INTO "user" (id,name,email,email_verified,role) VALUES ($1,$2,$3,true,$4)', [id, "Reviewer test", `${id}@example.test`, role]);
      await pool.query("INSERT INTO account (id,account_id,provider_id,user_id,password) VALUES ($1,$2,'credential',$2,$3)", [randomUUID(), id, hash]);
    }
    const bootstrapCookie = await login(bootstrapId);
    const targetCookie = await login(targetId);
    const adminCookie = await login(adminId);
    await assert.rejects(requireWebsiteReviewer(request(targetCookie)));
    await status(await handleUpdateAdminUser(request(targetCookie, { isAdmin: true }), targetId), 403);
    const adminUsers = await status(await handleListAdminUsers(request(adminCookie)));
    assert.equal(adminUsers.data.permissions.canManageAdminRoles, true);
    assert.ok(Number.isInteger(adminUsers.data.summary.verifiedUsers));
    assert.ok(adminUsers.data.summary.verifiedUsers >= 3);
    const emptySearch = await status(await handleListAdminUsers(request(adminCookie, undefined, `/api/admin/users?q=missing-${randomUUID()}`)));
    assert.equal(emptySearch.data.users.length, 0);
    assert.ok(emptySearch.data.summary.verifiedUsers >= 3, "verified total is global even when no users match the search");
    await status(await handleUpdateAdminUser(request(adminCookie, { isAdmin: false }), bootstrapId), 403);
    await status(await handleUpdateAdminUser(request(adminCookie, { isReviewer: true }), bootstrapId), 403);
    await status(await handleUpdateAdminUser(request(adminCookie, { isAdmin: true }), targetId));
    assert.equal((await requireWebsiteAdmin(request(targetCookie))).canManageAdminRoles, true);
    await status(await handleUpdateAdminUser(request(adminCookie, { isAdmin: false }), targetId));
    await assert.rejects(requireWebsiteAdmin(request(targetCookie)));
    await status(await handleLegacyAdminUsersPost(request(adminCookie, { userId: targetId, action: "grantAdmin" })));
    assert.equal((await requireWebsiteAdmin(request(targetCookie))).isAdmin, true);
    await status(await handleLegacyAdminUsersPost(request(adminCookie, { userId: targetId, action: "revokeAdmin" })));
    await assert.rejects(requireWebsiteAdmin(request(targetCookie)));
    await status(await handleUpdateAdminUser(request(bootstrapCookie, { isReviewer: true }), bootstrapId), 403);
    await status(await handleUpdateAdminUser(request(bootstrapCookie, { isReviewer: true, isAdmin: true }), targetId), 400);
    await pool.query('UPDATE "user" SET email_verified=false WHERE id=$1', [targetId]);
    await status(await handleUpdateAdminUser(request(adminCookie, { isReviewer: true }), targetId), 400);
    await pool.query('UPDATE "user" SET email_verified=true, banned=true WHERE id=$1', [targetId]);
    await status(await handleUpdateAdminUser(request(adminCookie, { isReviewer: true }), targetId), 400);
    await pool.query('UPDATE "user" SET banned=false WHERE id=$1', [targetId]);
    await status(await handleUpdateAdminUser(request(adminCookie, { isReviewer: true }), targetId));
    const access = await requireWebsiteReviewer(request(targetCookie));
    assert.equal(access.isReviewer, true);
    assert.equal(access.isAdmin, false);
    await assert.rejects(requireWebsiteAdmin(request(targetCookie)));
    const users = await status(await handleListAdminUsers(request(bootstrapCookie)));
    assert.equal(users.data.users.find(user => user.id === targetId).isReviewer, true);
    for (const cookie of [undefined, targetCookie]) {
      const denied = cookie ? 403 : 401;
      await status(await handleListAdminUsers(request(cookie)), denied);
      await status(await handleListAdminUserSessions(request(cookie), adminId), denied);
      await status(await handleDeleteAdminUserSessions(request(cookie, undefined, "/api/admin/users/x/sessions", "DELETE"), adminId), denied);
      await status(await handleUpdateAdminUser(request(cookie, { isAdmin: true }), targetId), denied);
      await status(await handleUpdateAdminUser(request(cookie, { banned: true }), adminId), denied);
      await status(await handleLegacyAdminUsersPost(request(cookie, { userId: targetId, action: "grantAdmin" })), denied);
      await status(await handleAdminReleases(request(cookie, undefined, "/api/admin/releases")), denied);
    }
    await status(await handleGetAdminSolverMetrics(request(targetCookie, undefined, "/api/admin/solver-metrics")));
    await status(await handleListAdminRecords(request(targetCookie), "feedback", "/api/admin/feedback"));
    await status(await handleListAdminRecords(request(targetCookie), "runs", "/api/admin/plan-runs"));
    await status(await handleGetAdminFeedbackDetail(request(targetCookie), "missing-review-test"), 404);
    await status(await handleGetAdminPlanRunDetail(request(targetCookie), "missing-review-test"), 404);
    await status(await handleUpdateAdminFeedback(request(targetCookie, { status: "fixed" }), "missing-review-test"), 404);
    await status(await handleUpdateAdminUser(request(bootstrapCookie, { isReviewer: false }), targetId));
    await assert.rejects(requireWebsiteReviewer(request(targetCookie)));
    await status(await handleGetAdminSolverMetrics(request(targetCookie)), 403);
    await status(await handleUpdateAdminUser(request(bootstrapCookie, { isAdmin: true }), targetId));
    assert.equal((await requireWebsiteAdmin(request(targetCookie))).isAdmin, true);
    await status(await handleUpdateAdminUser(request(bootstrapCookie, { isReviewer: true }), targetId));
    await assert.rejects(requireWebsiteAdmin(request(targetCookie)));
    // A stale revoke-admin request must not remove a newly assigned reviewer role.
    await status(await handleUpdateAdminUser(request(bootstrapCookie, { isAdmin: false }), targetId));
    assert.equal((await requireWebsiteReviewer(request(targetCookie))).isReviewer, true);
  } finally {
    await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [[bootstrapId, targetId, adminId]]);
    await pool.end();
  }
});
