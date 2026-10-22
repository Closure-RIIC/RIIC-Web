import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { hashPassword } from "better-auth/crypto";
import { Pool } from "pg";

/* global fetch, AbortSignal */
const databaseUrl = process.env.AUTH_INTEGRATION_DATABASE_URL?.trim();
assert.ok(databaseUrl && /(?:test|integration)/i.test(new URL(databaseUrl).pathname), "An explicitly isolated test database is required");
const root = fileURLToPath(new URL("../", import.meta.url));
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const userId = randomUUID(), email = `${userId}@example.test`, password = "Disposable-platform-password-1!";
const socket = createServer();
await new Promise((resolve, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", resolve); });
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
let child;
try {
  await pool.query('INSERT INTO "user" (id, name, email, email_verified) VALUES ($1, $2, $3, true)', [userId, "Platform integration", email]);
  await pool.query('INSERT INTO account (id, account_id, provider_id, user_id, password) VALUES ($1, $2, $3, $2, $4)', [randomUUID(), userId, "credential", await hashPassword(password)]);
  child = spawn(process.execPath, ["services/platform-api/dist/server.mjs"], {
    cwd: root, windowsHide: true, stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, NODE_ENV: "production", APP_DEPLOYMENT_ENV: "production", PLATFORM_HOST: "127.0.0.1", PLATFORM_PORT: String(port),
      DATABASE_URL: databaseUrl, DATABASE_MIGRATION_URL: "", BETTER_AUTH_SECRET: "disposable-platform-integration-secret-32-bytes",
      BETTER_AUTH_URL: "https://arknights.example.test", AUTH_COOKIE_DOMAIN: "example.test",
      PLATFORM_PUBLIC_ORIGINS: "https://arknights.example.test,https://endfield.example.test", BETA_TRUST_PROXY_HEADERS: "1",
      BETA_RATE_LIMIT_ENABLED: "0", RESEND_API_KEY: "", AUTH_EMAIL_FROM: "", SKLAND_SESSION_SECRET: "" },
  });
  let errors = "";
  child.stderr.on("data", chunk => { errors = (errors + chunk).slice(-3000); });
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`Platform exited: ${errors}`);
    try { ready = (await fetch(origin + "/api/platform/health", { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Wait for our isolated service. */ }
    if (ready) break;
    await setTimeout(100);
  }
  assert.ok(ready);
  const request = (app, path, { cookie, body, method = body === undefined ? "GET" : "POST" } = {}) => fetch(origin + path, {
    method,
    headers: { "x-forwarded-host": `${app}.example.test`, "x-forwarded-proto": "https", origin: `https://${app}.example.test`,
      ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });
  const login = await request("arknights", "/api/auth/sign-in/email", { body: { email, password } });
  assert.equal(login.status, 200, await login.clone().text());
  const cookie = login.headers.getSetCookie().find(value => value.startsWith("__Secure-better-auth.session_token=") && /;\s*Domain=example\.test/i.test(value));
  assert.ok(cookie, "Login sets a shared secure domain cookie");
  assert.match(cookie, /;\s*HttpOnly/i);
  const token = cookie.split(";", 1)[0];
  const accessPath = "/api/platform/endfield-access";
  assert.equal((await request("endfield", accessPath)).status, 403);
  assert.equal((await request("endfield", accessPath, { cookie: token })).status, 403);
  await pool.query('UPDATE "user" SET role = $2 WHERE id = $1', [userId, "admin"]);
  for (const app of ["arknights", "endfield"]) {
    assert.equal((await request(app, accessPath, { cookie: token })).status, 204);
  }
  await pool.query('UPDATE "user" SET banned = true WHERE id = $1', [userId]);
  assert.equal((await request("endfield", accessPath, { cookie: token })).status, 403);
  await pool.query('UPDATE "user" SET role = $2, banned = false WHERE id = $1', [userId, "user"]);
  assert.equal((await request("endfield", accessPath, { cookie: token })).status, 403);
  for (const app of ["arknights", "endfield"]) {
    for (const path of ["/api/auth/get-session", "/api/platform/session"]) {
      const response = await request(app, path, { cookie: token });
      assert.equal(response.status, 200);
      const value = await response.json();
      assert.equal(value.user.id, userId);
      assert.deepEqual(Object.keys(value.session), ["expiresAt"], "Public session does not leak tokens or IDs");
    }
  }
  const extended = await request("endfield", "/api/account/session/extend", { cookie: token, method: "POST" });
  assert.equal(extended.status, 200, await extended.clone().text());
  assert.ok(extended.headers.getSetCookie().some(value => /;\s*Domain=example\.test/i.test(value)), "Renewal preserves the shared domain");
  assert.ok(extended.headers.getSetCookie().some(value => /Max-Age=0/.test(value) && !/;\s*Domain=/i.test(value)), "Renewal clears the legacy host-only cookie");
  const signout = await request("endfield", "/api/auth/sign-out", { cookie: token, body: {} });
  assert.equal(signout.status, 200, await signout.clone().text());
  for (const app of ["arknights", "endfield"]) {
    assert.equal(await (await request(app, "/api/auth/get-session", { cookie: token })).json(), null, "Logout invalidates the session for both apps");
  }
  process.stdout.write("Platform auth passed: shared login, public session isolation, cross-app renewal, legacy cookie cleanup and logout against an isolated database.\n");
} finally {
  if (child && child.exitCode === null) {
    const ended = new Promise(resolve => child.once("exit", resolve));
    child.kill(); await ended;
  }
  await pool.query('DELETE FROM "user" WHERE id = $1', [userId]);
  await pool.end();
}
