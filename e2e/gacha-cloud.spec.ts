import { expect, test } from "@playwright/test";
import { mockApis, seedPreferences, requestId, authenticatedSklandSnapshot } from "./production-readiness.fixture";
import { gachaAccountOptions } from "../src/gacha-accounts";
import type { GachaHistory } from "../src/gacha-history";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: {
    session: { id: "gacha-test-session", token: "test-token", userId: "test-user", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    user: { id: "test-user", name: "测试用户", email: "test@example.com", emailVerified: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  } }));
});

test("cloud gacha switches Skland accounts, leaves legacy data untouched without import controls, and survives authorization removal", async ({ page }) => {
  test.slow();
  await mockApis(page, { sklandConfigured: true });
  await seedPreferences(page);
  const accounts = ["10001", "10002"].map((uid, index) => ({ accountId: `skland-${index}`, selectedUid: uid, credentialExpiresAt: Date.now() + 3600000,
    roles: [{ uid, nickname: `角色${index + 1}`, channelName: "官服", isDefault: true }] }));
  let activeIndex = 0;
  const snapshot = () => ({ ...authenticatedSklandSnapshot, roles: accounts[activeIndex].roles,
    player: { ...authenticatedSklandSnapshot.player, ...accounts[activeIndex].roles[0], level: 100 + activeIndex,
      avatarUrl: activeIndex === 0 ? "/images/operator-portraits/002_amiya.webp" : "/images/operator-portraits/103_angel.webp" },
  });
  const sklandSession = () => ({ authenticated: true, configured: true, accounts, activeAccountId: accounts[activeIndex].accountId,
    bindingCount: accounts.length, scheduleSnapshot: snapshot(), statusSnapshot: snapshot() });
  await page.route(/\/api\/skland\/accounts(?:[/?]|$)/, (route) => route.fulfill({ json: { success: true, data: sklandSession(), requestId } }));
  await page.route("**/api/skland/status/refresh", (route) => route.fulfill({ json: { success: true, data: {
    accounts, activeAccountId: accounts[activeIndex].accountId, snapshot: snapshot(),
  }, requestId } }));
  await page.route("**/api/skland/role", (route) => {
    const body = route.request().postDataJSON();
    activeIndex = accounts.findIndex((account) => account.accountId === body.accountId && account.selectedUid === body.uid);
    expect(activeIndex).toBeGreaterThanOrEqual(0);
    return route.fulfill({ json: { success: true, data: sklandSession(), requestId } });
  });
  const identity = page.locator("[data-skland-player-identity]");
  const savedCount = page.getByText("已保存寻访", { exact: true }).locator("..").locator("strong");
  const switchInSkland = async (index: number) => {
    await page.goto("/skland");
    await page.locator("[data-skland-account-select]").getByRole("combobox").fill(accounts[index].selectedUid);
    await page.getByRole("option", { name: new RegExp(accounts[index].roles[0].nickname) }).click();
    await expect(identity.getByRole("heading", { name: accounts[index].roles[0].nickname })).toBeVisible();
    const identityText = await identity.innerText();
    const avatar = await identity.locator("img").getAttribute("src");
    await page.locator('[data-primary-navigation-page="gacha"]:visible').click();
    await expect(identity).toHaveText(identityText, { useInnerText: true });
    await expect(identity.locator("img")).toHaveAttribute("src", avatar!);
    await expect(page.locator("[data-gacha-account-select], [data-skland-account-select]")).toHaveCount(0);
  };
  let authorizedUids = ["10001"];
  const record = { id: "first", category: "normal", poolId: "p", poolName: "云端测试池", charId: "char_103_angel", charName: "能天使", stars: 6, isNew: true, timestamp: Date.now() - 1000, pos: 0 };
  const history: GachaHistory = { uid: "10001", nickname: "角色1", records: [record], fetchedAt: new Date().toISOString(), warnings: [] };
  const archives = new Map<string, GachaHistory>([[history.uid, history], ["10002", { ...history, uid: "10002", nickname: "角色2", records: [] }]]);
  const legacy = { ...history, records: [record, { ...record, id: "older", timestamp: record.timestamp - 1000 }] };
  await page.addInitScript((value) => localStorage.setItem("aic-gacha-history-v1:10001", JSON.stringify(value)), legacy);
  let imports = 0;
  let refreshes = 0;
  await page.route("**/api/gacha/session", (route) => {
    if (route.request().method() === "DELETE") { authorizedUids = []; return route.fulfill({ json: { success: true, data: { disconnected: true } } }); }
    const roles = accounts.flatMap((account) => account.roles);
    return route.fulfill({ json: { success: true, data: gachaAccountOptions(accounts, [...archives.values()], roles.filter((role) => authorizedUids.includes(role.uid))), requestId } });
  });
  await page.route("**/api/gacha/skland", (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ accountId: "skland-1", uid: "10002", gachaConsent: true });
    authorizedUids = ["10002"];
    return route.fulfill({ json: { success: true, data: { roles: accounts[1].roles, selectedUid: "10002" }, requestId } });
  });
  await page.route("**/api/gacha/history?*", (route) => {
    const uid = new URL(route.request().url()).searchParams.get("uid")!;
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      expect(authorizedUids).toContain(uid);
      if (body.action === "import") imports++;
      expect(body.action).toBe("refresh");
      refreshes++; archives.set(uid, { ...history, uid, nickname: "角色2" });
    } else if (route.request().method() === "DELETE") {
      expect(route.request().postDataJSON()).toEqual({ confirmUid: uid });
      archives.delete(uid);
    }
    return route.fulfill({ json: { success: true, data: route.request().method() === "DELETE" ? { cleared: true } : archives.get(uid) ?? null, requestId } });
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/gacha");
  await expect(identity.getByRole("heading", { name: "角色1" })).toBeVisible();
  await expect(identity.getByText("Lv.100", { exact: true })).toBeVisible();
  await expect(identity.getByText("官服", { exact: true })).toBeVisible();
  await expect(savedCount).toHaveText("1");
  await expect(page.locator("[data-gacha-history]").getByRole("heading", { name: "寻访记录", exact: true })).toHaveCount(0);
  await expect(page.getByText(/抽已保存至云端/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /导入|上传本机历史/ })).toHaveCount(0);
  expect(await page.evaluate(() => !!localStorage.getItem("aic-gacha-history-v1:10001"))).toBe(true);
  await switchInSkland(1);
  await expect(savedCount).toHaveText("0");
  await expect(page.getByRole("button", { name: "刷新", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "授权记录", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "授权寻访记录" });
  for (const checkbox of await dialog.getByRole("checkbox").all()) await checkbox.check();
  await dialog.getByRole("button", { name: "同步本站森空岛登录状态" }).click();
  await expect(savedCount).toHaveText("1");
  expect(refreshes).toBe(1);
  await page.getByRole("button", { name: "解除授权", exact: true }).click();
  await expect(page.getByRole("button", { name: "解除授权", exact: true })).toHaveCount(0);
  await expect(savedCount).toHaveText("1");
  await page.reload();
  await expect(identity.getByRole("heading", { name: "角色2" })).toBeVisible();
  await expect(savedCount).toHaveText("1");
  await switchInSkland(0);
  await expect(savedCount).toHaveText("1");
  await expect(page.getByRole("button", { name: "刷新", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "导出", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "删除云端寻访记录", exact: true }).click();
  await expect(savedCount).toHaveCount(0);
  await switchInSkland(1);
  await expect(savedCount).toHaveText("1");
  expect(refreshes).toBe(1);
  expect(imports).toBe(0);
});

