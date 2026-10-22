import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import process from "node:process";
import test from "node:test";
import { hashPassword } from "better-auth/crypto";

/* global Request */
// Only bypass Start's server-only import marker. Authentication, authorization and PostgreSQL are real.
const marker = registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === "@tanstack/react-start/server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : nextResolve(specifier, context);
  },
});
process.once("exit", () => marker.deregister());
const databaseUrl = process.env.AUTH_INTEGRATION_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("AUTH_INTEGRATION_DATABASE_URL is required for release-note integration tests.");
process.env.DATABASE_URL = databaseUrl;
process.env.APP_DEPLOYMENT_ENV = "local";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:5194";
process.env.BETTER_AUTH_SECRET = "release-integration-secret-not-for-production-only";
process.env.BETTER_AUTH_ADMIN_USER_IDS = "";
process.env.BETA_PUBLIC_ORIGIN = "http://127.0.0.1:5194";
const { getDatabasePool } = await import("@riic/platform-server/db");
const { getAuth } = await import("@riic/platform-server/auth");
const { handleAdminReleases, handleAdminReleaseMutation, handlePublicReleases } = await import("./release-notes-api.ts");
const { createRelease, listPublishedReleases, mutateRelease, ReleaseConflictError } = await import("./release-notes.ts");

