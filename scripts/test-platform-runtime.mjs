import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";
import { performance } from "node:perf_hooks";
import process from "node:process";

/* global fetch, AbortSignal */
const root = fileURLToPath(new URL("../", import.meta.url));
const probe = createServer();
await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const child = spawn(process.execPath, ["services/platform-api/dist/server.mjs"], {
  cwd: root, windowsHide: true, stdio: ["ignore", "ignore", "pipe"],
  env: { ...process.env, NODE_ENV: "production", PLATFORM_HOST: "127.0.0.1", PLATFORM_PORT: String(port), BETA_TRUST_PROXY_HEADERS: "1",
    PLATFORM_PUBLIC_ORIGINS: "https://arknights.example,https://endfield.arknights.example", AUTH_COOKIE_DOMAIN: "arknights.example",
    DATABASE_URL: "", DATABASE_MIGRATION_URL: "", AUTH_INTEGRATION_DATABASE_URL: "", BETTER_AUTH_SECRET: "", SKLAND_SESSION_SECRET: "" },
});
let error = "";
child.stderr.on("data", value => { error = (error + value).slice(-3000); });
try {
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`Platform exited: ${error}`);
    try { ready = (await fetch(origin + "/api/platform/health", { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Wait for this isolated process. */ }
    if (ready) break;
    await setTimeout(100);
  }
  assert.ok(ready, "Independent service starts without application code or a database");
  const times = [];
  for (const host of ["arknights.example", "endfield.arknights.example"]) {
    const started = performance.now();
    const response = await fetch(origin + "/api/auth/get-session", { headers: { "x-forwarded-host": host, "x-forwarded-proto": "https" } });
    times.push(performance.now() - started);
    assert.equal(response.status, 200);
    assert.equal(await response.json(), null);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.match(response.headers.get("server-timing"), /platform;dur=/);
  }
  assert.equal((await fetch(origin + "/api/auth/get-session", { headers: { "x-forwarded-host": "untrusted.example", "x-forwarded-proto": "https" } })).status, 403);
  assert.equal((await fetch(origin + "/api/auth/sign-out", { method: "POST", headers: { "x-forwarded-host": "arknights.example", "x-forwarded-proto": "https", origin: "https://evil.example" } })).status, 403);
  assert.equal((await fetch(origin + "/api/admin/users", { headers: { "x-forwarded-host": "arknights.example", "x-forwarded-proto": "https" } })).status, 404);
  process.stdout.write(`Platform runtime passed: both app origins, anonymous session, origin isolation and private responses. Local read samples: ${times.map(ms => ms.toFixed(1)).join(", ")} ms.\n`);
} finally {
  if (child.exitCode === null) {
    const exited = new Promise(resolve => child.once("exit", resolve));
    child.kill(); await exited;
  }
}
