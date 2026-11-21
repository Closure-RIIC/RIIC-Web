// Local UI/API permission verification with isolated users, signed sessions and synthetic messages.
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { setTimeout } from "node:timers/promises";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { chromium } from "@playwright/test";
import { loadEnvConfig } from "./load-env.mjs";
/* global fetch, AbortSignal */
loadEnvConfig(process.env.RIIC_TEST_ENV_DIR || process.cwd());
const url = new URL(process.env.AUTH_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
const databaseName = `riic_permissions_${randomUUID().replaceAll("-", "")}_test`;
const admin = new Client({ connectionString: url.toString() });
const storage = await mkdtemp(path.join(tmpdir(), "riic-permissions-ui-"));
const socket = createServer();
await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const secret = randomBytes(32).toString("base64");
const fixtures = {};
let child, browser, created = false;
await mkdir("output/super-admin", { recursive: true });
const log = createWriteStream("output/super-admin/browser-server.log");
await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${databaseName}"`); created = true;
  url.pathname = `/${databaseName}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await migrate(drizzle({ client }), { migrationsFolder: "drizzle" });
    for (const role of ["super", "admin", "reviewer", "user"]) {
      const id = randomUUID(), token = randomUUID(), conversation = randomUUID();
      const signature = createHmac("sha256", secret).update(token).digest("base64");
      fixtures[role] = { id, cookie: encodeURIComponent(`${token}.${signature}`), conversation };
      await client.query('INSERT INTO public."user" (id,name,email,email_verified,role) VALUES ($1,$2,$3,true,$4)', [id, `UI ${role}`, `${id}@example.invalid`, role === "super" ? "user" : role]);
      await client.query("INSERT INTO public.session (id,user_id,token,expires_at) VALUES ($1,$2,$3,now()+interval '1 hour')", [randomUUID(), id, token]);
      await client.query("INSERT INTO app.agent_conversation (id,user_id,client_id,title,next_sequence) VALUES ($1,$2,$3,$4,1)", [conversation, id, randomUUID(), `Synthetic ${role} conversation`]);
      await client.query(`INSERT INTO app.agent_conversation_turn (id,conversation_id,user_id,sequence,attempt_id,request_id,model,status,user_message,user_text,assistant_message,assistant_text,finished_at)
        VALUES ($1,$2,$3,1,$4,$5,'synthetic','completed',$6,'Synthetic question',$7,'Synthetic answer',now())`, [randomUUID(), conversation, id, randomUUID(), randomUUID(), JSON.stringify({ id: randomUUID(), role: "user", parts: [{ type: "text", text: "Synthetic question" }] }), JSON.stringify({ id: randomUUID(), role: "assistant", parts: [{ type: "text", text: "Synthetic answer" }] })]);
    }
  } finally { await client.end(); }
  const env = { ...process.env, NODE_ENV: "development", APP_DEPLOYMENT_ENV: "local", DATABASE_URL: url.toString(),
    BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: origin, BETA_PUBLIC_ORIGIN: origin, BETTER_AUTH_ADMIN_USER_IDS: fixtures.super.id,
    LOCAL_TEST_AUTO_SIGN_IN: "0", BETA_STORAGE_DIR: storage, BETA_RATE_LIMIT_ENABLED: "0", SKLAND_FEATURE_ENABLED: "0",
    AGENT_CONVERSATION_STORAGE_ENABLED: "1", AGENT_GATEWAY_ENABLED: "0", PLATFORM_API_ORIGIN: "", AUTH_COOKIE_DOMAIN: "",
    AGENT_ACCESS_MODE: "disabled", BILLING_ACCESS_MODE: "disabled", ACCOUNT_CLOUD_SYNC_ENABLED: "0" };
  for (const key of Object.keys(env)) if (key.startsWith("AGENT_LLM_") || key === "AGENT_GATEWAY_KEY") delete env[key];
  child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "apps/arknights", "--config", "apps/arknights/vite.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log); child.stderr.pipe(log);
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error("Test server exited; inspect output/super-admin/browser-server.log");
    try { ready = (await fetch(`${origin}/api/agent/archive?action=access`, { signal: AbortSignal.timeout(2000) })).status === 401; } catch { /* startup */ }
    if (ready) break;
    await setTimeout(500);
  }
  assert.ok(ready, "test server must become ready");
  assert.equal((await fetch(`${origin}/api/admin/permissions`)).status, 401);
  browser = await chromium.launch({ headless: true });
  for (const role of ["admin", "super", "reviewer", "user"]) {
    const context = await browser.newContext({ locale: "zh-CN", acceptDownloads: true });
    await context.addCookies([{ name: "better-auth.session_token", value: fixtures[role].cookie, url: origin }, { name: "aic_locale", value: "zh-CN", url: origin }]);
    const page = await context.newPage(); page.setDefaultTimeout(60_000);
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    const sensitiveReads = [];
    page.on("request", request => { if (/\/api\/admin\/billing\?/.test(request.url())) sensitiveReads.push(new URL(request.url()).searchParams.get("section")); });
    const get = endpoint => context.request.get(origin + endpoint);
    for (const section of ["summary", "monthly", "usage", "run", "policies", "referral"]) {
      const response = await get(`/api/admin/billing?section=${section}`);
      assert.equal(response.status(), role === "super" ? 200 : 403, `${role}:${section}`);
    }
    for (const scope of ["", "&scope=all"]) {
      const response = await context.request.post(`${origin}/api/agent/archive?action=export${scope}`, { headers: { origin } });
      assert.equal(response.status(), role === "super" ? 200 : 403);
    }
    const rosterResponse = await get("/api/admin/permissions");
    assert.equal(rosterResponse.status(), role === "super" ? 200 : 403);
    assert.match(rosterResponse.headers()["cache-control"], /no-store/);
    assert.equal((await context.request.post(`${origin}/api/admin/permissions`, { headers: { origin } })).status(), 405);
    if (role === "super") {
      const roster = (await rosterResponse.json()).data.superAdmins;
      assert.deepEqual(roster.map(entry => entry.id), [fixtures.super.id]);
      assert.equal(roster[0].exists, true);
      assert.equal(roster[0].name, "UI super");
    }
    const permissionsPage = await page.goto(`${origin}/admin/permissions`);
    assert.equal(permissionsPage.status(), role === "super" ? 200 : 404);
    const overviewPage = await page.goto(`${origin}/admin`);
    assert.equal(overviewPage.status(), role === "user" ? 404 : 200);
    const entryNames = ["权限管理", "会话导出"];
    if (role !== "user") {
      const navigation = page.getByRole("navigation", { name: "后台导航", exact: true });
      await navigation.waitFor();
      for (const name of entryNames) {
        assert.equal(await navigation.getByRole("link", { name, exact: true }).count(), role === "super" ? 1 : 0);
      }
      await page.getByRole("button", { name: "搜索页面", exact: true }).click();
      const search = page.getByRole("dialog");
      for (const name of entryNames) {
        await search.getByRole("textbox", { name: "搜索页面", exact: true }).fill(name);
        assert.equal(await search.getByRole("link").count(), role === "super" ? 1 : 0, `${role} search:${name}`);
      }
      await page.keyboard.press("Escape");
      await search.waitFor({ state: "hidden" });
      if (role === "super") {
        await navigation.getByRole("link", { name: "权限管理", exact: true }).click();
        await page.getByRole("heading", { name: "权限管理", exact: true }).waitFor();
        await page.getByRole("heading", { name: "超级管理员名单", exact: true }).waitFor();
        await page.getByText("BETTER_AUTH_ADMIN_USER_IDS", { exact: false }).waitFor();
        await page.getByText(`账号 ID: ${fixtures.super.id}`, { exact: true }).waitFor();
        const userManagement = page.locator("[data-admin-user-management]");
        const targetRow = userManagement.getByRole("row").filter({ has: page.getByText("UI user", { exact: true }) });
        await targetRow.getByRole("button").click();
        const targetDetails = page.locator(`[id="user-detail-${fixtures.user.id}"]`);
        assert.equal(await targetDetails.getByRole("button", { name: "查看 Session", exact: true }).count(), 0);
        assert.equal(await targetDetails.locator("[data-user-billing-summary]").count(), 0);
        await targetDetails.getByRole("button", { name: "设为管理员", exact: true }).click();
        const grantDialog = page.getByRole("dialog");
        await grantDialog.getByRole("button", { name: "确认设为管理员", exact: true }).click();
        await grantDialog.waitFor({ state: "hidden" });
        const granted = (await (await get(`/api/admin/users?q=${fixtures.user.id}`)).json()).data.users;
        assert.equal(granted.find(user => user.id === fixtures.user.id).isAdmin, true);
        assert.equal(granted.find(user => user.id === fixtures.user.id).isSuperAdmin, false);
        await targetDetails.getByRole("button", { name: "取消管理员", exact: true }).click();
        const revokeDialog = page.getByRole("dialog");
        await revokeDialog.getByRole("button", { name: "确认取消", exact: true }).click();
        await revokeDialog.waitFor({ state: "hidden" });
        const revoked = (await (await get(`/api/admin/users?q=${fixtures.user.id}`)).json()).data.users;
        assert.equal(revoked.find(user => user.id === fixtures.user.id).isAdmin, false);
        await targetDetails.getByRole("button", { name: "设为审阅人", exact: true }).click();
        const reviewerGrantDialog = page.getByRole("dialog");
        await reviewerGrantDialog.getByRole("button", { name: "确认设为审阅人", exact: true }).click();
        await reviewerGrantDialog.waitFor({ state: "hidden" });
        const reviewerGranted = (await (await get(`/api/admin/users?q=${fixtures.user.id}`)).json()).data.users;
        assert.equal(reviewerGranted.find(user => user.id === fixtures.user.id).isReviewer, true);
        await targetDetails.getByRole("button", { name: "撤销审阅人", exact: true }).click();
        const reviewerRevokeDialog = page.getByRole("dialog");
        await reviewerRevokeDialog.getByRole("button", { name: "确认取消", exact: true }).click();
        await reviewerRevokeDialog.waitFor({ state: "hidden" });
        const reviewerRevoked = (await (await get(`/api/admin/users?q=${fixtures.user.id}`)).json()).data.users;
        assert.equal(reviewerRevoked.find(user => user.id === fixtures.user.id).isReviewer, false);
        await page.screenshot({ path: "output/super-admin/permissions.png", fullPage: true });
        await navigation.getByRole("link", { name: "会话导出", exact: true }).click();
        await page.getByRole("heading", { name: "全站 Agent 会话归档", exact: true }).waitFor();
        assert.equal(await navigation.getByRole("link", { name: "会话导出", exact: true }).getAttribute("aria-current"), "page");
        await page.screenshot({ path: "output/super-admin/archive-entry.png", fullPage: true });
      }
    } else {
      for (const name of entryNames) assert.equal(await page.getByRole("link", { name, exact: true }).count(), 0);
    }
    const protectedPage = await page.goto(`${origin}/admin/agent-archive`);
    assert.equal(protectedPage.status(), role === "super" ? 200 : 404);
    if (["admin", "super"].includes(role)) {
      const usersPage = await page.goto(`${origin}/admin/users`);
      assert.equal(usersPage.status(), 200);
      const userManagement = page.locator("[data-admin-user-management]");
      for (const targetRole of ["user", "admin", "reviewer"]) {
        const targetRow = userManagement.getByRole("row").filter({ has: page.getByText(`UI ${targetRole}`, { exact: true }) });
        await targetRow.getByRole("button").click();
        const targetDetails = page.locator(`[id="user-detail-${fixtures[targetRole].id}"]`);
        await targetDetails.waitFor();
        for (const label of ["设为管理员", "取消管理员", "设为审阅人", "撤销审阅人"]) {
          assert.equal(await targetDetails.getByRole("button", { name: label, exact: true }).count(), 0, `${role} users:${targetRole}:${label}`);
        }
        assert.equal(await targetDetails.getByRole("button", { name: "查看 Session", exact: true }).count(), 1);
        assert.equal(await targetDetails.locator("[data-user-billing-summary]").count(), 1);
      }
      await page.goto(`${origin}/admin/billing`);
      if (role === "super") {
        await page.getByRole("button", { name: "月度统计", exact: true }).click();
        await page.getByRole("columnheader", { name: "月份（北京时间）", exact: true }).waitFor();
        await page.getByText("超级管理员", { exact: true }).waitFor();
        await page.getByRole("button", { name: "邀请活动", exact: true }).click();
        await page.getByRole("heading", { name: "邀请拉新活动", exact: true }).waitFor();
      } else {
        await page.getByRole("columnheader", { name: "邮箱", exact: true }).waitFor();
        for (const label of ["月度统计", "用量与成本", "邀请活动"]) assert.equal(await page.getByRole("button", { name: label, exact: true }).count(), 0);
        assert.ok(sensitiveReads.every(section => ["access", "wallets"].includes(section)), "ordinary admin must not prefetch sensitive billing data");
      }
      await page.screenshot({ path: `output/super-admin/${role}-billing.png`, fullPage: true });
    }
    await page.goto(`${origin}/agent-archive`);
    await page.getByRole("button", { name: new RegExp(`Synthetic ${role} conversation`) }).click();
    await page.getByRole("heading", { name: "用户 · user" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "导出当前范围 · JSONL", exact: true }).count(), role === "super" ? 1 : 0);
    assert.deepEqual(errors, [], `${role} page errors`);
    await context.close();
    console.log(`PASS ${role}: protected API/page access, super-only sidebar/search, roster and exclusive role management UI`);
  }
} finally {
  if (browser) await browser.close();
  if (child && child.exitCode === null) { child.kill("SIGTERM"); await new Promise(resolve => child.once("exit", resolve)); }
  log.end();
  if (created && /^riic_permissions_[a-f0-9]{32}_test$/.test(databaseName)) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  await admin.end();
  const resolved = path.resolve(storage);
  assert.equal(path.dirname(resolved), path.resolve(tmpdir())); assert.ok(path.basename(resolved).startsWith("riic-permissions-ui-"));
  await rm(resolved, { recursive: true, force: true });
}