test("release lifecycle protects drafts, environment boundaries, permissions and concurrent edits", async () => {
  const pool = getDatabasePool();
  const suffix = randomUUID();
  const adminId = `release-admin-${suffix}`;
  const userId = `release-user-${suffix}`;
  const password = "Release-Integration-2026!";
  const origin = process.env.BETTER_AUTH_URL;
  let ip = 1;
  function request(method = "GET", body, cookie, path = "/api/admin/releases", source = origin) {
    return new Request(`${origin}${path}`, {
      method, headers: { origin: source, "content-type": "application/json", "x-forwarded-for": `192.0.2.${ip++}`, ...(cookie ? { cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function decoded(response, status = 200, isPublic = false) {
    assert.equal(response.status, status, await response.clone().text());
    assert.match(response.headers.get("cache-control"), isPublic ? /public, max-age=15, must-revalidate/ : /no-store/);
    const body = await response.json();
    assert.ok(body.success ? body.requestId : body.error.requestId);
    return body;
  }
  const draft = {
    version: "999999.1.0", date: "2020-01-01", title: { zh: "integration draft", en: "" }, notify: true,
    sections: [{ kind: "added", items: [{ zh: "test content", en: "" }] }],
  };
  try {
    const hash = await hashPassword(password);
    for (const [id, role] of [[adminId, "admin"], [userId, "user"]]) {
      await pool.query('INSERT INTO "user" (id,name,email,email_verified,role) VALUES ($1,$2,$3,true,$4)', [id, role, `${id}@example.test`, role]);
      await pool.query('INSERT INTO account (id,account_id,provider_id,user_id,password) VALUES ($1,$2,\'credential\',$2,$3)', [randomUUID(), id, hash]);
    }
    async function login(id) {
      const response = await getAuth().handler(request("POST", { email: `${id}@example.test`, password }, undefined, "/api/auth/sign-in/email"));
      assert.equal(response.status, 200, await response.clone().text());
      return response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    }
    const adminCookie = await login(adminId);
    const userCookie = await login(userId);
    for (const cookie of [undefined, userCookie]) {
      const status = cookie ? 403 : 401;
      await decoded(await handleAdminReleases(request("GET", undefined, cookie)), status);
      await decoded(await handleAdminReleases(request("POST", draft, cookie)), status);
      await decoded(await handleAdminReleaseMutation(request("PATCH", { action: "publish", revision: 1 }, cookie), "missing"), status);
    }
    await decoded(await handleAdminReleases(request("POST", draft, adminCookie, "/api/admin/releases", "https://evil.example")), 403);
    await decoded(await handleAdminReleases(request("POST", { ...draft, environment: "production" }, adminCookie)), 400);
    let row = (await decoded(await handleAdminReleases(request("POST", draft, adminCookie)), 201)).data.release;
    await decoded(await handleAdminReleases(request("POST", draft, adminCookie)), 409);
    assert.equal((await listPublishedReleases("local")).some((note) => note.version === draft.version), false);
    const dev = await createRelease("development", { ...draft, title: { zh: "development only", en: "" } }, adminId);
    await mutateRelease("development", dev.id, { action: "publish", revision: dev.revision }, adminId);
    await decoded(await handleAdminReleaseMutation(request("PATCH", { action: "publish", revision: dev.revision }, adminCookie), dev.id), 404);
    const adminList = (await decoded(await handleAdminReleases(request("GET", undefined, adminCookie)))).data;
    assert.equal(adminList.environment, "local");
    assert.equal(adminList.releases.some((note) => note.id === dev.id), false);

    async function mutation(action, extra = {}, status = 200) {
      const body = await decoded(await handleAdminReleaseMutation(request("PATCH", { action, revision: row.revision, ...extra }, adminCookie), row.id), status);
      if (body.success && body.data.release) row = body.data.release;
      return body;
    }
    await mutation("publish");
    const publicBody = (await decoded(await handlePublicReleases(request("GET", undefined, undefined, "/api/releases?environment=development")), 200, true)).data;
    assert.equal(publicBody.environment, "local");
    assert.equal(publicBody.releases[0].title.zh, "integration draft");
    for (const note of publicBody.releases) {
      for (const key of ["id", "draft", "revision", "createdByUserId", "updatedByUserId"]) assert.equal(key in note, false);
    }
    const edited = { ...draft, title: { zh: "not published yet", en: "" }, notify: false };
    await mutation("save", { draft: edited });
    assert.equal((await listPublishedReleases("local"))[0].title.zh, draft.title.zh);
    await mutation("publish", { revision: row.revision - 1 }, 409);
    await mutation("save", { draft: { ...edited, version: "999999.2.0" } }, 400);
    await mutation("publish");
    assert.equal((await listPublishedReleases("local"))[0].title.zh, edited.title.zh);
    const announcement = (await decoded(await handlePublicReleases(request("GET", undefined, undefined, "/api/releases?mode=announcement")), 200, true)).data;
    assert.equal(announcement.releases.some((note) => note.version === draft.version), false);
    await mutation("delete", {}, 400);
    await mutation("withdraw");
    assert.equal((await listPublishedReleases("local")).some((note) => note.version === draft.version), false);
    await mutation("delete", {}, 400);
    await mutation("publish");
    assert.equal((await listPublishedReleases("local"))[0].title.zh, edited.title.zh);
    await mutation("withdraw");

    const pending = await createRelease("local", { ...draft, version: "999999.2.0", date: "2099-01-01" }, adminId);
    const conflict = await Promise.allSettled([
      mutateRelease("local", pending.id, { action: "save", revision: 1, draft: { ...pending.draft, title: { zh: "concurrent A", en: "" } } }, adminId),
      mutateRelease("local", pending.id, { action: "save", revision: 1, draft: { ...pending.draft, title: { zh: "concurrent B", en: "" } } }, adminId),
    ]);
    assert.equal(conflict.filter((value) => value.status === "fulfilled").length, 1);
    assert.ok(conflict.find((value) => value.status === "rejected").reason instanceof ReleaseConflictError);
    await assert.rejects(mutateRelease("local", pending.id, { action: "publish", revision: 2 }, adminId), /尚未到来/);
    assert.equal(await mutateRelease("local", pending.id, { action: "delete", revision: 2 }, adminId), null);
  } finally {
    await pool.query('DELETE FROM app.release_note WHERE created_by_user_id=$1', [adminId]);
    await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [[adminId, userId]]);
    await pool.end();
  }
});