test("Skland status reuses compact gacha action buttons without losing account selection", async ({ page }) => {
  await mockApis(page, { sklandConfigured: true, sklandSnapshot: authenticatedSklandSnapshot });
  await seedPreferences(page);
  await page.goto("/skland");
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const marker of ["data-skland-add-account", "data-skland-logout"]) {
      const button = page.locator(`[${marker}]`);
      await expect(button).toHaveAttribute("data-setup-action", "");
      await expect(button).toHaveCSS("border-radius", "18px");
      expect((await button.boundingBox())!.width).toBeLessThan(152);
    }
    await expect(page.locator("[data-skland-account-select]").getByRole("combobox")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.locator("[data-skland-add-account]").click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("gacha keeps the current Skland role when archive order or QR authorization differs", async ({ page }) => {
  const role = { uid: "10001", nickname: "当前角色", channelName: "官服", isDefault: true };
  await mockApis(page, { sklandConfigured: true, sklandSnapshot: {
    ...authenticatedSklandSnapshot, player: { ...authenticatedSklandSnapshot.player, ...role }, roles: [role],
  } });
  await seedPreferences(page);
  await page.clock.install();
  await page.route("**/api/gacha/session", (route) => route.fulfill({ json: { success: true,
    data: gachaAccountOptions([], [{ uid: "10002", nickname: "其他档案" }, role], []), requestId } }));
  let writes = 0;
  await page.route("**/api/gacha/history?*", (route) => {
    expect(new URL(route.request().url()).searchParams.get("uid")).toBe("10001");
    if (route.request().method() !== "GET") writes++;
    return route.fulfill({ json: { success: true, data: { uid: "10001", nickname: role.nickname, records: [], warnings: [], fetchedAt: new Date().toISOString() }, requestId } });
  });
  await page.route("**/api/gacha/qr", (route) => route.fulfill({ json: { success: true, data: { scanId: "wrong-role", scanUrl: "hypergryph://scan_login?scanId=wrong-role", expiresInSeconds: 300 }, requestId } }));
  await page.route("**/api/gacha/qr/status", (route) => route.fulfill({ json: { success: true, data: {
    status: "authenticated", roles: [{ uid: "10002", nickname: "其他角色" }],
  }, requestId } }));
  await page.goto("/gacha");
  const identity = page.locator("[data-skland-player-identity]");
  await expect(identity.getByRole("heading", { name: "当前角色" })).toBeVisible();
  await page.getByRole("button", { name: "授权记录", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "授权寻访记录" });
  for (const checkbox of await dialog.getByRole("checkbox").all()) await checkbox.check();
  await dialog.getByRole("button", { name: "生成二维码", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("等待扫码确认");
  await page.clock.fastForward(3100);
  await expect(dialog.getByRole("alert")).toContainText("扫码账号与森空岛状态中心当前角色不一致");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(identity.getByRole("heading", { name: "当前角色" })).toBeVisible();
  expect(writes).toBe(0);
  await expect(page.locator("[data-gacha-account-select]")).toHaveCount(0);
});
