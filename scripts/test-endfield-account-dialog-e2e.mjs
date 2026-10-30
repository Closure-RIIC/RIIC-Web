import assert from "node:assert/strict";
import { chromium, expect as baseExpect } from "@playwright/test";

const expect = baseExpect.configure({ timeout: 30000 });

const origin = process.env.ENDFIELD_E2E_ORIGIN || "http://127.0.0.1:5176";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("Local-only test");
const browser = await chromium.launch({ headless: true });
const user = { id: "dialog-fixture", name: "弹窗测试", email: "dialog@example.invalid" };
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: "riic-endfield-locale", value: "zh", url: origin }]);
    let signedIn = false, rejectSignOut = true;
    let expiresAt = "2099-01-01T00:00:00Z", rejectExtension = true, extensions = 0;
    const requests = [];
    // Every API call is isolated from real accounts, mail delivery and user data.
    await context.route("**/api/**", route => route.fulfill({ status: 401, json: { error: { message: "Isolated fixture" } } }));
    await context.route("**/api/auth/**", route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/get-session")) return route.fulfill({ json: signedIn ? { user, session: { expiresAt } } : null });
      requests.push({ path, body: route.request().postDataJSON() });
      if (path.endsWith("/sign-in/email")) signedIn = true;
      if (path.endsWith("/sign-out")) {
        if (rejectSignOut) return route.fulfill({ status: 503, json: { success: false } });
        signedIn = false;
      }
      return route.fulfill({ json: { success: true } });
    });
    await context.route("**/api/account/feature-access", route => route.fulfill({ json: { agent: false, billing: true } }));
    await context.route("**/api/account/settings/extend", route => {
      assert.equal(route.request().method(), "POST");
      if (rejectExtension) return route.fulfill({ status: 503, json: { success: false } });
      extensions += 1;
      expiresAt = new Date(Date.parse(expiresAt) + 30 * 86400000).toISOString();
      return route.fulfill({ json: { success: true, data: { expiresAt } } });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(60000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const ready = () => page.locator('body[data-app-hydrated="true"]').waitFor();
    const sidebar = async () => { if (width < 768) await page.locator("[data-endfield-mobile-navigation]").click(); };
    const avatar = page.locator("[data-sidebar-account-trigger]");
    const dialog = page.locator("[data-website-account-dialog]");
    await page.goto(`${origin}/settings`); await ready(); await sidebar();
    await avatar.click();
    await page.locator("[data-sidebar-sign-in]").click();
    await expect(dialog).toBeVisible();
    await expect(page.locator("[data-sidebar-account-menu]")).toHaveCount(0);
    await expect(dialog.getByLabel("邮箱", { exact: true })).toBeVisible();
    assert.equal(page.url(), `${origin}/settings`);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(width < 768 ? page.locator("[data-endfield-mobile-navigation]") : avatar).toBeFocused();
    await sidebar(); await avatar.click();
    await page.locator("[data-sidebar-sign-in]").click();
    await dialog.getByRole("button", { name: "创建账号", exact: true }).click();
    await dialog.getByLabel("昵称").fill(user.name);
    await dialog.getByLabel("邮箱", { exact: true }).fill(user.email);
    await dialog.getByLabel("密码", { exact: true }).fill("Axy123!?");
    await dialog.getByLabel("确认密码", { exact: true }).fill("Axy123!?");
    await dialog.getByRole("button", { name: "创建账号并发送验证码", exact: true }).click();
    for (const [index, digit] of [..."123456"].entries()) {
      await dialog.getByRole("textbox", { name: `邮箱验证码第 ${index + 1} 位，共 6 位` }).fill(digit);
    }
    await dialog.getByRole("button", { name: "验证邮箱", exact: true }).click();
    await expect(dialog).toContainText("邮箱验证完成，现在可以登录网站账号。");
    await dialog.getByRole("button", { name: "返回登录", exact: true }).click();
    await dialog.getByRole("button", { name: "忘记密码", exact: true }).click();
    await dialog.getByLabel("邮箱", { exact: true }).fill(user.email);
    await dialog.getByRole("button", { name: "发送重置邮件", exact: true }).click();
    await expect(dialog).toContainText("重置邮件已发送");
    assert.equal(requests.at(-1).body.redirectTo, `${origin}/?auth=reset-password`);
    await dialog.getByRole("button", { name: "返回登录", exact: true }).click();
    await dialog.getByLabel("邮箱", { exact: true }).fill(user.email);
    await dialog.getByLabel("密码", { exact: true }).fill("Axy123!?");
    await dialog.getByRole("button", { name: "登录", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    assert.equal(page.url(), `${origin}/settings`);
    const activity = page.locator('[data-slot="live-activity"][data-activity-kind="account"]');
    const extend = page.getByRole("button", { name: "续期 30 天", exact: true });
    await extend.click();
    await expect(page.locator("[data-endfield-settings]")).toContainText("账号操作失败，请稍后重试。");
    await expect(activity).toHaveCount(0);
    assert.equal(extensions, 0);
    rejectExtension = false;
    await extend.click();
    await expect(activity).toContainText("登录有效期已续期 30 天。");
    await expect(page.locator("[data-endfield-settings]")).not.toContainText("登录有效期已续期 30 天。");
    await activity.getByRole("button", { name: "关闭账号提示", exact: true }).click();
    await expect(activity).toHaveCount(0);
    await extend.click();
    await expect(activity).toContainText("登录有效期已续期 30 天。");
    assert.equal(extensions, 2);
    await page.mouse.move(width - 10, 890);
    await expect(activity).toHaveCount(0);
    await sidebar(); await expect(avatar).toContainText(user.name); await avatar.click();
    const menu = page.locator("[data-sidebar-account-menu]");
    await expect(menu.getByRole("menuitem")).toHaveText(["更新日志", "退出登录"]);
    await expect(page.locator('[data-primary-navigation-page="billing"]')).toHaveCount(0);
    const changelog = menu.getByRole("menuitem", { name: "更新日志", exact: true });
    await expect(changelog).toHaveAttribute("href", "/changelog");
    await changelog.click();
    await expect(page).toHaveURL(`${origin}/changelog`);
    await expect(page.locator("[data-endfield-changelog]")).toBeVisible();
    await expect(page).toHaveTitle("更新日志 · 帝江号基建终端");
    await sidebar(); await avatar.click();
    await menu.getByRole("menuitemradio", { name: "English", exact: true }).click();
    await expect(menu.getByRole("menuitem")).toHaveText(["Changelog", "Sign out"]);
    await expect(page).toHaveTitle("Changelog · 帝江号基建终端");
    await page.reload(); await ready();
    await page.evaluate(() => globalThis.dispatchEvent(new Event("focus")));
    await sidebar(); await expect(avatar).toContainText(user.name); await avatar.click();
    await expect(menu.getByRole("menuitemradio", { name: "English", exact: true })).toBeChecked();
    await menu.getByRole("menuitemradio", { name: "简体中文", exact: true }).click();
    await menu.getByRole("menuitem", { name: "退出登录", exact: true }).click();
    await expect(menu.getByRole("alert")).toContainText("退出登录失败");
    rejectSignOut = false;
    await menu.getByRole("menuitem", { name: "退出登录", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/`);
    await expect(menu).toHaveCount(0);
    await page.goto(`${origin}/?auth=reset-password&token=fixture-reset-token`); await ready();
    await expect(dialog.getByLabel("新密码", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(`${origin}/`);
    await dialog.getByLabel("新密码", { exact: true }).fill("Axy123!?");
    await dialog.getByLabel("确认新密码", { exact: true }).fill("Axy123!?");
    await dialog.getByRole("button", { name: "确认重置", exact: true }).click();
    await expect(dialog).toContainText("密码已重置");
    assert.equal(requests.at(-1).body.token, "fixture-reset-token");
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Endfield account dialog, menu, language, sign-out retry and reset: ${width}px passed`);
  }
} finally { await browser.close(); }
