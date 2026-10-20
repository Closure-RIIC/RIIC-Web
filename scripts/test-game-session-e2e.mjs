import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const arknights = process.env.ARKNIGHTS_E2E_ORIGIN || "http://127.0.0.1:5175";
const endfield = process.env.ENDFIELD_E2E_ORIGIN || "http://127.0.0.1:5176";
for (const origin of [arknights, endfield]) {
  if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("This test is local-only");
}
const fixture = (id = "fixture-a") => ({
  user: { id, name: id, email: `${id}@example.invalid` },
  session: { expiresAt: "2099-01-01" },
});
const browser = await chromium.launch({ headless: true });
try {
  // No real browser profile, login cookie or account mutations.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: "riic-locale", value: "zh", url: arknights }]);
  let session = null;
  let requests = 0;
  let signouts = 0;
  let failSignout = false;
  let release;
  let hold = false;
  await context.route("**/api/**", route => route.fulfill({ status: 401, json: { error: { message: "Isolated fixture" } } }));
  await context.route("**/api/auth/get-session**", async route => {
    requests++;
    const value = session;
    if (hold) await new Promise(resolve => { release = resolve; });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(value) });
  });
  await context.route("**/api/auth/sign-out", async route => {
    signouts++;
    if (failSignout) { await route.fulfill({ status: 502, json: { error: { message: "Fixture failure" } } }); return; }
    session = null;
    await route.fulfill({ contentType: "application/json", body: '{"success":true}' });
  });
  // Authenticated refreshes below are fixtures; keep their dependent reads local.
  await context.route("**/api/account/feature-access", route => route.fulfill({ json: { agent: false, billing: false } }));
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(60000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const name = page.locator("[data-sidebar-account-name]");
  const trigger = page.locator("[data-sidebar-account-trigger]");
  const avatar = trigger.locator("[data-account-orb-color]");
  const settle = () => page.evaluate(() => new Promise(resolve => {
    globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(() => resolve()));
  }));
  const focus = () => page.evaluate(() => globalThis.dispatchEvent(new Event("focus")));

  for (const origin of [arknights, endfield]) {
    requests = 0;
    session = null;
    const response = await page.goto(`${origin}/`);
    assert.equal(response.status(), 200);
    assert.match(response.headers()["cache-control"], /private.*no-store/);
    assert.match(await response.text(), /data-sidebar-account-name/, "Account display is present in SSR HTML");
    await page.locator('body[data-app-hydrated="true"]').waitFor();
    await name.waitFor();
    await settle();
    assert.equal(requests, 0, "A successful SSR bootstrap must not repeat get-session on mount");

    session = fixture();
    await focus();
    await expect(name).toHaveText("fixture-a");
    const color = await avatar.getAttribute("data-account-orb-color");
    assert.ok(color);
    hold = true;
    const beforeRefresh = requests;
    await focus();
    await expect.poll(() => requests).toBe(beforeRefresh + 1);
    await expect(name).toHaveText("fixture-a");
    assert.equal(await avatar.getAttribute("data-account-orb-color"), color, "Keep avatar during revalidation");
    hold = false;
    release();
    await settle();

    // A later response must win even if a stale request completes afterwards.
    session = fixture("stale-account");
    hold = true;
    const beforeRace = requests;
    await focus();
    await expect.poll(() => requests).toBe(beforeRace + 1);
    const releaseStale = release;
    hold = false;
    session = fixture("current-account");
    await focus();
    await expect(name).toHaveText("current-account");
    releaseStale();
    await settle();
    await expect(name).toHaveText("current-account");

    await expect(trigger).not.toHaveAttribute("aria-busy", "true");
    await trigger.click();
    await expect(page.getByRole("menuitem", { name: "账号设置", exact: true })).toHaveCount(0);
    failSignout = true;
    await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: /退出/ })).toBeVisible();
    await expect(name).toHaveText("current-account");
    failSignout = false;
    const beforeSignout = signouts;
    // A pending refresh must not restore an account after a successful logout.
    let releaseBeforeLogout;
    if (origin === endfield) {
      hold = true;
      const beforeLogoutRace = requests;
      await focus();
      await expect.poll(() => requests).toBeGreaterThan(beforeLogoutRace);
      releaseBeforeLogout = release;
      hold = false;
    }
    await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
    await expect.poll(() => signouts).toBe(beforeSignout + 1);
    await expect(name).not.toHaveText("current-account");
    releaseBeforeLogout?.();
    await settle();
    await expect(name).not.toHaveText("current-account");
    await expect(avatar).toHaveCount(0);
    await page.reload();
    await page.locator('body[data-app-hydrated="true"]').waitFor();
    await expect(name).not.toHaveText("current-account");
  }
  await page.locator("[data-game-switcher]").click();
  await page.getByRole("menuitem", { name: "明日方舟", exact: true }).click();
  await page.waitForURL(`${arknights}/`);
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  await expect(avatar).toHaveCount(0);
  await page.locator("[data-game-switcher]").click();
  await page.getByRole("menuitem", { name: "终末地", exact: true }).click();
  await page.waitForURL(`${endfield}/`);
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  await expect(avatar).toHaveCount(0);
  assert.deepEqual(errors, [], "No runtime or hydration errors");
  console.log("Passed: SSR/no-store, no duplicate mount request, refresh continuity, stale response ordering, both sign-out menus, failed logout preserves account, logout wins over stale refresh, reload and bidirectional navigation.");
  await context.close();
} finally {
  await browser.close();
}
