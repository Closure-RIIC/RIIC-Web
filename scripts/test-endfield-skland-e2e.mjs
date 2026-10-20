import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { catalog, DEFAULT_OPTIONS, STORAGE_KEY } from "../packages/endfield-solver/model.mjs";
import { normalizeEndfieldSnapshot } from "../packages/endfield-skland/model.ts";
import { normalizeEndfieldInventory } from "../packages/endfield-skland/inventory.ts";
import { normalizeEndfieldWeapons } from "../packages/endfield-skland/weapons.ts";

const origin = process.env.ENDFIELD_E2E_ORIGIN || "http://127.0.0.1:5176";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("Local-only test");
const role = { uid: "fixture-uid", roleId: "fixture-role", serverId: "fixture-server", nickname: "测试管理员", serverName: "官服", isDefault: true };
const detail = {
  base: { roleId: role.roleId, name: role.nickname, serverName: role.serverName, level: 30, charNum: 4, weaponNum: 12, worldLevel: 5, mainMission: { description: "测试主线任务" } },
  config: { charSwitch: true },
  chars: [...catalog.slice(0, 2).map((operator, index) => ({
    id: `owned-instance-${index}`, charData: { id: operator.id, name: operator.name, profession: { key: "p", value: "测试职业" } },
    evolvePhase: index + 1, level: 60, potentialLevel: 2,
    weapon: { level: 50, weaponData: { id: "wpn_sword_0003", name: "测试武器" } },
    bodyEquip: { equipData: { name: "测试护甲" } }, userSkills: { skillA: { level: 8 } },
  })), { id: "owned-instance-admin", charData: { id: "chr_0003_endminf", name: "管理员" }, evolvePhase: 4, level: 90 },
  { id: "new-unknown", charData: { name: "未知测试干员" }, evolvePhase: 0, level: 1 }],
  spaceShip: { rooms: [
    { id: "center", type: 0, level: 4, chars: [{ charId: catalog[0].id, physicalStrength: 83, favorability: 60 }], reports: { "123": { output: { item: 18 } } } },
    { id: "m1", type: 1, level: 3 }, { id: "m2", type: 1, level: 2 }, { id: "grow", type: 2, level: 2 }, { id: "guest", type: 5, level: 2 },
  ] },
  dailyMission: { dailyActivation: 80, maxDailyActivation: 100 }, dungeon: { curStamina: "120", maxStamina: "240" },
  achieve: { count: 50 }, bpSystem: { curLevel: 20, maxLevel: 60 },
  domain: [{ name: "测试地区", settlements: [{ name: "测试据点", remainMoney: "888" }], collections: [{ blackboxCount: 20 }] }],
  futureCategory: { fixtureField: "新字段也会显示" },
};
const snapshot = normalizeEndfieldSnapshot(detail);
const materials = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`material-${i}`, {
  id: `material-${i}`, name: i === 0 ? "测试折金" : `测试材料 ${i}`,
}]));
const materialCatalog = { code: 0, data: {
  materials, charExpMaterials: Object.fromEntries(Object.entries(materials).slice(1, 5)),
  weaponExpMaterials: Object.fromEntries(Object.entries(materials).slice(5, 8)),
} };
const inventory = (selected, offset = 0) => normalizeEndfieldInventory(materialCatalog, {
  code: 0, data: { userGameData: { roleId: selected.roleId, serverId: selected.serverId,
    itemCount: Object.fromEntries(Object.keys(materials).map((id, i) => [id, i + offset])) } },
}, selected);
snapshot.inventory = inventory(role);
snapshot.weapons = normalizeEndfieldWeapons({ code: 0, data: { userGameData: { ...role, userWeapons: [
  { weaponId: "wpn_sword_0003", level: 50, breakthroughLevel: 0, refineLevel: 0 },
  { weaponId: "wpn_sword_0003", level: 20, breakthroughLevel: 1, refineLevel: 2 },
] } } }, role);
const secondRole = { ...role, roleId: "second-role", nickname: "第二个角色" };
const secondSnapshot = normalizeEndfieldSnapshot({ ...detail, base: { ...detail.base, roleId: secondRole.roleId, name: secondRole.nickname } });
secondSnapshot.inventory = inventory(secondRole, 900);
const browser = await chromium.launch({ headless: true });
const errors = [], requests = [];
let accounts = [], delayedSync = null, releaseSync = null, failSync = false, badSnapshot = false, partialSnapshot = false, signedOut = false, failInventory = false;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const savedRoster = catalog.slice(-2).map(op => ({ name: op.name, elite: 0 }));
  await context.addInitScript(({ key, workspace }) => {
    if (!globalThis.localStorage.getItem(key)) globalThis.localStorage.setItem(key, JSON.stringify(workspace));
  }, { key: STORAGE_KEY, workspace: { version: 1, operators: savedRoster, options: DEFAULT_OPTIONS } });
  await context.addCookies([{ name: "riic-endfield-locale", value: "zh", url: origin }, { name: "sidebar_state", value: "true", url: origin }]);
  await context.route("**/api/auth/get-session**", route => route.fulfill({ json: signedOut ? null : { user: { id: "fixture-site-user", name: "网站测试账号", email: "fixture@example.invalid" }, session: { expiresAt: "2099-01-01" } } }));
  await context.route("**/api/auth/sign-out", route => {
    signedOut = true;
    return route.fulfill({ json: { success: true } });
  });
  await context.route("**/api/skland/*", async route => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1), body = route.request().postDataJSON();
    requests.push({ action, body });
    if (action === "accounts" && signedOut) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ success: false, error: { message: "请登录网站账号" } }) });
    if (action === "sync" && failSync) return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ success: false, error: { message: "模拟同步失败" } }) });
    const selectedSnapshot = body?.accountId === "fixture-second" ? secondSnapshot : snapshot;
    if (action === "sync" && delayedSync) await delayedSync;
    if (action === "credential") accounts = [{ id: "fixture-first", label: role.nickname, source: "endfield" }];
    if (action === "qr-status") accounts = [...accounts.filter(a => a.id !== "fixture-second"), { id: "fixture-second", label: secondRole.nickname, source: "endfield" }];
    if (action === "disconnect") accounts = accounts.filter(a => a.id !== body.accountId);
    const data = action === "accounts" ? { accounts, ownerKey: "fixture-owner" }
      : action === "roles" ? { roles: [body.accountId === "fixture-second" ? secondRole : role] }
        : action === "sync" ? { snapshot: badSnapshot ? { ...selectedSnapshot, characters: [selectedSnapshot.characters[0], selectedSnapshot.characters[0]] } : partialSnapshot ? { ...selectedSnapshot, rosterComplete: false, weapons: undefined } : failInventory ? { ...selectedSnapshot, inventory: normalizeEndfieldInventory(materialCatalog, undefined, role) } : selectedSnapshot }
          : action === "credential" ? { accountId: "fixture-first", roles: [role] }
            : action === "qr" ? { scanId: "fixture-scan", scanUrl: "https://example.invalid/qr", expiresInSeconds: 600 }
              : action === "qr-status" ? { status: "authenticated", accountId: "fixture-second", roles: [secondRole] }
                : { disconnected: true };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ success: true, data }) }).catch(() => {});
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(60000);
  page.on("pageerror", error => errors.push(error.message));
  const choose = async (name, label) => {
    await page.getByRole("combobox", { name, exact: true }).fill(label);
    await page.getByRole("option", { name: label, exact: true }).click();
  };
  const topTabs = async () => {
    const tabs = await page.locator(".ef-sync-tabs>[role=tablist]").boundingBox();
    const content = await page.locator(".ef-sync-tabs>[role=tabpanel]:visible").boundingBox();
    assert.ok(content.y >= tabs.y + tabs.height, "Categories stay above their content");
    assert.ok(Math.abs(tabs.x - content.x) < 2, "Tabs and content share the left edge");
  };
  const ready = () => page.locator('body[data-app-hydrated="true"]').waitFor();
  const idle = () => page.locator('[data-endfield-skland][aria-busy="false"]').waitFor();
  const roster = () => page.evaluate(key => JSON.parse(globalThis.localStorage.getItem(key)).operators, STORAGE_KEY);
  const profile = name => page.locator(".ef-skland-profile").getByRole("heading", { name, exact: true }).waitFor();
  const checkSearchLayout = async label => {
    const input = page.getByLabel(label, { exact: true });
    const searchBox = await input.boundingBox();
    const panelBox = await page.locator(".ef-sync-tabs>[role=tabpanel]:visible").boundingBox();
    assert.equal(Math.round(searchBox.height), 36, `${label} has a compact height`);
    assert.ok(Math.abs(searchBox.x - panelBox.x) < 1 && Math.abs(searchBox.width - panelBox.width) < 1, `${label} spans the content width like Skills`);
  };
  await page.goto(`${origin}/skland`); await ready(); await idle();
  assert.equal(await page.getByText("从森空岛 JSON 文件或文本导入", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "生成登录二维码" }).isDisabled(), true);
  assert.equal(requests.filter(r => r.action === "qr").length, 0);
  const qrBox = await page.locator(".ef-login-visual").boundingBox(), copyBox = await page.locator(".ef-login-instructions").boundingBox();
  assert.ok(qrBox.x > copyBox.x, "Desktop QR sits to the right");
  await page.getByRole("tab", { name: "扫码登录", exact: true }).focus(); await page.keyboard.press("ArrowRight");
  await page.getByLabel("粘贴生成的单行凭证", { exact: true }).fill("fixture-secret,fixture-token");
  assert.equal(await page.getByRole("button", { name: "导入并登录", exact: true }).isDisabled(), true);
  await page.locator(".ef-login-consent input").nth(0).check(); await page.locator(".ef-login-consent input").nth(1).check();
  await page.getByRole("button", { name: "导入并登录", exact: true }).click();
  await profile(role.nickname); await idle();
  assert.equal(await page.locator("[data-skland-login-panel]").count(), 0, "Sign-in automatically loads the dashboard and hides login");
  assert.deepEqual(await roster(), savedRoster, "Viewing data never replaces the scheduling roster");
  assert.equal(await page.getByRole("heading", { name: "用于基建排班", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "导入排班名单", exact: true }).count(), 0);
  const controls = page.locator(".ef-skland-controls");
  assert.equal(await controls.locator(".ef-actions>.ef-action--sm").count(), 3);
  assert.equal((await page.getByRole("button", { name: "刷新数据", exact: true }).textContent()).trim(), "");
  const accountBox = await page.getByRole("combobox", { name: "森空岛账号", exact: true }).boundingBox();
  const roleBox = await page.getByRole("combobox", { name: "角色与服务器", exact: true }).boundingBox();
  const actionsBox = await controls.locator(".ef-actions").boundingBox();
  assert.ok(Math.abs(accountBox.y - roleBox.y) < 1 && roleBox.x >= accountBox.x + accountBox.width, "Compact selectors sit side by side");
  assert.ok(roleBox.x + roleBox.width <= actionsBox.x, "Both selectors sit to the left of the three actions");
  assert.equal(await page.getByRole("combobox", { name: "森空岛账号", exact: true }).evaluate(el => globalThis.getComputedStyle(el).fontSize), "12px");
  assert.ok((await page.locator(".ef-skland-profile").boundingBox()).x < accountBox.x, "Profile sits at the left of the header");
  await page.waitForFunction(key => JSON.parse(globalThis.localStorage.getItem(key)).options.levels.center === 4, STORAGE_KEY);
  assert.deepEqual(await page.evaluate(key => JSON.parse(globalThis.localStorage.getItem(key)).options.levels, STORAGE_KEY), { center: 4, mfg1: 3, mfg2: 2, grow: 2, guest: 2 }, "Skland applies facility levels without a separate import toggle");
  await page.getByRole("heading", { name: "每日任务", exact: true }).waitFor();
  await page.getByRole("heading", { name: "通行证", exact: true }).waitFor();
  await topTabs();
  await page.getByRole("tab", { name: "仓库背包", exact: true }).click();
  await checkSearchLayout("搜索仓库物品");
  const filterBox = await page.locator(".ef-inventory-filters").boundingBox();
  assert.ok((await page.getByLabel("搜索仓库物品", { exact: true }).boundingBox()).y >= filterBox.y + filterBox.height, "Inventory search sits below the category filters like Skills");
  assert.equal(await page.getByRole("heading", { name: /^仓库背包/ }).count(), 0);
  const inventoryBottom = await page.locator(".ef-inventory-group").last().boundingBox();
  assert.ok((await page.locator(".ef-sync-note").boundingBox()).y >= inventoryBottom.y + inventoryBottom.height, "Inventory explanation follows the item list");
  assert.equal(await page.locator("[data-material-id]").count(), 40);
  assert.equal(await page.locator('[data-material-id="material-0"] [data-material-count]').textContent(), "0");
  await page.getByLabel("搜索仓库物品", { exact: true }).fill("测试折金");
  assert.equal(await page.locator("[data-material-id]").count(), 1);
  await page.getByLabel("搜索仓库物品", { exact: true }).fill("no-match");
  await page.getByText("没有符合条件的物品。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "清空搜索", exact: true }).click();
  assert.equal(await page.getByLabel("搜索仓库物品", { exact: true }).evaluate(el => el === globalThis.document.activeElement), true, "Clear restores search focus");
  await choose("物品分类", "干员经验");
  assert.equal(await page.locator("[data-material-id]").count(), 4);
  await choose("物品分类", "全部物品");
  await page.getByRole("tab", { name: "干员状态", exact: true }).click();
  await checkSearchLayout("搜索干员");
  assert.equal(await page.getByRole("heading", { name: /^干员状态/ }).count(), 0);
  assert.equal(await page.locator(".ef-data-card").count(), 4, "All operators, including unschedulable ones, are displayed");
  assert.deepEqual(await page.locator(".ef-data-card .ef-operator-skill-stage").allTextContents(), ["1/4", "2/4"], "Skland uses fetched skill progress before any roster import; unknown or skill-less operators have no badge");
  assert.ok((await page.locator(".ef-data-card .ef-operator-portrait img").evaluateAll(images => images.map(img => img.getAttribute("src"))))
    .every(src => src.startsWith("/images/game/operators/")), "Skland portraits use the same official local artwork");
  await page.getByLabel("搜索干员", { exact: true }).fill(catalog[0].name);
  assert.equal(await page.locator(".ef-data-card").count(), 1);
  await page.getByText("干员、技能与装备详情", { exact: true }).click();
  await page.locator("dt").filter({ hasText: /^护甲$/ }).waitFor();
  await page.getByRole("tab", { name: "帝江号", exact: true }).click();
  assert.equal(await page.getByRole("heading", { name: "帝江号设施与生产", exact: true }).count(), 0);
  assert.equal(await page.locator(".ef-data-card").count(), 5);
  assert.equal(await page.locator(".ef-ship-crew .ef-operator-skill-stage").textContent(), "1/4", "Ship crew uses snapshot progress independently of the local scheduling roster");
  await page.locator("dt").filter({ hasText: /^生产报告$/ }).waitFor();
  assert.equal(await page.getByRole("tab", { name: "地区与探索", exact: true }).count(), 0);
  assert.equal(await page.getByRole("tab", { name: "其他资料", exact: true }).count(), 0);
  assert.equal(await page.getByText("新字段也会显示", { exact: true }).count(), 0);
  assert.equal("domain" in snapshot.details, false);
  await page.getByRole("tab", { name: "武器状态", exact: true }).click();
  await checkSearchLayout("搜索武器");
  assert.equal(await page.getByRole("heading", { name: /^武器状态/ }).count(), 0);
  assert.equal(await page.locator(".ef-data-card").count(), 2, "Two copies of one weapon template remain distinct");
  await page.waitForFunction(() => [...globalThis.document.querySelectorAll(".ef-data-card img")].every(img => img.complete && img.naturalWidth > 0));
  await page.getByLabel("搜索武器", { exact: true }).fill("no-match");
  assert.equal(await page.locator(".ef-data-card").count(), 0);
  await page.getByLabel("搜索武器", { exact: true }).fill("");
  assert.equal(await page.getByRole("checkbox", { name: /同时应用设施等级/ }).count(), 0);
  assert.deepEqual(await roster(), savedRoster);
  assert.equal(await page.evaluate(key => JSON.parse(globalThis.localStorage.getItem(key)).options.levels.center, STORAGE_KEY), 4);
  assert.equal(await page.evaluate(() => JSON.stringify({ ...globalThis.localStorage, ...globalThis.sessionStorage }).includes("fixture-secret")), false);

  await page.reload(); await ready(); await profile(role.nickname); await idle();
  assert.equal(await page.locator("[data-skland-login-panel]").count(), 0, "Refresh restores the saved connection");
  assert.deepEqual(await roster(), savedRoster);
  await page.getByRole("button", { name: "添加账号", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "添加森空岛账号" });
  await dialog.waitFor();
  assert.equal(await dialog.locator(".ef-dialog-footer").getByRole("button", { name: "生成登录二维码", exact: true }).count(), 1);
  await dialog.getByRole("tab", { name: "凭证导入", exact: true }).click();
  await dialog.getByLabel("粘贴生成的单行凭证", { exact: true }).fill("fixture-secret,fixture-token");
  await dialog.locator(".ef-login-consent input").nth(0).check(); await dialog.locator(".ef-login-consent input").nth(1).check();
  const credentialRequests = requests.filter(request => request.action === "credential").length;
  await dialog.locator(".ef-dialog-footer").getByRole("button", { name: "导入并登录", exact: true }).click();
  await dialog.waitFor({ state: "hidden" }); await profile(role.nickname); await idle();
  assert.equal(requests.filter(request => request.action === "credential").length, credentialRequests + 1, "Footer submit remains connected to the credential form");
  await page.getByRole("button", { name: "添加账号", exact: true }).click();
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("button", { name: "添加账号", exact: true }).evaluate(el => el === globalThis.document.activeElement), true, "Contour dialog close restores focus to its trigger");
  await page.getByRole("button", { name: "添加账号", exact: true }).click();
  await dialog.locator(".ef-login-consent input").nth(0).check(); await dialog.locator(".ef-login-consent input").nth(1).check();
  await dialog.getByRole("img", { name: "森空岛登录二维码", exact: true }).waitFor();
  await profile(secondRole.nickname); await idle();
  await page.getByRole("tab", { name: "仓库背包", exact: true }).click();
  assert.equal(await page.locator('[data-material-id="material-0"] [data-material-count]').textContent(), "900");
  await page.getByRole("combobox", { name: "森空岛账号", exact: true }).click();
  await page.getByRole("combobox", { name: "森空岛账号", exact: true }).fill("");
  await page.getByRole("option").first().waitFor();
  assert.equal(await page.getByRole("option").count(), 2);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("[data-skland-login-panel]").count(), 0);
  await page.reload(); await ready(); await profile(secondRole.nickname); await idle();
  await choose("森空岛账号", role.nickname);
  await profile(role.nickname); await idle();
  await page.getByRole("tab", { name: "仓库背包", exact: true }).click();
  assert.equal(await page.locator('[data-material-id="material-0"] [data-material-count]').textContent(), "0");

  delayedSync = new Promise(resolve => { releaseSync = resolve; });
  const pendingSync = page.waitForRequest(request => new URL(request.url()).pathname === "/api/skland/sync");
  await page.getByRole("button", { name: "刷新数据", exact: true }).click();
  await pendingSync;
  assert.equal(await page.getByRole("combobox", { name: "森空岛账号", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  const release = releaseSync; delayedSync = null;
  await choose("森空岛账号", secondRole.nickname);
  await profile(secondRole.nickname); release(); await idle();
  assert.equal(await page.locator(".ef-skland-profile h2").textContent(), secondRole.nickname);
  failSync = true;
  await page.getByRole("button", { name: "刷新数据", exact: true }).click(); await idle();
  await page.getByRole("alert").filter({ hasText: "模拟同步失败" }).waitFor();
  assert.equal(await page.locator("[data-skland-login-panel]").count(), 0, "A read failure does not request sign-in again");
  failSync = false; badSnapshot = true;
  await page.getByRole("button", { name: "重新读取数据", exact: true }).click(); await idle();
  await page.getByRole("alert").filter({ hasText: "重复干员" }).waitFor();
  assert.deepEqual(await roster(), savedRoster);
  badSnapshot = false;
  await page.getByRole("button", { name: "重新读取数据", exact: true }).click(); await profile(secondRole.nickname); await idle();
  failInventory = true;
  await page.getByRole("button", { name: "刷新数据", exact: true }).click(); await profile(secondRole.nickname); await idle();
  await page.getByRole("tab", { name: "仓库背包", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已读取材料目录" }).waitFor();
  assert.equal(await page.locator("[data-material-id]").count(), 40);
  assert.equal(await page.locator('[data-material-id="material-0"] [data-material-count]').textContent(), "未获取");
  await page.getByRole("tab", { name: "状态总览", exact: true }).click();
  await page.getByRole("heading", { name: "每日任务", exact: true }).waitFor();
  failInventory = false;
  partialSnapshot = true;
  await page.getByRole("button", { name: "刷新数据", exact: true }).click(); await profile(secondRole.nickname); await idle();
  await page.getByRole("tab", { name: "干员状态", exact: true }).click();
  await page.getByText("仅显示森空岛已公开的干员。", { exact: true }).waitFor();
  const operatorsBottom = await page.locator(".ef-data-cards").boundingBox();
  assert.ok((await page.locator(".ef-sync-note").boundingBox()).y >= operatorsBottom.y + operatorsBottom.height, "Operator visibility explanation follows the cards");
  assert.deepEqual(await roster(), savedRoster, "Partial operator data is viewable but cannot replace the roster");
  await page.getByRole("tab", { name: "武器状态", exact: true }).click();
  await page.getByText("完整武器仓库暂未获取，仅显示已公开干员装备的武器。", { exact: true }).waitFor();
  const weaponsBottom = await page.locator(".ef-data-cards").boundingBox();
  assert.ok((await page.locator(".ef-sync-note").boundingBox()).y >= weaponsBottom.y + weaponsBottom.height, "Weapon source explanation follows the cards");
  partialSnapshot = false;

  await page.setViewportSize({ width: 390, height: 844 });
  await topTabs();
  await page.getByRole("combobox", { name: "森空岛账号", exact: true }).click();
  await page.getByRole("combobox", { name: "森空岛账号", exact: true }).fill("");
  await page.getByRole("option").first().waitFor();
  const popup = await page.locator("[data-slot=combobox-content]").boundingBox();
  assert.ok(popup.x >= 0 && popup.x + popup.width <= 390, "Account dropdown fits the mobile viewport");
  await page.keyboard.press("Escape");
  for (const name of ["状态总览", "干员状态", "武器状态", "仓库背包", "帝江号"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    const searchLabel = { 干员状态: "搜索干员", 武器状态: "搜索武器", 仓库背包: "搜索仓库物品" }[name];
    if (searchLabel) await checkSearchLayout(searchLabel);
    assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), `No mobile overflow: ${name}`);
  }
  await page.getByRole("button", { name: "添加账号", exact: true }).click();
  const mobileQr = await dialog.locator(".ef-login-visual").boundingBox(), mobileCopy = await dialog.locator(".ef-login-instructions").boundingBox();
  assert.ok(mobileQr.y < mobileCopy.y);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "退登账号", exact: true }).click(); await profile(role.nickname); await idle();
  await page.getByRole("combobox", { name: "森空岛账号", exact: true }).click();
  await page.getByRole("option", { name: role.nickname, exact: true }).waitFor();
  assert.equal(await page.getByRole("option").count(), 1);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => globalThis.window.dispatchEvent(new Event("focus"))); await idle();
  await page.locator("[data-sidebar-account-name]").filter({ hasText: "网站测试账号" }).waitFor();
  // Sign out while a data response is in flight. It must not restore private data.
  delayedSync = new Promise(resolve => { releaseSync = resolve; });
  const pendingLogoutSync = page.waitForRequest(request => new URL(request.url()).pathname === "/api/skland/sync");
  await page.getByRole("button", { name: "刷新数据", exact: true }).click();
  await pendingLogoutSync;
  await page.locator("[data-sidebar-account-trigger]").click();
  await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
  await page.getByRole("heading", { name: "登录森空岛", exact: true }).waitFor();
  const releaseAfterLogout = releaseSync; delayedSync = null;
  releaseAfterLogout(); await idle();
  assert.equal(await page.locator("[data-skland-data]").count(), 0, "Website logout clears account data");
  assert.deepEqual(await roster(), savedRoster, "Website logout preserves the local roster");
  await page.getByRole("heading", { name: "登录森空岛", exact: true }).waitFor();
  signedOut = false;
  await context.addCookies([{ name: "riic-endfield-locale", value: "en", url: origin }]);
  await page.reload(); await ready(); await idle();
  await page.getByRole("tab", { name: "Operators", exact: true }).click();
  await page.getByLabel("Search operators", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await page.getByLabel("Search inventory", { exact: true }).waitFor();
  assert.equal(await page.locator("[data-material-id]").count(), 40);
  assert.deepEqual(errors, []);
  console.log("Passed: compact profile/selector/action header, icon-only refresh, removed scheduling section, preserved local roster, 40 inventory items, account-isolated data, partial failures, credential/QR dialogs, cancellation, logout, mobile and English. Mock data only.");
  await context.close();
} finally { if (releaseSync) releaseSync(); await browser.close(); }
