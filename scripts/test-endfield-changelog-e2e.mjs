import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout } from "node:timers/promises";
import { chromium, expect } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { Pool } from "pg";

/* global document, window */
// Builds must already exist. Only our temporary users and releases are removed.
const databaseUrl = process.env.AUTH_INTEGRATION_DATABASE_URL;
assert.ok(databaseUrl && ["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname)
  && /(?:test|integration)/i.test(new URL(databaseUrl).pathname), "An isolated local test database is required");
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const suffix = randomUUID(), adminId = `ef-release-admin-${suffix}`, userId = `ef-release-user-${suffix}`;
const password = "Disposable-release-test-2026!", processes = [];
let browser;
async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const [akPort, efPort, platformPort] = await Promise.all([freePort(), freePort(), freePort()]);
const ak = `http://127.0.0.1:${akPort}`, ef = `http://127.0.0.1:${efPort}`, platform = `http://127.0.0.1:${platformPort}`;
const environment = { ...process.env, NODE_ENV: "development", APP_DEPLOYMENT_ENV: "development", DATABASE_URL: databaseUrl,
  BETTER_AUTH_URL: ak, BETA_PUBLIC_ORIGIN: ak, BETTER_AUTH_SECRET: "endfield-release-isolated-test-secret-32-bytes",
  BETTER_AUTH_ADMIN_USER_IDS: "", AUTH_COOKIE_DOMAIN: "", PLATFORM_PUBLIC_ORIGINS: [ak, ef, platform].join(","),
  PLATFORM_API_ORIGIN: "", BETA_RATE_LIMIT_ENABLED: "0", BETA_TRUST_PROXY_HEADERS: "1", ENDFIELD_ACCESS_MODE: "public",
  ENDFIELD_ACCOUNT_ORIGIN: ak, HOST: "127.0.0.1", NITRO_HOST: "127.0.0.1" };
function start(entry, extra) {
  const child = spawn(process.execPath, [entry], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"], env: { ...environment, ...extra } });
  let errors = "";
  child.stderr.on("data", value => { errors = (errors + value).slice(-4000); });
  processes.push(child);
  return { child, errors: () => errors };
}
async function stop(child) {
  if (child.exitCode !== null) return;
  const ended = new Promise(resolve => child.once("exit", resolve));
  child.kill(); await ended;
}
async function ready(server, url) {
  for (let attempt = 0; attempt < 240; attempt++) {
    assert.equal(server.child.exitCode, null, server.errors());
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* Wait for this test's server. */ }
    await setTimeout(250);
  }
  throw new Error(`Local server unavailable: ${server.errors()}`);
}
async function login(context, id, origin = ef) {
  const response = await context.request.post(origin + "/api/auth/sign-in/email", {
    headers: { origin }, data: { email: `${id}@example.test`, password },
  });
  assert.equal(response.status(), 200, await response.text());
}
const api = "/api/endfield/admin/releases";
const errors = [];
try {
  const hash = await hashPassword(password);
  for (const [id, role] of [[adminId, "admin"], [userId, "user"]]) {
    await pool.query('INSERT INTO "user" (id,name,email,email_verified,role) VALUES ($1,$2,$3,true,$4)', [id, `Release ${role}`, `${id}@example.test`, role]);
    await pool.query('INSERT INTO account (id,account_id,provider_id,user_id,password) VALUES ($1,$2,\'credential\',$2,$3)', [randomUUID(), id, hash]);
  }
  const arkServer = start("apps/arknights/.output/server/index.mjs", { PORT: String(akPort), NITRO_PORT: String(akPort) });
  // Built production bridges intentionally reject legacy HTTP account origins.
  const efServer = start("apps/endfield/.output/server/index.mjs", { PORT: String(efPort), NITRO_PORT: String(efPort), PLATFORM_API_ORIGIN: platform });
  const platformServer = start("services/platform-api/dist/server.mjs", { PLATFORM_HOST: "127.0.0.1", PLATFORM_PORT: String(platformPort) });
  await Promise.all([ready(arkServer, ak + "/api/releases"), ready(efServer, ef + "/changelog"), ready(platformServer, platform + "/api/platform/health")]);
  browser = await chromium.launch();
  const admin = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const anonymous = await browser.newContext();
  await login(admin, adminId);
  const bridgedSession = await admin.request.get(ef + "/api/auth/get-session");
  assert.equal(bridgedSession.status(), 200, await bridgedSession.text());
  const bridgedUser = (await bridgedSession.json())?.user?.id;
  assert.equal(bridgedUser, adminId, "The Endfield account bridge resolves our admin session");
  const page = await admin.newPage(), publicPage = await anonymous.newPage();
  page.setDefaultTimeout(30_000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", event => { if (event.type() === "error" && /MISSING_MESSAGE|INVALID_MESSAGE|hydration|Minified React/.test(event.text())) errors.push(event.text()); });
  const acceptDialog = dialog => dialog.accept();
  page.on("dialog", acceptDialog);
  const draft = { version: `999998.${Date.now() % 1000000}.1`, date: "2020-01-01", title: { zh: "Arknights stays separate", en: "" }, notify: false,
    sections: [{ kind: "added", items: [{ zh: "Arknights content", en: "" }] }] };
  const akCreated = await admin.request.post(ak + "/api/admin/releases", { headers: { origin: ak }, data: draft });
  assert.equal(akCreated.status(), 201, await akCreated.text());
  const akRecord = (await akCreated.json()).data.release;
  assert.equal((await admin.request.patch(ak + `/api/admin/releases/${akRecord.id}`, { headers: { origin: ak }, data: { action: "publish", revision: akRecord.revision } })).status(), 200);
  await page.goto(ef + "/admin/changelog");
  const form = page.locator(".ef-release-editor");
  await expect(form).toBeVisible();
  await form.getByLabel("版本号", { exact: true }).fill(draft.version);
  await form.getByLabel("发布日期（北京时间）", { exact: true }).fill("2020-01-01");
  await form.getByLabel("更新标题", { exact: true }).fill("终末地独立更新测试");
  await form.getByLabel("新增 1", { exact: true }).fill("终末地简体内容");
  await form.getByRole("button", { name: "繁體中文（台灣）", exact: true }).click();
  await form.getByLabel("更新标题", { exact: true }).fill("終末地獨立更新測試");
  await form.getByLabel("新增 1", { exact: true }).fill("終末地繁體內容");
  await form.getByRole("button", { name: "English", exact: true }).click();
  await form.getByLabel("更新标题", { exact: true }).fill("Independent Endfield update");
  await form.getByLabel("新增 1", { exact: true }).fill("Endfield English content");
  await form.getByRole("button", { name: "预览", exact: true }).click();
  await expect(page.locator(".ef-release-preview")).toContainText("Endfield English content");
  await form.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("草稿已保存");
  await publicPage.goto(ef + "/changelog");
  await expect(publicPage.getByText("终末地独立更新测试", { exact: true })).toHaveCount(0);
  await form.getByRole("button", { name: "发布", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("操作成功");
  for (const [locale, title, content] of [["zh-CN", "终末地独立更新测试", "终末地简体内容"], ["zh-TW", "終末地獨立更新測試", "終末地繁體內容"], ["en", "Independent Endfield update", "Endfield English content"]]) {
    await anonymous.addCookies([{ name: "riic-endfield-locale", value: locale, url: ef }]);
    await publicPage.reload();
    await expect(publicPage.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(publicPage.getByText(content, { exact: true })).toBeVisible();
    await expect(publicPage.getByText("Arknights stays separate", { exact: true })).toHaveCount(0);
  }
  await form.getByLabel("更新标题", { exact: true }).fill("Unsaved English title");
  page.off("dialog", acceptDialog);
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("link", { name: "查看公开日志", exact: true }).click();
  await expect(form.getByLabel("更新标题", { exact: true })).toHaveValue("Unsaved English title");
  assert.equal(new URL(page.url()).pathname, "/admin/changelog");
  page.on("dialog", acceptDialog);
  // Changing the interface language must not reset the translated content being edited.
  await page.locator("[data-sidebar-account-trigger]").click();
  await page.getByRole("menuitemradio", { name: "English", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(form.getByLabel("Release title", { exact: true })).toHaveValue("Unsaved English title");
  let record = (await (await admin.request.get(ef + api)).json()).data.releases.find(entry => entry.draft.version === draft.version);
  assert.equal((await admin.request.patch(ef + `${api}/${record.id}`, { headers: { origin: ef }, data: { action: "save", revision: record.revision, draft: record.draft } })).status(), 200);
  await form.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your edits are preserved");
  await expect(form.getByLabel("Release title", { exact: true })).toHaveValue("Unsaved English title");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.locator(".ef-release-list button").filter({ hasText: draft.version }).click();
  await form.getByRole("button", { name: "Withdraw", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Done");
  await publicPage.reload();
  await expect(publicPage.getByRole("heading", { name: "Independent Endfield update", exact: true })).toHaveCount(0);
  const akFeed = (await (await admin.request.get(ak + "/api/releases")).json()).data.releases;
  assert.equal(akFeed.find(entry => entry.version === draft.version).title.zh, "Arknights stays separate");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "mobile editor fits without horizontal overflow");
  const regular = await browser.newContext();
  await login(regular, userId);
  const regularPage = await regular.newPage();
  await regularPage.goto(ef + "/admin/changelog");
  await expect(regularPage.getByRole("alert")).toContainText("仅管理员");
  await expect(regularPage.locator(".ef-release-editor")).toHaveCount(0);
  assert.equal((await regular.request.get(ef + api)).status(), 403);
  assert.equal((await anonymous.request.get(ef + api)).status(), 401);
  // The Arknights compatibility host exposes the same fixed Endfield namespace.
  const compatibleList = await admin.request.get(ak + api);
  assert.equal(compatibleList.status(), 200, await compatibleList.text());
  assert.equal((await compatibleList.json()).data.releases.find(entry => entry.draft.version === draft.version).published, null);
  // Mirror the deployed loopback bridge: its browser origin differs from the host's BETA_PUBLIC_ORIGIN.
  record = (await compatibleList.json()).data.releases.find(entry => entry.draft.version === draft.version);
  const compatibleWrite = await admin.request.patch(ak + `${api}/${record.id}`, {
    headers: { origin: ef, "x-forwarded-host": new URL(ef).host, "x-forwarded-proto": "http" },
    data: { action: "save", revision: record.revision, draft: record.draft },
  });
  assert.equal(compatibleWrite.status(), 200, await compatibleWrite.text());
  record = (await (await admin.request.get(ef + api)).json()).data.releases.find(entry => entry.draft.version === draft.version);
  assert.equal((await admin.request.patch(ef + `${api}/${record.id}`, { headers: { origin: ef }, data: { action: "publish", revision: record.revision } })).status(), 200);
  assert.equal((await (await anonymous.request.get(ef + "/api/endfield/releases")).json()).data.releases.find(entry => entry.version === draft.version).title.en, "Independent Endfield update");
  assert.deepEqual(errors, [], "no client hydration or translation errors");
  console.log("PASS: real login, three-language draft/preview/publish/withdraw, site isolation, conflict preservation, navigation guard, language switching, mobile layout, permissions, legacy host and standalone platform.");
} finally {
  await browser?.close();
  await Promise.all(processes.map(stop));
  await pool.query('DELETE FROM app.release_note WHERE created_by_user_id=ANY($1::text[])', [[adminId, userId]]);
  await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [[adminId, userId]]);
  await pool.end();
}
