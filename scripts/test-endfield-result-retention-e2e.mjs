import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { catalog, DEFAULT_OPTIONS, STORAGE_KEY } from "@riic/endfield-solver/model.mjs";
import { RESULT_STORAGE_KEY } from "../apps/endfield/src/result-cache.ts";

const origin = process.env.ENDFIELD_E2E_ORIGIN || "http://127.0.0.1:5176";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("Local-only test");
const workspace = {
  version: 1, operators: catalog.slice(0, 8).map(op => ({ name: op.name, elite: 0 })),
  options: { ...DEFAULT_OPTIONS, levels: { center: 1, mfg1: 1, mfg2: 1, grow: 0, guest: 0 }, grow: { 晶植: 0, 菌类: 0, 矿物: 0 } },
};
const role = { uid: "fixture-uid", roleId: "fixture-role", serverId: "fixture-server", nickname: "测试管理员", serverName: "官服", isDefault: true };
const snapshot = {
  game: "endfield", role: { roleId: role.roleId, name: role.nickname, serverName: role.serverName, level: 1 },
  characters: workspace.operators.map((op, i) => ({ id: catalog[i].id, ...op, level: 1 })), facilitiesComplete: true, fetchedAt: 1,
  rooms: [{ id: "center", type: 0, level: 1 }, { id: "m1", type: 1, level: 1 }, { id: "m2", type: 1, level: 1 }],
};
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: "riic-endfield-locale", value: "zh", url: origin }, { name: "sidebar_state", value: "true", url: origin }]);
  await context.route("**/api/auth/get-session**", route => route.fulfill({ json: null }));
  await context.route("**/api/skland/*", route => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1);
    const data = action === "accounts" ? { accounts: [{ id: "fixture-first", label: role.nickname, source: "endfield" }], ownerKey: "fixture-owner" }
      : action === "roles" ? { roles: [role] } : { snapshot };
    return route.fulfill({ json: { success: true, data } });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin);
  await page.evaluate(({ key, value }) => globalThis.localStorage.setItem(key, JSON.stringify(value)), { key: STORAGE_KEY, value: { ...workspace, operators: [] } });
  await page.reload();
  const board = page.locator("[data-schedule-board]");
  // Import the real roster before solving; later equivalent syncs must retain the result.
  await page.getByRole("link", { name: "森空岛同步", exact: true }).click();
  await page.locator('[data-endfield-skland][aria-busy="false"]').waitFor();
  await page.getByRole("link", { name: "自动排班", exact: true }).click();
  await page.getByRole("button", { name: "生成排班", exact: true }).click();
  await expect(board).toBeVisible();
  await page.waitForFunction(key => !!globalThis.localStorage.getItem(key), RESULT_STORAGE_KEY);
  const original = await board.textContent();
  const goHome = () => page.getByRole("link", { name: "自动排班", exact: true }).click();
  for (const name of ["技能查询", "手动排班", "森空岛同步"]) {
    await page.getByRole("link", { name, exact: true }).click();
    if (name === "森空岛同步") await page.locator('[data-endfield-skland][aria-busy="false"]').waitFor();
    await goHome();
    await expect(board).toBeVisible();
    assert.equal(await board.textContent(), original, `${name} must retain the original result`);
  }
  // Repeated sync with unchanged facility levels must not invalidate the result.
  await page.getByRole("link", { name: "森空岛同步", exact: true }).click();
  await page.locator('[data-endfield-skland][aria-busy="false"]').waitFor();
  await page.getByRole("button", { name: "刷新数据", exact: true }).click();
  await page.locator('[data-endfield-skland][aria-busy="false"]').waitFor();
  await goHome();
  await expect(board).toBeVisible();
  await page.reload();
  await expect(board).toBeVisible();
  assert.equal(await board.textContent(), original, "Reload restores the original result without solving again");
  await page.locator("[data-sidebar-settings-trigger]").click();
  await page.getByRole("combobox", { name: "外观模式", exact: true }).click();
  await page.getByRole("option", { name: "夜间模式", exact: true }).click();
  await goHome();
  await expect(board).toBeVisible();
  await page.getByRole("button", { name: "生产配置", exact: true }).click();
  await page.getByRole("combobox", { name: "制造舱布局", exact: true }).fill("2干员");
  await page.getByRole("option", { name: "2干员", exact: true }).click();
  await page.getByRole("dialog", { name: "生产配置", exact: true }).getByRole("button", { name: "完成", exact: true }).click();
  await expect(board).toHaveCount(0);
  await page.waitForFunction(key => globalThis.localStorage.getItem(key) === null, RESULT_STORAGE_KEY);
  await page.reload();
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  await expect(board).toHaveCount(0);
  // Restore a known feasible layout before testing stale-roster rejection.
  await page.getByRole("button", { name: "生产配置", exact: true }).click();
  await page.getByRole("combobox", { name: "制造舱布局", exact: true }).fill("1干员1武器");
  await page.getByRole("option", { name: "1干员1武器", exact: true }).click();
  await page.getByRole("dialog", { name: "生产配置", exact: true }).getByRole("button", { name: "完成", exact: true }).click();
  await page.getByRole("button", { name: "生成排班", exact: true }).click();
  await expect(board).toBeVisible();
  await page.waitForFunction(key => !!globalThis.localStorage.getItem(key), RESULT_STORAGE_KEY);
  // Install a changed archive before hydration, after the old page's pagehide save.
  await page.addInitScript(key => {
    const saved = JSON.parse(globalThis.localStorage.getItem(key));
    saved.operators[0].elite = 1;
    globalThis.localStorage.setItem(key, JSON.stringify(saved));
  }, STORAGE_KEY);
  await page.reload();
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  await expect(board).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log("Passed: navigation, unchanged Skland sync/refresh, reload and appearance retain results; changed production/roster invalidates them. Local fixture only.");
} finally {
  await browser.close();
}
