import { expect, test, type Page } from "@playwright/test";
import { mockAnonymousWebsiteSession, mockApis, seedPreferences } from "./production-readiness.fixture";

const user = { id: "sidebar-user", name: "测试博士的很长很长很长很长很长的昵称", email: "sidebar@example.test" };
const session = { user, session: { expiresAt: "2099-01-01T00:00:00Z" } };

async function prepare(page: Page) {
  await mockApis(page);
  await seedPreferences(page);
  await page.route("**/api/auth/get-session", route => route.fulfill({ json: session }));
}

for (const width of [1440, 375]) {
  test(`account footer groups actions and opens account management through settings at ${width}px`, async ({ page }) => {
    await prepare(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/account-health");
    await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
    if (width < 768) await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    const footer = page.locator("[data-sidebar-account-footer]");
    const trigger = footer.locator("[data-sidebar-account-trigger]");
    await expect(trigger).toContainText(user.name);
    await page.mouse.move(0, 0);
    await expect(trigger).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await trigger.hover();
    await expect(trigger).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await page.mouse.move(0, 0);
    const helpBox = await footer.getByRole("link", { name: "Docs", exact: true }).boundingBox();
    const settingsBox = await footer.getByRole("button", { name: "设置", exact: true }).boundingBox();
    expect(settingsBox!.x - helpBox!.x - helpBox!.width).toBeCloseTo(0, 0);
    await expect(footer).not.toContainText(user.email);
    const name = footer.locator("[data-sidebar-account-name]");
    await expect(name).toHaveCSS("text-overflow", "ellipsis");
    expect(await name.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
    await expect(footer.getByRole("link", { name: "Docs", exact: true })).toHaveAttribute("href", "/docs");
    await expect(page.getByText("我的角色", { exact: true })).toBeVisible();
    const skland = page.locator('[data-primary-navigation-page="skland"]');
    await expect(skland).toHaveAccessibleName("森空岛同步");
    await expect(skland.locator("..").locator("xpath=following-sibling::li[1]")).toContainText("抽卡分析");
    await trigger.click();
    const menu = page.locator("[data-sidebar-account-menu]");
    await expect(menu.getByRole("menuitem")).toHaveText(["付费计划", "更新日志", "退出登录"]);
    await expect(menu.getByRole("menuitem", { name: "更新日志" })).toHaveAttribute("href", "/changelog");
    const billingItem = menu.getByRole("menuitem", { name: "付费计划", exact: true });
    const changelogItem = menu.getByRole("menuitem", { name: "更新日志", exact: true });
    await expect(changelogItem).toHaveCSS("color", await skland.evaluate(node => getComputedStyle(node).color));
    await billingItem.hover();
    await expect(billingItem.locator("[data-account-menu-highlight]")).toHaveCount(1);
    await changelogItem.hover();
    await expect(menu.locator("[data-account-menu-highlight]")).toHaveCount(1);
    await expect(changelogItem.locator("[data-account-menu-highlight]")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await footer.getByRole("button", { name: "设置", exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    if (width < 768) await expect(page.getByRole("dialog", { name: "Sidebar" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "账号管理", exact: true })).toHaveCount(0);
    await expect(page.locator("[data-account-action-cards]")).toBeVisible();
    const accountAvatar = page.locator("[data-website-account-avatar]");
    await expect(accountAvatar).toBeVisible();
    if (width < 768) await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    await expect(footer.locator("[data-sidebar-account-avatar]")).toHaveAttribute("data-account-orb-color", (await accountAvatar.getAttribute("data-account-orb-color"))!);
    expect(await footer.evaluate(node => node.getBoundingClientRect().bottom <= window.innerHeight)).toBe(true);
    await footer.getByRole("link", { name: "Docs", exact: true }).click();
    await expect(page).toHaveURL(/\/docs$/);
    await expect(page.locator("[data-docs-home]")).toBeVisible();
    if (width < 768) await expect(page.getByRole("dialog", { name: "Sidebar" })).toHaveCount(0);
  });

  test(`account menu switches language and persists it after reload at ${width}px`, async ({ page }) => {
    await prepare(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/settings");
    await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
    await expect(page.locator(".workbench-footer [data-help-link]")).toHaveCount(0);
    await expect(page.locator(".workbench-footer").getByRole("button", { name: /^(中文|EN)$/ })).toHaveCount(0);
    if (width < 768) await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    await page.locator("[data-sidebar-account-trigger]").click();
    const menu = page.locator("[data-sidebar-account-menu]");
    await expect(menu.getByRole("menuitemradio", { name: "中文", exact: true })).toBeChecked();
    await menu.getByRole("menuitemradio", { name: "EN", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(menu.getByRole("menuitemradio", { name: "EN", exact: true })).toBeChecked();
    await expect(page).toHaveURL(/\/settings$/);

    await page.reload();
    await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    if (width < 768) await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    await page.locator("[data-sidebar-account-trigger]").click();
    await expect(menu.getByRole("menuitemradio", { name: "EN", exact: true })).toBeChecked();
    await menu.getByRole("menuitemradio", { name: "中文", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  });
}

test("collapsed footer stays keyboard accessible and hides restricted payment plans", async ({ page, context, baseURL }) => {
  await prepare(page);
  await context.addCookies([{ name: "riic-locale", value: "en", url: baseURL! }]);
  await page.route("**/api/account/feature-access", route => route.fulfill({ json: { agent: false, billing: false } }));
  await page.goto("/account-health");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  await page.locator('[data-slot="sidebar"]').getByRole("button", { name: "Toggle Sidebar" }).click();
  const footer = page.locator("[data-sidebar-account-footer]");
  await expect(footer).toHaveAttribute("data-compact", "true");
  const trigger = footer.locator("[data-sidebar-account-trigger]");
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.locator("[data-sidebar-account-menu]");
  await expect(menu.getByRole("menuitem")).toHaveText(["Changelog", "Sign out"]);
  await page.keyboard.press("Home");
  await expect(menu.getByRole("menuitemradio", { name: "中文", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitemradio", { name: "EN", exact: true })).toBeChecked();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Changelog", exact: true }).locator("[data-account-menu-highlight]")).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Sign out", exact: true }).locator("[data-account-menu-highlight]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(footer.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await expect(footer.getByRole("link", { name: "Docs", exact: true })).toBeVisible();
});

test("anonymous footer opens login without leaving the current page and restores focus", async ({ page }) => {
  await prepare(page);
  await mockAnonymousWebsiteSession(page);
  await page.goto("/account-health");
  const trigger = page.locator("[data-sidebar-account-trigger]");
  await expect(trigger).toContainText("未登录");
  await trigger.click();
  await page.getByRole("menuitem", { name: "登录网站账号", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "登录网站账号", exact: true });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/account-health$/);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("sign-out failure preserves the account and retry clears it", async ({ page }) => {
  await prepare(page);
  let signedIn = true;
  let attempts = 0;
  await page.route("**/api/auth/get-session", route => route.fulfill({ json: signedIn ? session : null }));
  await page.route("**/api/auth/sign-out", route => {
    attempts += 1;
    if (attempts === 1) return route.fulfill({ status: 500, json: { message: "Try again" } });
    signedIn = false;
    return route.fulfill({ json: { success: true } });
  });
  await page.goto("/account-health");
  const trigger = page.locator("[data-sidebar-account-trigger]");
  await expect(trigger).toContainText(user.name);
  await trigger.click();
  await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
  await expect(page.locator("[data-sidebar-account-menu]").getByRole("alert")).toHaveText("退出登录失败，请重试。");
  await expect(trigger).toContainText(user.name);
  await expect(page).toHaveURL(/\/account-health$/);
  await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(trigger).toContainText("未登录");
  await expect(page.locator("[data-sidebar-account-menu]")).toHaveCount(0);
  expect(attempts).toBe(2);
});

test("settings gear supports both Space and Enter without scrolling the page", async ({ page }) => {
  await prepare(page);
  for (const key of ["Space", "Enter"]) {
    await page.goto("/account-health");
    await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
    const settings = page.locator("[data-sidebar-settings-trigger]");
    await settings.focus();
    await expect(settings).toBeFocused();
    await page.keyboard.press(key);
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.locator("[data-user-settings-page]")).toBeVisible();
    await expect(page.locator("[data-app-scroll-area]")).toHaveJSProperty("scrollTop", 0);
  }
});

test("sidebar avatar draws only while hovered and respects reduced motion", async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => {
    const draw = WebGLRenderingContext.prototype.drawArrays;
    WebGLRenderingContext.prototype.drawArrays = function (...args) {
      const canvas = this.canvas;
      if (canvas instanceof HTMLCanvasElement && canvas.closest("[data-sidebar-account-avatar]")) {
        canvas.dataset.testDrawCount = String(Number(canvas.dataset.testDrawCount ?? 0) + 1);
      }
      return draw.apply(this, args);
    };
  });
  await page.goto("/account-health");
  const avatar = page.locator("[data-sidebar-account-avatar]");
  const canvas = avatar.locator("canvas");
  await expect(avatar).toHaveAttribute("data-fluid-orb-motion", "still");
  const draws = async () => Number(await canvas.getAttribute("data-test-draw-count"));
  await expect.poll(draws).toBeGreaterThan(0);
  // Let the initial intersection callback settle before measuring idle work.
  await page.waitForTimeout(150);
  const idle = await draws();
  await page.waitForTimeout(300);
  expect(await draws()).toBe(idle);
  await canvas.evaluate(node => { node.dataset.testIdentity = "initial"; });
  await avatar.hover();
  await expect(avatar).toHaveAttribute("data-fluid-orb-motion", "animated");
  await expect.poll(draws).toBeGreaterThan(idle + 2);
  await page.mouse.move(800, 100);
  await expect(avatar).toHaveAttribute("data-fluid-orb-motion", "still");
  const stopped = await draws();
  await page.waitForTimeout(300);
  expect(await draws()).toBe(stopped);
  await avatar.hover();
  await expect(avatar).toHaveAttribute("data-fluid-orb-motion", "animated");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(avatar).toHaveAttribute("data-fluid-orb-motion", "still");
  const reduced = await draws();
  await page.waitForTimeout(300);
  expect(await draws()).toBe(reduced);
  await expect(canvas).toHaveAttribute("data-test-identity", "initial");
});

test.describe("touch account avatar", () => {
  test.use({ hasTouch: true, viewport: { width: 375, height: 812 } });
  test("tapping the avatar opens the menu without starting a hover animation", async ({ page }) => {
    await prepare(page);
    await page.goto("/account-health");
    await page.getByRole("button", { name: "Toggle Sidebar" }).tap();
    const avatar = page.locator("[data-sidebar-account-avatar]");
    await expect(avatar).toHaveAttribute("data-fluid-orb-motion", "still");
    await avatar.tap();
    await expect(page.locator("[data-sidebar-account-menu]")).toBeVisible();
    await expect(avatar).toHaveAttribute("data-fluid-orb-motion", "still");
  });
});
