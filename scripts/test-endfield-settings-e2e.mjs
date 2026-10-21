import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { DEFAULT_OPTIONS, STORAGE_KEY, catalog } from "../packages/endfield-solver/model.mjs";

const arknights = process.env.ARKNIGHTS_E2E_ORIGIN || "http://127.0.0.1:5175";
const endfield = process.env.ENDFIELD_E2E_ORIGIN || "http://127.0.0.1:5176";
for (const origin of [arknights, endfield]) {
  if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("Local-only test");
}
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: "riic-locale", value: "zh", url: arknights }, { name: "riic-endfield-locale", value: "zh", url: endfield }]);
  const fixture = () => ({ user: { id: "fixture-settings", name: "设置测试账号", email: "settings@example.invalid" }, session: { expiresAt: "2098-01-01T00:00:00.000Z" } });
  let session = fixture(), rejectAction = false;
  const operations = [];
  await context.route("**/api/**", route => route.fulfill({ status: 401, json: { error: { message: "Isolated fixture" } } }));
  await context.route("**/api/auth/get-session**", route => route.fulfill({ json: session }));
  await context.route("**/api/account/settings/*", route => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1);
    operations.push(action);
    if (rejectAction) return route.fulfill({ status: 400, json: { success: false, error: { code: action === "delete" ? "INVALID_PASSWORD" : "REQUEST_FAILED" } } });
    if (action === "extend") {
      session.session.expiresAt = "2099-01-01T00:00:00.000Z";
      return route.fulfill({ json: { success: true, data: { expiresAt: session.session.expiresAt } } });
    }
    session = null;
    return route.fulfill({ json: { success: true } });
  });
  const saved = { version: 1, operators: [{ name: catalog[0].name, elite: 0 }], options: DEFAULT_OPTIONS };
  await context.addInitScript(({ origin, key, saved }) => {
    if (globalThis.location.origin === origin && !globalThis.sessionStorage.getItem("fixture-seeded")) {
      globalThis.localStorage.setItem(key, JSON.stringify(saved));
      globalThis.localStorage.setItem("unrelated-fixture", "keep");
      globalThis.sessionStorage.setItem("fixture-seeded", "true");
    }
  }, { origin: endfield, key: STORAGE_KEY, saved });
  const page = await context.newPage();
  page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(60000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const ready = () => page.locator('body[data-app-hydrated="true"]').waitFor();
  const focus = () => page.evaluate(() => globalThis.dispatchEvent(new Event("focus")));
  const roster = () => page.evaluate(key => JSON.parse(globalThis.localStorage.getItem(key))?.operators ?? null, STORAGE_KEY);
  const confirmAction = async (triggerName, title, choice) => {
    const trigger = page.getByRole("button", { name: triggerName, exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeFocused();
    await dialog.getByRole("button", { name: choice, exact: true }).click();
    await expect(dialog).not.toBeVisible();
    if (choice === "取消") await expect(trigger).toBeFocused();
  };
  const downloadFile = async button => {
    const event = page.waitForEvent("download");
    await button.click();
    const download = await event;
    return { name: download.suggestedFilename(), value: JSON.parse(await readFile(await download.path(), "utf8")) };
  };
  await page.goto(`${endfield}/settings`); await ready(); await focus();
  await expect(page.locator("[data-settings-identity]")).toContainText("设置测试账号");
  assert.equal(page.url(), `${endfield}/settings`);
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
  const backdropPreference = page.getByRole("checkbox", { name: /显示帝江号背景|Show Dijiang backdrop/ });
  await expect(backdropPreference).not.toBeChecked();
  await backdropPreference.check();
  await page.getByRole("combobox", { name: "外观模式", exact: true }).click();
  await page.getByRole("option", { name: "夜间模式", exact: true }).click();
  await page.reload(); await ready(); await focus();
  await expect(backdropPreference).toBeChecked();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await page.getByRole("combobox", { name: "外观模式", exact: true }).click();
  await page.getByRole("option", { name: "日间模式", exact: true }).click();
  await page.reload(); await ready(); await focus();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
  const exported = await downloadFile(page.getByRole("button", { name: "导出当前配置", exact: true }));
  assert.equal(exported.name, "endfield-workspace.json");
  assert.deepEqual(exported.value.operators, saved.operators);
  const timeLimit = page.getByRole("combobox", { name: "时间上限", exact: true });
  const nodeLimit = page.getByRole("combobox", { name: "节点上限", exact: true });
  assert.equal(await timeLimit.inputValue(), "5s");
  assert.equal(await nodeLimit.inputValue(), "200,000");
  await timeLimit.fill("15s"); await page.getByRole("option", { name: "15s", exact: true }).click();
  await nodeLimit.fill("500,000"); await page.getByRole("option", { name: "500,000", exact: true }).click();
  await page.waitForFunction(key => JSON.parse(globalThis.localStorage.getItem(key)).options.budget === 500000, STORAGE_KEY);
  await page.reload(); await ready(); await focus();
  assert.equal(await timeLimit.inputValue(), "15s");
  assert.equal(await nodeLimit.inputValue(), "500,000");
  await page.getByRole("button", { name: "恢复默认预算", exact: true }).click();
  assert.equal(await timeLimit.inputValue(), "5s");
  assert.equal(await nodeLimit.inputValue(), "200,000");
  await page.getByRole("combobox", { name: "外观模式", exact: true }).click();
  await page.getByRole("option", { name: "夜间模式", exact: true }).click();
  await page.locator('[data-settings-group="display"]').getByRole("button", { name: "EN", exact: true }).click();
  await page.getByRole("checkbox", { name: /Load operator and weapon images/ }).uncheck();
  await page.reload(); await ready(); await focus();
  await expect(backdropPreference).toBeChecked();
  await backdropPreference.uncheck();
  await page.reload(); await ready(); await focus();
  await expect(backdropPreference).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Load operator and weapon images/ })).not.toBeChecked();
  await page.goto(`${endfield}/roster`); await ready();
  await expect(page.getByRole("dialog", { name: "My operators", exact: true })).toBeVisible();
  await expect(page.locator(".ef-artwork img")).toHaveCount(0);
  await page.getByRole("button", { name: "Close my operators", exact: true }).click();
  await page.locator("[data-sidebar-settings-trigger]").click();
  await page.waitForURL(`${endfield}/settings`);
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.goto(`${arknights}/settings`);
  await expect(page.locator("[data-user-settings-page]")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.evaluate(() => globalThis.localStorage.setItem("ark-settings-fixture", "keep"));
  await page.goto(`${endfield}/settings`); await ready(); await focus();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("checkbox", { name: /Load operator and weapon images/ })).not.toBeChecked();
  await page.locator('[data-settings-group="display"]').getByRole("button", { name: "中文", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), "Native Endfield settings fit mobile");
  await page.goto(`${endfield}/roster`); await ready();
  await page.getByRole("button", { name: "关闭我的干员", exact: true }).click();
  await page.locator("[data-endfield-mobile-navigation]").click();
  const drawer = page.getByRole("dialog", { name: "Sidebar" });
  await drawer.locator("[data-sidebar-settings-trigger]").click();
  await page.waitForURL(`${endfield}/settings`);
  await expect(drawer).not.toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await focus();
  await expect(page.locator("[data-settings-identity]")).toBeVisible();

  await page.getByRole("button", { name: "续期 30 天", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("续期 30 天");
  await expect(page.locator('[data-settings-group="security"]')).toContainText("2099");
  const beforeRevoke = operations.length;
  await confirmAction("退出所有设备", "退出所有设备", "取消");
  assert.equal(operations.length, beforeRevoke);
  rejectAction = true;
  await confirmAction("退出所有设备", "退出所有设备", "确认退出");
  await expect(page.getByRole("alert")).toContainText("账号操作失败");
  await expect(page.locator("[data-settings-identity]")).toBeVisible();
  rejectAction = false;
  await confirmAction("退出所有设备", "退出所有设备", "确认退出");
  await expect(page.locator("[data-settings-identity]")).toHaveCount(0);
  assert.deepEqual(await roster(), saved.operators);

  session = fixture(); await focus();
  await expect(page.locator("[data-settings-identity]")).toBeVisible();
  await expect(page.getByRole("button", { name: "永久注销账号", exact: true })).toBeDisabled();
  await page.getByLabel("当前密码", { exact: true }).fill("fixture-password");
  rejectAction = true;
  const beforeDelete = operations.length;
  await confirmAction("永久注销账号", "永久注销账号", "取消");
  assert.equal(operations.length, beforeDelete, "Cancelling account deletion never calls the API");
  await confirmAction("永久注销账号", "永久注销账号", "确认注销");
  await expect(page.getByRole("alert")).toContainText("当前密码不正确");
  await expect(page.getByLabel("当前密码", { exact: true })).toHaveValue("");
  await expect(page.locator("[data-settings-identity]")).toBeVisible();
  rejectAction = false;
  await page.getByLabel("当前密码", { exact: true }).fill("fixture-password");
  await page.getByRole("checkbox", { name: "同时清除当前浏览器的终末地本地数据", exact: true }).uncheck();
  await confirmAction("永久注销账号", "永久注销账号", "确认注销");
  await expect(page.locator("[data-settings-identity]")).toHaveCount(0);
  assert.deepEqual(await roster(), saved.operators, "Deleting an account can retain the local roster");

  await confirmAction("清除数据", "清除本地数据", "取消");
  assert.deepEqual(await roster(), saved.operators);
  const clearedNavigation = page.waitForEvent("framenavigated", frame => frame === page.mainFrame());
  await confirmAction("清除数据", "清除本地数据", "确认清除");
  await clearedNavigation; await ready();
  await expect.poll(roster).toEqual([]);
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
  await expect(backdropPreference).not.toBeChecked();
  assert.equal(await page.evaluate(() => globalThis.localStorage.getItem("unrelated-fixture")), "keep");
  await page.reload(); await ready();
  await expect.poll(roster).toEqual([]);
  await page.goto(`${arknights}/settings`);
  assert.equal(await page.evaluate(() => globalThis.localStorage.getItem("ark-settings-fixture")), "keep");

  // A fresh document is required to exercise corrupt archive recovery.
  await page.goto(`${endfield}/settings`); await ready();
  await page.evaluate(key => {
    // Disable the old document's pagehide persistence by replacing its saved data
    // from the new document before React loads, using a one-shot init marker below.
    globalThis.sessionStorage.setItem("fixture-corrupt-next", key);
  }, STORAGE_KEY);
  await context.addInitScript(() => {
    const key = globalThis.sessionStorage.getItem("fixture-corrupt-next");
    if (key) { globalThis.localStorage.setItem(key, "{broken-fixture"); globalThis.sessionStorage.removeItem("fixture-corrupt-next"); }
  });
  await page.reload(); await ready();
  const backup = await downloadFile(page.getByRole("button", { name: "导出原始存档", exact: true }));
  assert.equal(backup.value.raw, "{broken-fixture");
  await confirmAction("修复本地存档", "修复本地存档", "取消");
  assert.equal(await page.evaluate(key => globalThis.localStorage.getItem(key), STORAGE_KEY), "{broken-fixture");
  await confirmAction("修复本地存档", "修复本地存档", "确认修复");
  await expect.poll(roster).toEqual([]);
  assert.deepEqual(errors, [], "No runtime or hydration errors");
  console.log("Passed: separate native settings, no iframe/redirect, independent theme/language, image preference, export, expiry renewal, revoke/delete success and failure, confirmation, local cleanup without save resurrection, corrupt recovery and mobile width. Mock account operations only.");
  await context.close();
} finally {
  await browser.close();
}
