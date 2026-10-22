import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import process from "node:process";

const root = fileURLToPath(new URL("../", import.meta.url));
const adminCookie = "better-auth.session_token=isolated-admin-fixture";
let allowed = true;
const account = createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "private, no-store");
  if (request.url === "/api/platform/endfield-access") {
    response.writeHead(allowed && request.headers.cookie === adminCookie ? 204 : 403).end();
  } else if (request.url?.startsWith("/api/auth/get-session")) {
    response.end(JSON.stringify({ user: { id: "fixture-admin", name: "Admin", email: "admin@example.test" }, session: { expiresAt: "2099-01-01" } }));
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
  process.stdout.write("Endfield runtime passed: anonymous/user/forged/revoked/offline requests return 404; administrators load pages, APIs and assets; all responses stay private.\n");
} finally {
  if (child && child.exitCode === null) {
    const ended = new Promise(resolve => child.once("exit", resolve));
    child.kill(); await ended;
  }
  if (account.listening) await new Promise(resolve => account.close(resolve));
}
