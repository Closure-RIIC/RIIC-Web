import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import process from "node:process";

const root = fileURLToPath(new URL("../", import.meta.url));
const adminCookie = "better-auth.session_token=isolated-admin-fixture";
const userCookie = "better-auth.session_token=ordinary-user";
let allowed = true;
const account = createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "private, no-store");
  if (request.url === "/api/platform/endfield-access") {
    response.writeHead(allowed && request.headers.cookie === adminCookie ? 204 : 403).end();
  } else if (request.url?.startsWith("/api/auth/get-session")) {
    const id = request.headers.cookie === adminCookie ? "fixture-admin" : request.headers.cookie === userCookie ? "fixture-user" : null;
    response.end(JSON.stringify(id ? { user: { id, name: id, email: `${id}@example.test` }, session: { expiresAt: "2099-01-01" } } : null));
  } else if (request.url === "/api/endfield/skland/accounts") {
    if (![adminCookie, userCookie].includes(request.headers.cookie)) response.writeHead(401).end("{}");
    else response.end(JSON.stringify({ success: true, data: { accounts: [] } }));
  } else response.writeHead(404).end();
});
const listen = server => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
await listen(account);
const probe = createServer();
await listen(probe);
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
let child;
try {
  const assets = await readdir(new URL("../apps/endfield/.output/public/assets/", import.meta.url));
  const asset = assets.find(name => name.endsWith(".js"));
  assert.ok(asset, "Build Endfield before validating its runtime");
  child = spawn(process.execPath, ["apps/endfield/.output/server/index.mjs"], {
    cwd: root, windowsHide: true, stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port),
      ENDFIELD_ACCESS_MODE: "admin",
      PLATFORM_API_ORIGIN: `http://127.0.0.1:${account.address().port}`, ENDFIELD_ACCOUNT_ORIGIN: "",
      DATABASE_URL: "", DATABASE_MIGRATION_URL: "", BETTER_AUTH_SECRET: "" },
  });
  let errors = "";
  child.stderr.on("data", chunk => { errors = (errors + chunk).slice(-3000); });
  const origin = `http://127.0.0.1:${port}`;
  const request = (path, cookie, options = {}) => fetch(origin + path, {
    ...options, headers: { ...(cookie ? { cookie } : {}), ...options.headers }, signal: AbortSignal.timeout(10000),
  });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`Endfield exited: ${errors}`);
    try { ready = (await request("/")).status === 404; } catch { /* Wait for our own isolated process. */ }
    if (ready) break;
    await setTimeout(100);
  }
  assert.ok(ready, "Endfield starts closed to anonymous requests");
  const paths = ["/", "/manual", "/skills", "/api/auth/get-session", "/api/skland/session", `/assets/${asset}`];
  for (const cookie of [undefined, "better-auth.session_token=ordinary-user", "role=admin"]) {
    for (const path of paths) {
      const response = await request(path, cookie);
      assert.equal(response.status, 404, path);
      assert.match(response.headers.get("cache-control"), /private, no-store/);
      assert.equal(await response.text(), "Not Found");
    }
  }
  assert.equal((await request("/api/auth/sign-in/email", undefined, { method: "POST", body: "{}" })).status, 404);
  const document = await request("/", adminCookie);
  assert.equal(document.status, 200, await document.clone().text());
  assert.match(document.headers.get("cache-control"), /private, no-store/);
  const script = await request(`/assets/${asset}`, adminCookie);
  assert.equal(script.status, 200);
  assert.match(script.headers.get("cache-control"), /private, no-store/);
  assert.equal((await request("/api/auth/get-session", adminCookie)).status, 200);
  allowed = false;
  for (const path of paths) assert.equal((await request(path, adminCookie)).status, 404, `Revoked: ${path}`);
  await new Promise(resolve => account.close(resolve));
  for (const path of ["/", `/assets/${asset}`]) assert.equal((await request(path, adminCookie)).status, 404, `Offline: ${path}`);
  const stopped = new Promise(resolve => child.once("exit", resolve));
  child.kill(); await stopped;
  await listen(account);
  child = spawn(process.execPath, ["apps/endfield/.output/server/index.mjs"], {
    cwd: root, windowsHide: true, stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port),
      ENDFIELD_ACCESS_MODE: "public",
      PLATFORM_API_ORIGIN: `http://127.0.0.1:${account.address().port}`, ENDFIELD_ACCOUNT_ORIGIN: "",
      DATABASE_URL: "", DATABASE_MIGRATION_URL: "", BETTER_AUTH_SECRET: "" },
  });
  errors = "";
  child.stderr.on("data", chunk => { errors = (errors + chunk).slice(-3000); });
  ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`Public Endfield exited: ${errors}`);
    try { ready = (await request("/skills")).status === 200; } catch { /* Wait for our own isolated process. */ }
    if (ready) break;
    await setTimeout(100);
  }
  assert.ok(ready, "Public Endfield starts without an account session");
  for (const cookie of [undefined, userCookie, "role=admin", adminCookie]) {
    for (const path of ["/", "/manual", "/skills", "/skland", `/assets/${asset}`]) {
      const response = await request(path, cookie);
      assert.equal(response.status, 200, `Public: ${path}`);
      assert.match(response.headers.get("cache-control"), /private, no-store/);
    }
  }
  assert.equal(await (await request("/api/auth/get-session")).json(), null);
  assert.equal((await (await request("/api/auth/get-session", userCookie)).json()).user.id, "fixture-user");
  for (const cookie of [undefined, "role=admin"]) {
    assert.equal((await request("/api/skland/accounts", cookie)).status, 401, "Private Skland data requires a website session");
  }
  assert.equal((await request("/api/skland/accounts", "better-auth.session_token=invalid")).status, 401, "The upstream validates session tokens");
  assert.equal((await request("/api/skland/accounts", userCookie)).status, 200, "Ordinary users can read their own Skland accounts");
  assert.equal((await request("/api/skland/sync", userCookie, { method: "POST", headers: { origin: "https://untrusted.example", "content-type": "application/json" }, body: "{}" })).status, 403);
  assert.equal((await request("/api/account/settings/extend", undefined, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" })).status, 401);
  await new Promise(resolve => account.close(resolve));
  for (const path of ["/", "/skills", `/assets/${asset}`]) assert.equal((await request(path)).status, 200, `Public pages survive account outage: ${path}`);
  assert.equal((await request("/api/auth/get-session", userCookie)).status, 503);
  process.stdout.write("Endfield runtime passed: public pages/assets and ordinary accounts work; private APIs require valid sessions and origins; account outages preserve public pages; optional administrator preview remains closed.\n");
} finally {
  if (child && child.exitCode === null) {
    const ended = new Promise(resolve => child.once("exit", resolve));
    child.kill(); await ended;
  }
  if (account.listening) await new Promise(resolve => account.close(resolve));
}
