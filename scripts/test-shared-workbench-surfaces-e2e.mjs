import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import { URL } from "node:url";
import { chromium, expect as baseExpect } from "@playwright/test";
import { catalog, DEFAULT_OPTIONS, STORAGE_KEY } from "@riic/endfield-solver/model.mjs";

const expect = baseExpect.configure({ timeout: 30000 });
const endfield = process.env.ENDFIELD_E2E_ORIGIN || "http://127.0.0.1:5176";
const arknights = process.env.ARKNIGHTS_E2E_ORIGIN || "http://127.0.0.1:5174";
for (const origin of [endfield, arknights]) {
  if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("Local preview only");
}
const operators = catalog.map(op => ({ name: op.name, elite: 4, latestSpaceshipSkillNodes: [] }));
const role = { uid: "fixture", roleId: "fixture-role", serverId: "fixture-server", nickname: "同步测试", serverName: "官服", isDefault: true };
const snapshot = {
  game: "endfield", role: { roleId: role.roleId, name: role.nickname, serverName: role.serverName, level: 30 },
  characters: [...catalog.map(op => ({ id: op.id, name: op.name, elite: 4, level: 90, latestSpaceshipSkillNodes: [] })),
    { id: "chr_0003_endminf", name: "管理员", elite: 4, level: 90, latestSpaceshipSkillNodes: [] }],
  rooms: [], facilitiesComplete: false, rosterComplete: true, fetchedAt: Date.now(),
};
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
const errors = [];
try {
  await context.addCookies([
    { name: "riic-endfield-locale", value: "zh", url: endfield },
    { name: "riic-locale", value: "zh", url: arknights },
  ]);
  await context.addInitScript(({ key, operators, options }) => {
    if (!globalThis.localStorage.getItem(key)) globalThis.localStorage.setItem(key, JSON.stringify({ version: 1, operators, options }));
    globalThis.localStorage.setItem("arknights-infra-calc-beta-onboarding-v1", "1");
  }, { key: STORAGE_KEY, operators, options: DEFAULT_OPTIONS });
  // All API requests stay inside fixtures; no real Skland credentials or account writes.
  await context.route("**/api/**", route => route.fulfill({ status: 401, json: { success: false, error: { message: "Isolated fixture" } } }));
  await context.route("**/api/auth/get-session**", route => route.fulfill({ json: { user: { id: "fixture-user", name: "测试账号", email: "fixture@example.invalid" }, session: { expiresAt: "2099-01-01" } } }));
  await context.route("**/api/account/feature-access", route => route.fulfill({ json: { agent: false, billing: false } }));
  await context.route("**/api/releases*", route => route.fulfill({ json: { success: true, data: { environment: "local", releases: [] } } }));
  await context.route(`${endfield}/api/skland/*`, route => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1);
    const data = action === "accounts" ? { ownerKey: "fixture-owner", accounts: [{ id: "fixture-account", label: role.nickname, source: "endfield" }] }
      : action === "roles" ? { roles: [role] } : action === "sync" ? { snapshot } : {};
    return route.fulfill({ json: { success: true, data } });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${endfield}/skland`);
  const live = page.locator('[data-slot="live-activity"][data-activity-kind="skland"]');
  await expect(live).toHaveAttribute("data-activity-phase", "warning");
  const summary = live.locator("[data-skland-sync-status]");
  await expect(summary).toContainText(`已同步 ${catalog.length} 名可排班干员`);
  await expect(summary).toContainText("设施数据不完整，已保留原设施配置");
  await expect(summary).toContainText("无基建技能，未纳入排班：管理员");
  await expect(page.locator("[data-endfield-skland] [data-skland-sync-status]")).toHaveCount(0);
  await live.getByRole("button", { name: "关闭同步提示" }).click();
  await expect(live).toHaveCount(0);
  const tabs = page.locator(".ef-sync-tabs [data-compact-tabs]");
  await expect(tabs.getByRole("tab")).toHaveCount(5);
  assert.ok((await tabs.boundingBox()).height <= 34, "Skland tabs use the compact desktop size");
  await tabs.getByRole("tab", { name: "状态总览" }).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(tabs.getByRole("tab", { name: "干员状态" })).toHaveAttribute("aria-selected", "true");
  for (const name of ["武器状态", "仓库背包", "帝江号", "状态总览"]) {
    await tabs.getByRole("tab", { name, exact: true }).click();
    await expect(tabs.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
  }
  await page.getByRole("link", { name: "技能Wiki", exact: true }).click();
  const scrollbar = page.locator("#endfield-scrollbar .os-scrollbar-vertical");
  await expect(scrollbar).toHaveCount(1);
  const theme = await scrollbar.evaluate(el => {
    const style = globalThis.getComputedStyle(el);
    return [style.getPropertyValue("--os-size").trim(), style.getPropertyValue("--os-handle-perpendicular-size").trim(), style.getPropertyValue("--os-handle-bg").trim()];
  });
  assert.deepEqual(theme.slice(0, 2), ["8px", "4px"]);
  console.log("Skland summary uses Live Activity; shared compact tabs and page scrollbar passed");

  await page.getByRole("link", { name: "手动排班", exact: true }).click();
  const slot = page.locator('[data-manual-slot="中枢:a:0"]');
  await slot.click();
  const dialog = page.getByRole("dialog", { name: "选择干员", exact: true });
  await expect(dialog.locator(".ef-manual-choice")).toHaveCount(catalog.length);
  await expect(dialog.locator(".ef-roster-card")).toHaveCount(0);
  const first = dialog.locator(`[data-operator-id="${catalog[0].id}"]`);
  await first.hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText(catalog[0].skills[0].name);
  await expect(tooltip.locator('[data-skill-unlocked="false"]').first()).toBeVisible();
  await first.click();
  await expect(dialog).toHaveCount(0);
  await expect(slot).toContainText(catalog[0].name);
  await page.locator('[data-manual-slot="中枢:b:0"]').click();
  await expect(first).toHaveAttribute("aria-disabled", "true");
  await page.mouse.move(0, 0);
  await page.keyboard.press("Tab");
  await first.focus();
  await expect(first).toBeFocused();
  await expect(tooltip).toContainText("已安排至其他工位");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await dialog.locator(`[data-operator-id="${catalog[1].id}"]`).focus();
  await expect(tooltip).toContainText(catalog[1].skills[0].name);
  const bodyScrollbar = dialog.locator(".ef-dialog-body > .os-scrollbar-vertical");
  await expect(bodyScrollbar).toHaveCount(1);
  assert.equal(await bodyScrollbar.evaluate(el => globalThis.getComputedStyle(el).getPropertyValue("--os-handle-perpendicular-size").trim()), "4px");
  const close = dialog.getByRole("button", { name: "关闭干员选择", exact: true });
  await close.hover();
  assert.equal(await close.evaluate(el => globalThis.getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)");
  await page.mouse.down();
  assert.equal(await close.evaluate(el => globalThis.getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)");
  await page.mouse.up();
  await expect(dialog).toHaveCount(0);
  console.log("Avatar-only selection, skill hover/focus, duplicate prevention and dialog chrome passed");

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await slot.click();
    const bounds = await dialog.evaluate(el => {
      const body = el.querySelector(".ef-dialog-body").getBoundingClientRect();
      return { fits: el.scrollWidth <= el.clientWidth, portraitsFit: [...el.querySelectorAll(".ef-manual-choice>.ef-operator-portrait")].every(p => {
        const rect = p.getBoundingClientRect();
        return rect.left >= body.left && rect.right <= body.right;
      }) };
    });
    assert.deepEqual(bounds, { fits: true, portraitsFit: true });
    await close.click();
    await page.goto(`${endfield}/skland`);
    await expect(live).toBeVisible();
    await live.getByRole("button", { name: "关闭同步提示" }).click();
    assert.equal(await tabs.evaluate(el => el.scrollWidth <= el.clientWidth), true, "Compact tabs wrap on narrow screens");
    await page.goto(`${endfield}/manual`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => globalThis.localStorage.setItem("riic-color-mode", "dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await slot.click();
  await first.hover();
  await expect(tooltip).toContainText(catalog[0].skills[0].name);
  await close.hover();
  assert.equal(await close.evaluate(el => globalThis.getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)");
  await close.click();

  await page.goto(`${arknights}/skills`);
  await expect(page.locator('[data-primary-navigation-page="skill-query"]')).toHaveAccessibleName("技能Wiki");
  await expect(page.getByRole("heading", { name: "技能Wiki", exact: true })).toBeVisible();
  await expect(page).toHaveTitle(/技能Wiki/);
  const arkScrollbar = page.locator("[data-app-page-scrollbar] .os-scrollbar-vertical").first();
  await expect(arkScrollbar).toHaveCount(1);
  assert.deepEqual(await arkScrollbar.evaluate(el => {
    const style = globalThis.getComputedStyle(el);
    return [style.getPropertyValue("--os-size").trim(), style.getPropertyValue("--os-handle-perpendicular-size").trim(), style.getPropertyValue("--os-handle-bg").trim()];
  }), theme, "Both sites use the same scrollbar theme");
  assert.deepEqual(errors, []);
  console.log("390px/320px layouts, dark mode, both Skill Wiki labels and matching scrollbar themes passed");
} finally {
  await context.close();
  await browser.close();
}
