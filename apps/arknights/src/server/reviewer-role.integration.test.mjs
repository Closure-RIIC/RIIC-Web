import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import process from "node:process";
import test from "node:test";

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
process.env.BETA_TRUST_PROXY_HEADERS = "1";
process.env.BETA_RATE_LIMIT_ENABLED = "0";
process.env.BETA_BUSINESS_DB_ENABLED = "1";
process.env.BETA_BUSINESS_DB_READ_ENABLED = "1";
const { getDatabasePool } = await import("@riic/platform-server/db");
const { requireWebsiteAdmin, requireWebsiteReviewer, requireWebsiteSuperAdmin } = await import("@riic/platform-server/auth/authorization");
const { handleGetAdminPermissions, handleListAdminUsers, handleUpdateAdminUser, handleListAdminUserSessions, handleDeleteAdminUserSessions, handleLegacyAdminUsersPost } = await import("./admin-users-api.ts");
const { handleListAdminRecords, handleUpdateAdminFeedback, handleGetAdminFeedbackDetail, handleGetAdminPlanRunDetail } = await import("./admin-records-api.ts");
const { handleGetAdminSolverMetrics } = await import("./admin-solver-metrics-api.ts");
const { handleAdminReleases } = await import("./release-notes-api.ts");

test("reviewer roles enforce real-session API boundaries and take effect without signing in again", async () => {
  const pool = getDatabasePool();
  const targetId = `review-target-${randomUUID()}`;
  const adminId = `review-admin-${randomUUID()}`;
  const missingId = `review-missing-${randomUUID()}`;
  const newerIds = Array.from({ length: 101 }, () => `review-newer-${randomUUID()}`);
  let ip = 1;
  function request(cookie, body, path = "/api/admin/users", method = body === undefined ? "GET" : "PATCH") {
    return new Request(`${origin}${path}`, {
      method, headers: { origin, "content-type": "application/json", "x-real-ip": `198.51.100.${ip++}`, ...(cookie ? { cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function status(response, expected = 200) {
    assert.equal(response.status, expected, await response.clone().text());
    return response.json();
  }
  async function login(id) {
    const token = randomUUID();
    await pool.query("INSERT INTO session (id,user_id,token,expires_at) VALUES ($1,$2,$3,now()+interval '1 hour')", [randomUUID(), id, token]);
    const signature = createHmac("sha256", process.env.BETTER_AUTH_SECRET).update(token).digest("base64");
    return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
  }
  try {
    for (const [id, role] of [[bootstrapId, "user"], [targetId, "user"], [adminId, "admin"]]) {
      await pool.query('INSERT INTO "user" (id,name,email,email_verified,role) VALUES ($1,$2,$3,true,$4)', [id, "Reviewer test", `${id}@example.test`, role]);
    }
    const bootstrapCookie = await login(bootstrapId);
    const targetCookie = await login(targetId);
    const adminCookie = await login(adminId);
    const permissionsRequest = cookie => request(cookie, undefined, "/api/admin/permissions");
    for (const [cookie, expected] of [[undefined, 401], [targetCookie, 403], [adminCookie, 403]]) {
      const denied = await handleGetAdminPermissions(permissionsRequest(cookie));
      assert.match(denied.headers.get("cache-control"), /no-store/);
      await status(denied, expected);
    }
    // The server roster is complete even when the root account is absent from
    // the normal users endpoint's latest-100 window, and retains missing IDs.
    await pool.query(`UPDATE "user" SET created_at=now()-interval '1 day' WHERE id=$1`, [bootstrapId]);
    await pool.query(`INSERT INTO "user" (id,name,email,email_verified,role)
      SELECT id,'Newer roster fixture',id||'@example.test',true,'user' FROM unnest($1::text[]) AS fixture(id)`, [newerIds]);
    const recentUsers = await status(await handleListAdminUsers(request(bootstrapCookie)));
    assert.equal(recentUsers.data.users.length, 100);
    assert.ok(!recentUsers.data.users.some(user => user.id === bootstrapId));
    process.env.BETTER_AUTH_ADMIN_USER_IDS = `${missingId}, ${bootstrapId}, ${missingId}`;
    const rosterResponse = await handleGetAdminPermissions(permissionsRequest(bootstrapCookie));
    assert.match(rosterResponse.headers.get("cache-control"), /no-store/);
    const roster = (await status(rosterResponse)).data.superAdmins;
    assert.deepEqual(roster.map(entry => entry.id), [missingId, bootstrapId]);
    assert.deepEqual(roster[0], { id: missingId, name: null, email: null, banned: null, exists: false });
    assert.equal(roster[1].exists, true);
    assert.equal(roster[1].name, "Reviewer test");
    assert.equal(roster[1].email, `${bootstrapId}@example.test`);
    assert.ok(!roster[1].banned);
    assert.deepEqual(Object.keys(roster[1]).sort(), ["banned", "email", "exists", "id", "name"]);
    process.env.BETTER_AUTH_ADMIN_USER_IDS = bootstrapId;
    await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [newerIds]);
    assert.equal((await requireWebsiteSuperAdmin(request(bootstrapCookie))).isSuperAdmin, true);
    await assert.rejects(requireWebsiteSuperAdmin(request(adminCookie)));
    for (const privileged of [bootstrapId, adminId]) {
      await status(await handleListAdminUserSessions(request(adminCookie), privileged), 403);
      await status(await handleDeleteAdminUserSessions(request(adminCookie, undefined, "/api/admin/users/x/sessions", "DELETE"), privileged), 403);
      await status(await handleUpdateAdminUser(request(adminCookie, { banned: true }), privileged), privileged === adminId ? 400 : 403);
      await status(await handleUpdateAdminUser(request(adminCookie, { banned: false }), privileged), 403);
    }
    await status(await handleListAdminUserSessions(request(adminCookie), targetId));
    await pool.query('UPDATE "user" SET banned=true WHERE id=$1', [bootstrapId]);
    await assert.rejects(requireWebsiteSuperAdmin(request(bootstrapCookie)));
    await status(await handleGetAdminPermissions(permissionsRequest(bootstrapCookie)), 403);
    await pool.query('UPDATE "user" SET banned=false WHERE id=$1', [bootstrapId]);
    process.env.BETTER_AUTH_ADMIN_USER_IDS = "";
    await assert.rejects(requireWebsiteSuperAdmin(request(bootstrapCookie)));
    await status(await handleGetAdminPermissions(permissionsRequest(bootstrapCookie)), 403);
    process.env.BETTER_AUTH_ADMIN_USER_IDS = bootstrapId;
    await pool.query('UPDATE session SET impersonated_by=$1 WHERE user_id=$2', [adminId, bootstrapId]);
    await assert.rejects(requireWebsiteSuperAdmin(request(bootstrapCookie)));
    await pool.query('UPDATE session SET impersonated_by=NULL WHERE user_id=$1', [bootstrapId]);
    await assert.rejects(requireWebsiteReviewer(request(targetCookie)));
    await status(await handleUpdateAdminUser(request(targetCookie, { isAdmin: true }), targetId), 403);
    const adminUsers = await status(await handleListAdminUsers(request(adminCookie)));
    assert.equal(adminUsers.data.permissions.canManageAdminRoles, false);
    assert.ok(Number.isInteger(adminUsers.data.summary.verifiedUsers));
    assert.ok(adminUsers.data.summary.verifiedUsers >= 3);
    const emptySearch = await status(await handleListAdminUsers(request(adminCookie, undefined, `/api/admin/users?q=missing-${randomUUID()}`)));
    assert.equal(emptySearch.data.users.length, 0);
    assert.ok(emptySearch.data.summary.verifiedUsers >= 3, "verified total is global even when no users match the search");
    await status(await handleUpdateAdminUser(request(adminCookie, { isAdmin: false }), bootstrapId), 403);
    await status(await handleUpdateAdminUser(request(adminCookie, { isReviewer: true }), bootstrapId), 403);
    await status(await handleUpdateAdminUser(request(adminCookie, { isAdmin: true }), targetId), 403);
    await status(await handleUpdateAdminUser(request(bootstrapCookie, { isAdmin: true }), targetId));
    assert.equal((await requireWebsiteAdmin(request(targetCookie))).canManageAdminRoles, false);
    await status(await handleUpdateAdminUser(request(bootstrapCookie, { isAdmin: false }), targetId));
    await assert.rejects(requireWebsiteAdmin(request(targetCookie)));
    await status(await handleLegacyAdminUsersPost(request(bootstrapCookie, { userId: targetId, action: "grantAdmin" })));
    assert.equal((await requireWebsiteAdmin(request(targetCookie))).isAdmin, true);
    await status(await handleLegacyAdminUsersPost(request(bootstrapCookie, { userId: targetId, action: "revokeAdmin" })));
    await assert.rejects(requireWebsiteAdmin(request(targetCookie)));
    await status(await handleUpdateAdminUser(request(bootstrapCookie, { isReviewer: true }), bootstrapId), 403);
    await status(await handleUpdateAdminUser(request(bootstrapCookie, { isReviewer: true, isAdmin: true }), targetId), 400);
    await pool.query('UPDATE "user" SET email_verified=false WHERE id=$1', [targetId]);
    await status(await handleUpdateAdminUser(request(bootstrapCookie, { isReviewer: true }), targetId), 400);
    await pool.query('UPDATE "user" SET email_verified=true, banned=true WHERE id=$1', [targetId]);
    await status(await handleUpdateAdminUser(request(bootstrapCookie, { isReviewer: true }), targetId), 400);
    await pool.query('UPDATE "user" SET banned=false WHERE id=$1', [targetId]);
    await status(await handleUpdateAdminUser(request(bootstrapCookie, { isReviewer: true }), targetId));
    const access = await requireWebsiteReviewer(request(targetCookie));
    assert.equal(access.isReviewer, true);
    assert.equal(access.isAdmin, false);
    await assert.rejects(requireWebsiteAdmin(request(targetCookie)));
    await status(await handleGetAdminPermissions(permissionsRequest(targetCookie)), 403);
    const users = await status(await handleListAdminUsers(request(bootstrapCookie, undefined, `/api/admin/users?q=${targetId}`)));
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
    await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [[bootstrapId, targetId, adminId, ...newerIds]]);
    await pool.end();
  }
});
