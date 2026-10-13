import { expect, test, type Locator, type Page } from "@playwright/test";
import { gachaAccountOptions } from "../src/gacha-accounts";
import type { GachaHistory } from "../src/gacha-history";
import { TERMS_VERSION, PRIVACY_VERSION } from "../src/legal-policy";
import { requestId, diagnosticId, expectUnifiedDialogTypography, expectUnifiedDialogAction, waitForOwnAnimations, planData, sampleData, authenticatedSklandSnapshot, productionHeavySklandSnapshot, primarySklandAccount, mockApis, openSklandOverview, seedPreferences, seedV4Session } from "./production-readiness.fixture";

async function mockGachaSession(page: Page, roles: Array<{ uid: string; nickname: string }> = [], authorized = true) {
  const activeRoles = (roles.length ? roles : [{ uid: "10001", nickname: "扫码测试" }]).map((role) => ({ ...role, channelName: "官服", isDefault: true }));
  await mockApis(page, { sklandConfigured: true,
    sklandSnapshot: { ...authenticatedSklandSnapshot, player: { ...authenticatedSklandSnapshot.player, ...activeRoles[0] }, roles: activeRoles },
    sklandAccounts: [{ ...primarySklandAccount, selectedUid: activeRoles[0].uid, roles: activeRoles }],
  });
  await page.route("**/api/gacha/session", (route) => route.fulfill({ json: { success: true, data: gachaAccountOptions([], roles, authorized ? roles : []), requestId } }));
}

async function mockGachaArchive(page: Page, history: GachaHistory) {
  await page.route("**/api/gacha/history?*", (route) => route.fulfill({ json: { success: true, data: new URL(route.request().url()).searchParams.get("uid") === history.uid ? history : null, requestId } }));
}

function relativeLuminance(cssColor: string) {
  const channels = cssColor.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Unsupported computed color: ${cssColor}`);
  const [red, green, blue] = channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

async function expectNonTextContrast(foreground: Locator, background: Locator) {
  await expect.poll(async () => {
    // Let the browser convert any supported CSS color (including OKLCH) to sRGB.
    const readColor = (element: Element, property: "color" | "backgroundColor") => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      context.fillStyle = getComputedStyle(element)[property];
      context.fillRect(0, 0, 1, 1);
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
      return `rgb(${r}, ${g}, ${b})`;
    };
    const [foregroundColor, backgroundColor] = await Promise.all([
      foreground.evaluate(readColor, "color" as const),
      background.evaluate(readColor, "backgroundColor" as const),
    ]);
    const brighter = Math.max(relativeLuminance(foregroundColor), relativeLuminance(backgroundColor));
    const darker = Math.min(relativeLuminance(foregroundColor), relativeLuminance(backgroundColor));
    return (brighter + 0.05) / (darker + 0.05);
  }).toBeGreaterThanOrEqual(3);
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      session: { id: "test-session", token: "test-token", userId: "test-user", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      user: { id: "test-user", name: "测试用户", email: "test@example.com", emailVerified: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    }),
  }));
});

test("Skland tab URLs support direct entry, refresh and browser history", async ({ page }) => {
  test.slow();
  await mockApis(page, { sklandConfigured: true, sklandSnapshot: authenticatedSklandSnapshot });
  await seedPreferences(page);
  await mockGachaSession(page);
  // Navigation coverage uses an explicit inventory error state, without a live account.
  await page.route("**/api/skland/inventory", (route) => route.fulfill({
    status: 503, json: { success: false, error: { code: "AIC-SYS-5000", message: "Inventory fixture unavailable", retryable: true }, requestId },
  }));
  const tabs = page.locator("[data-skland-view-tabs]").getByRole("tab");
  const paths = ["/skland", "/skland/inventory", "/skland/infrastructure"];
  for (const [index, path] of paths.entries()) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(index)).toHaveAttribute("href", path);
    await expect(tabs.nth(index)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.filter({ hasText: "寻访记录" })).toHaveCount(0);
    await expect(page.locator("[data-skland-page] [data-slot=tabs-list][data-yeye-scroll]")).toHaveCount(0);
    await expect(page.locator("[data-skland-view-header] .os-scrollbar-horizontal")).toHaveCount(0);
    await page.reload();
    await expect(tabs.nth(index)).toHaveAttribute("aria-selected", "true");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("[data-skland-view-header] [data-yeye-scroll]")).toHaveCount(0);
  await expect(page.locator("[data-skland-view-header] .os-scrollbar-horizontal")).toHaveCount(0);
  await expect(page.locator("[data-skland-view-tabs]").locator("..")).toHaveCSS("overflow-x", "visible");
  await expect(page.locator("[data-skland-view-tabs]")).toHaveCSS("flex-wrap", "wrap");
  for (const tab of await tabs.all()) await expect(tab).toBeInViewport();
  await tabs.nth(0).click();
  await expect(page).toHaveURL(/\/skland$/);
  await tabs.nth(1).click();
  await expect(page).toHaveURL(/\/skland\/inventory$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/skland$/);
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  await page.goForward();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await tabs.nth(0).click();
  await expect(page).toHaveURL(/\/skland$/);
  await tabs.nth(0).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/skland\/inventory$/);
  await tabs.nth(2).click();
  await expect(page).toHaveURL(/\/skland\/infrastructure$/);
  await page.goto("/skland/overview");
  await expect(page).toHaveURL(/\/skland$/);
  expect((await page.goto("/skland/unknown"))?.status()).toBe(404);
});

test("standalone gacha page preserves login and redirects the former Skland URL", async ({ page }) => {
  await mockApis(page, { sklandConfigured: true });
  await seedPreferences(page);
  await mockGachaSession(page);
  const anonymousSession = (route: import("@playwright/test").Route) => route.fulfill({ json: null });
  await page.route("**/api/auth/get-session", anonymousSession);
  await page.goto("/skland/gacha");
  await expect(page.locator("[data-gacha-login-required]")).toBeVisible();
  await expect(page).toHaveURL(/\/gacha$/);
  await page.unroute("**/api/auth/get-session", anonymousSession);
  await page.reload();
  await expect(page.locator("[data-gacha-history]")).toBeVisible();
  const navigation = page.locator('[data-primary-navigation-page="gacha"]:visible');
  await expect(navigation).toHaveAttribute("aria-current", "page");
  await expect(navigation.locator('xpath=ancestor::*[@data-slot="sidebar-group"]')).toContainText("养成规划");
  await page.goto("/skland");
  await expect(page.locator("[data-skland-page]").getByRole("tab", { name: "寻访记录", exact: true })).toHaveCount(0);
  await navigation.click();
  await expect(page).toHaveURL(/\/gacha$/);
  await expect(page.locator("[data-gacha-history]")).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-gacha-history]")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/skland$/);
});

test("gacha achievements show green luck tags and a red saved 300-draw milestone", async ({ page }) => {
  await seedPreferences(page);
  await mockGachaSession(page, [{ uid: "10001", nickname: "成就测试" }]);
  const records = Array.from({ length: 300 }, (_, index) => ({
    id: `achievement-${index}`, category: "normal", poolId: "LIMITED_76_0_1", poolName: "车辙与风的归所",
    charId: [0, 1, 10].includes(index) ? "char_angelina" : "char_002_amiya",
    charName: [0, 1, 10].includes(index) ? "予愿安洁莉娜" : "阿米娅",
    stars: [0, 1, 10].includes(index) ? 6 : 5, isNew: false,
    timestamp: 1785538800000 + Math.floor(index / 10) * 1000, pos: index % 10,
  }));
  const history = { uid: "10001", nickname: "成就测试", records, warnings: [], fetchedAt: new Date().toISOString() };
  await mockGachaArchive(page, history);
  await page.goto("/gacha");
  const multi = page.locator('[data-gacha-achievement="multi-six"]');
  const streak = page.locator('[data-gacha-achievement="up-streak"]');
  const spark = page.locator('[data-gacha-achievement="full-spark"]');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(multi).toHaveText("十连二金 ×1");
    await expect(streak).toHaveText("连续 UP ×3");
    await expect(multi).toHaveAttribute("data-tone", "green");
    await expect(streak).toHaveAttribute("data-tone", "green");
    await expect(spark).toHaveText("抽满一井");
    await expect(spark).toHaveAttribute("data-tone", "red");
    const green = await multi.evaluate((node) => getComputedStyle(node).color);
    await expect(streak).toHaveCSS("color", green);
    await expect(spark).not.toHaveCSS("color", green);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  history.records = records.slice(0, 299);
  await page.reload();
  await expect(streak).toHaveText("连续 UP ×3");
  await expect(spark).toHaveCount(0);
});

for (const [drawCount, ratingTitle, tone] of [[19, "天选欧皇", "lucky"], [45, "小有欧气", "normal"], [65, "时运不济", "unlucky"]] as const) {
test(`gacha current rating and career title share ${tone} colors without numeric scores`, async ({ page }) => {
  await seedPreferences(page);
  await mockGachaSession(page, [{ uid: "10001", nickname: "称号测试" }]);
  const timestamp = 1791500400000 + 60_000;
  await page.clock.setFixedTime(timestamp + 60_000);
  const records = Array.from({ length: drawCount }, (_, index) => ({
    id: `rating-${index}`, category: "normal", poolId: "SINGLE_78_0_1", poolName: "海渊巡游",
    charId: index === drawCount - 1 ? "char_103_angel" : "char_002_amiya", charName: index === drawCount - 1 ? "能天使" : "阿米娅",
    stars: index === drawCount - 1 ? 6 : 5, isNew: false, timestamp: timestamp + index * 1000, pos: 0,
  }));
  const history = { uid: "10001", nickname: "称号测试", records, warnings: [], fetchedAt: new Date(timestamp).toISOString() };
  await mockGachaArchive(page, history);
  await page.goto("/gacha");
  const identity = page.locator("[data-skland-player-identity]");
  const title = identity.locator("[data-gacha-current-rating]");
  const careerTitle = page.locator('[data-gacha-summary-metric="career-score"] [data-gacha-rating="career"]');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(title).toHaveText(ratingTitle);
    await expect(careerTitle).toHaveText(ratingTitle);
    await expect(title).toHaveAttribute("data-tone", tone);
    await expect(careerTitle).toHaveAttribute("data-tone", tone);
    const currentColor = await title.evaluate((node) => getComputedStyle(node).color);
    await expect(careerTitle).toHaveCSS("color", currentColor);
    await expect(page.locator('[data-gacha-summary-metric="career-score"] strong')).toHaveText(ratingTitle);
    await expect(identity.getByRole("heading", { name: "称号测试" }).locator("..").locator("[data-gacha-current-rating]")).toBeVisible();
    await expect(page.locator("[data-gacha-score]")).toHaveCount(0);
    await expect(page.getByText("进行中卡池的已保存记录", { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.clock.setFixedTime(1792699199000 + 1000);
  await page.reload();
  await expect(identity.getByRole("heading", { name: "称号测试" })).toBeVisible();
  await expect(title).toHaveText("屯屯鼠");
  await expect(title).toHaveAttribute("data-tone", "lucky");
  await expect(careerTitle).toHaveText(ratingTitle);
  if (drawCount === 19) {
    history.records = records.map((record) => ({ ...record, stars: 5 }));
    await page.clock.setFixedTime(timestamp + 60_000);
    await page.reload();
    await expect(page.locator('[data-gacha-summary-metric="draws"] strong')).toHaveText("19");
    await expect(title).toHaveCount(0);
    await expect(page.locator('[data-gacha-summary-metric="career-score"] strong')).toHaveText("—");
  }
});
}

test("standalone gacha page follows Skland identity and shows summary metrics without pool filters", async ({ page }) => {
  await mockApis(page, { sklandConfigured: true });
  await seedPreferences(page);
  await mockGachaSession(page, [
    { uid: "10001", nickname: "测试角色甲" }, { uid: "10002", nickname: "测试角色乙" },
  ]);
  const history = (() => {
    const record = { category: "normal", charId: "char_002_amiya", charName: "阿米娅", stars: 5, isNew: false, timestamp: Date.now() - 1000, pos: 0 };
    return { uid: "10001", nickname: "测试角色甲", warnings: [], fetchedAt: new Date().toISOString(), records: [
      { ...record, id: "first", poolId: "pool-a", poolName: "测试甲池" },
      { ...record, id: "second", poolId: "pool-b", poolName: "测试乙池" },
      { ...record, id: "six-a", poolId: "pool-a", poolName: "测试甲池", charId: "char_103_angel", charName: "能天使", stars: 6, timestamp: record.timestamp + 100 },
      { ...record, id: "six-b", poolId: "pool-b", poolName: "测试乙池", charId: "char_103_angel", charName: "能天使", stars: 6, timestamp: record.timestamp + 100 },
    ] };
  })();
  await mockGachaArchive(page, history);
  await page.goto("/gacha");
  const content = page.locator("[data-gacha-history]");
  await expect(content.getByRole("heading", { name: "寻访记录", exact: true })).toHaveCount(0);
  await expect(content.locator("[data-skland-player-identity]").getByRole("heading", { name: "测试角色甲", exact: true })).toBeVisible();
  const actions = ["刷新", "删除云端寻访记录"].map((name) => content.getByRole("button", { name, exact: true }));
  await expect(content.getByRole("button", { name: "导出", exact: true })).toHaveCount(0);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const action of actions) {
      await expect(action).toBeVisible();
      await expect(action).toHaveCSS("border-radius", width < 640 ? "50%" : "18px");
      const bounds = (await action.boundingBox())!;
      expect(bounds.width).toBeLessThan(100);
      expect(bounds.height).toBeGreaterThanOrEqual(width < 640 ? 44 : 36);
    }
    const backgrounds = await Promise.all(actions.map((action) => action.evaluate((node) => getComputedStyle(node).backgroundColor)));
    expect(new Set(backgrounds).size).toBe(actions.length);
    const refreshBounds = (await actions[0].boundingBox())!;
    const toolbarBounds = (await actions[0].locator("..").boundingBox())!;
    expect(Math.abs(refreshBounds.x + refreshBounds.width - toolbarBounds.x - toolbarBounds.width)).toBeLessThan(2);
    if (width >= 1024) {
      const avatarBounds = (await content.locator("[data-skland-player-identity] > :first-child").boundingBox())!;
      const actionBounds = (await content.locator("[data-status-center-actions]").getByRole("button").first().boundingBox())!;
      expect(actionBounds.y).toBeCloseTo(avatarBounds.y, 1);
      const headerBounds = (await content.locator(":scope > header").boundingBox())!;
      const summaryBounds = (await content.locator("[data-gacha-summary]").boundingBox())!;
      expect(summaryBounds.y - headerBounds.y - headerBounds.height).toBeLessThanOrEqual(12);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 844 });
  await expect(content.locator("select")).toHaveCount(0);
  await expect(content.getByRole("region", { name: "测试甲池", exact: true }).locator("header img")).toHaveCount(0);
  const portraits = content.getByRole("img", { name: "阿米娅头像", exact: true });
  await expect(portraits).toHaveCount(2);
  await expect(portraits.first()).toHaveAttribute("loading", "lazy");
  await expect(portraits.first()).toHaveAttribute("src", /\/images\/operator-portraits\/002_amiya\.webp/);
  await expect.poll(() => portraits.first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(content.getByRole("combobox", { name: "选择卡池" })).toHaveCount(0);
  await expect(content.getByPlaceholder("搜索干员或卡池")).toHaveCount(0);
  await expect(content.getByRole("heading", { name: "测试乙池", exact: true })).toBeVisible();
  await expect(content.getByRole("heading", { name: "测试甲池", exact: true })).toBeVisible();
  const summary = content.getByRole("region", { name: "已保存寻访统计" });
  await expect(content.getByRole("region", { name: "寻访生涯分析" })).toBeVisible();
  const recordStarted = content.locator("[data-skland-player-identity] [data-gacha-record-start]");
  await expect(recordStarted).toHaveCount(1);
  await expect(recordStarted).toContainText(/记录始于 \d{4}\.\d{2}\.\d{2}/);
  expect(await recordStarted.evaluate((node) => node.previousElementSibling?.textContent)).toMatch(/^同步于 /);
  await expect(content.locator("[data-gacha-analysis]")).not.toContainText("记录始于");
  await expect(content.locator('[data-gacha-kind="other"]')).toContainText("2 位 UP 未判定");
  await expect(content.getByRole("button", { name: /导入|上传本机历史/ })).toHaveCount(0);
  await expect(summary.locator('[data-gacha-summary-metric="draws"] strong')).toHaveText("4");
  await expect(summary.locator('[data-gacha-summary-metric="six-stars"] strong')).toHaveText("2");
  await expect(summary.locator('[data-gacha-summary-metric="lower-stars"] strong')).toHaveText("2 / 0 / 0");
  await expect(summary.locator('[data-gacha-summary-metric="orundum"] strong > span').first()).toHaveText("2,400");
  await expect(summary.locator('[data-gacha-summary-metric="orundum"]')).toContainText("折算");
  const costLabel = (await summary.locator('[data-gacha-summary-metric="orundum"]').getByText("总消耗合成玉", { exact: true }).boundingBox())!;
  const costValue = (await summary.locator('[data-gacha-summary-metric="orundum"] strong').boundingBox())!;
  expect(costValue.x).toBeCloseTo(costLabel.x, 1);
  expect(costValue.y).toBeGreaterThanOrEqual(costLabel.y + costLabel.height);
  await expect(summary.locator('[data-gacha-summary-metric="career-score"]')).not.toContainText("本站规则");
  await expect(summary).not.toContainText("按已保存抽数");
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const consumptionBounds = (await summary.locator('[data-gacha-summary-metric="orundum"]').boundingBox())!;
    const ratingBounds = (await summary.locator('[data-gacha-summary-metric="career-score"]').boundingBox())!;
    expect(ratingBounds.y).toBeCloseTo(consumptionBounds.y, 1);
    expect(ratingBounds.x).toBeGreaterThanOrEqual(consumptionBounds.x + consumptionBounds.width - 1);
    const overview = content.locator("[data-gacha-analysis] > div").first();
    const pity = content.locator("[data-gacha-pity]");
    const summaryBounds = (await summary.boundingBox())!;
    const overviewBounds = (await overview.boundingBox())!;
    const pityBounds = (await pity.boundingBox())!;
    expect(overviewBounds.y - summaryBounds.y - summaryBounds.height).toBeCloseTo(8, 1);
    expect(pityBounds.y - overviewBounds.y - overviewBounds.height).toBeCloseTo(8, 1);
    for (const row of [summary, overview, pity]) {
      const bounds = (await row.boundingBox())!;
      expect(bounds.x).toBeCloseTo(summaryBounds.x, 1);
      expect(bounds.width).toBeCloseTo(summaryBounds.width, 1);
    }
    for (const panel of [summary.locator("[data-gacha-summary-metric]").first(), overview, pity]) {
      const padding = await panel.evaluate((node) => ({ top: getComputedStyle(node).paddingTop, bottom: getComputedStyle(node).paddingBottom }));
      expect(padding.top).toBe(`${width < 640 ? 8 : 12}px`);
      expect(padding.top).toBe(padding.bottom);
    }
    if (width === 1280) expect((await content.locator("[data-gacha-statistics]").boundingBox())!.height).toBeLessThan(360);
    await expect(content.locator("[data-gacha-analysis]")).not.toContainText("生涯评分");
    for (const edge of ["top", "right", "bottom", "left"]) await expect(summary).toHaveCSS(`border-${edge}-width`, "1px");
    for (const metric of await summary.locator("[data-gacha-summary-metric]").all()) await expect(metric).toHaveCSS("border-bottom-width", "0px");
    await expect(summary.locator('[data-gacha-summary-metric] > [aria-hidden="true"]')).toHaveCount(0);
    if (width < 640) {
      expect((await summary.boundingBox())!.height).toBeLessThanOrEqual(123);
      await expect(content.locator("[data-status-center-actions]")).toHaveCSS("min-height", "0px");
      for (const action of actions) expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  }
  const orundumIcon = summary.getByRole("img", { name: "合成玉", exact: true });
  await expect(orundumIcon).toHaveAttribute("src", /\/images\/products\/orundum\.webp/);
  await expect.poll(() => orundumIcon.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(content.locator("[data-gacha-account-select]")).toHaveCount(0);
  await expect(content.locator("[data-skland-player-identity]").getByRole("heading", { name: "测试角色甲" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("gacha keeps never-six pools visible with bounded pity and unknown averages", async ({ page }) => {
  await mockApis(page, { sklandConfigured: true });
  await seedPreferences(page);
  await mockGachaSession(page, [{ uid: "10001", nickname: "未出六星测试" }]);
  await mockGachaArchive(page, { uid: "10001", nickname: "未出六星测试", fetchedAt: new Date().toISOString(), warnings: [],
    records: [3, 5].map((stars, pos) => ({ id: `never-six-${pos}`, category: "normal", poolId: "SINGLE_78_0_1", poolName: "海渊巡游",
      charId: stars === 5 ? "char_493_firwhl" : "char_123_fang", charName: stars === 5 ? "火哨" : "芬", stars, pos, isNew: false, timestamp: 1791600000000 })),
  });
  await page.goto("/gacha");
  const pool = page.getByRole("region", { name: "海渊巡游", exact: true });
  await expect(pool).toBeVisible();
  await expect(pool.getByRole("list", { name: "卡池 UP 干员" }).getByRole("img")).toHaveCount(3);
  await expect(pool.locator("[data-gacha-pool-analysis]")).toHaveCount(0);
  await expect(page.locator('[data-gacha-kind="standard"]')).toContainText("—UP 平均");
  await expect(pool.locator("[data-gacha-draw-bar]")).toHaveCount(0);
  await expect(page.locator('[data-gacha-pity-kind="standard"]')).toContainText("≥ 2/99");
  await expect(page.locator('[data-gacha-kind="limited"]')).toContainText("UP 平均");
  for (const width of [390, 280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  }
});

test("gacha reference statistics separate completed averages from current pity in up to four compact columns", async ({ page }) => {
  await mockApis(page, { sklandConfigured: true });
  await seedPreferences(page);
  await mockGachaSession(page, [{ uid: "10001", nickname: "中坚统计测试" }]);
  await mockGachaArchive(page, { uid: "10001", nickname: "中坚统计测试", warnings: [], fetchedAt: new Date().toISOString(),
    records: [...Array.from({ length: 75 }, (_, index) => ({ id: `classic-${index}`, category: "classic", poolId: "CLASSIC_DOUBLE_78_0_1", poolName: "中坚测试池",
      charId: [26, 53].includes(index) ? "char_293_thorns" : "char_123_fang", charName: [26, 53].includes(index) ? "棘刺" : "芬",
      stars: [26, 53].includes(index) ? 6 : 3, pos: 0, isNew: false, timestamp: 1791600000000 + index * 1000 })),
      { id: "other-1", category: "normal", poolId: "unknown", poolName: "其他测试池", charId: "char_123_fang", charName: "芬", stars: 3, pos: 0, isNew: false, timestamp: 1791600000000 }],
  });
  await page.goto("/gacha");
  const classic = page.locator('[data-gacha-kind="classic"]');
  await expect(classic).toContainText("75");
  await expect(classic).toContainText("27.0六星平均");
  await expect(classic).not.toContainText("UP 平均");
  await expect(page.locator('[data-gacha-pity-kind="classic"]')).toContainText("21/99");
  await expect(page.locator('[data-gacha-pity-kind="classic"]')).toContainText("当前概率 2%");
  const columns = page.locator('[data-gacha-kind]');
  await expect(columns).toHaveCount(4);
  for (const [width, height] of [[1280, 720], [390, 667], [320, 568], [280, 653]]) {
    await page.setViewportSize({ width, height });
    const bounds = await Promise.all((await columns.all()).map((column) => column.boundingBox()));
    for (const column of await columns.all()) {
      const padding = await column.evaluate((node) => ({ top: getComputedStyle(node).paddingTop, bottom: getComputedStyle(node).paddingBottom }));
      expect(padding.top).toBe(padding.bottom);
    }
    const metricTops = await columns.locator("dl").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
    for (const top of metricTops) expect(top).toBeCloseTo(metricTops[0], 1);
    expect(bounds[0]!.y).toBeCloseTo(bounds[1]!.y, 1);
    expect(bounds[1]!.y).toBeCloseTo(bounds[2]!.y, 1);
    expect(bounds[2]!.y).toBeCloseTo(bounds[3]!.y, 1);
    expect(bounds[0]!.x).toBeLessThan(bounds[1]!.x);
    expect(bounds[1]!.x).toBeLessThan(bounds[2]!.x);
    const overviewBounds = await page.locator("[data-gacha-analysis] > div").first().boundingBox();
    expect(overviewBounds!.height).toBeLessThanOrEqual(height * .5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  }
});

test("gacha groups each six-star result with its draw bar and only intervening five-star portraits", async ({ page }) => {
  await mockApis(page, { sklandConfigured: true });
  await seedPreferences(page);
  await mockGachaSession(page, [{ uid: "10001", nickname: "统计测试" }], false);
  const history = (() => {
    const base = { category: "normal", poolId: "LINKAGE_77_0_1", poolName: "石白深蓝之夜", isNew: false, timestamp: Date.now() - 1000, pos: 0 };
    const records = [
      { ...base, id: "pending", charId: "char_140_whitew", charName: "拉普兰德", stars: 5 },
      { ...base, id: "six-first", charId: "char_103_angel", charName: "能天使", stars: 6 },
      { ...base, id: "five", charId: "char_002_amiya", charName: "阿米娅", stars: 5 },
      { ...base, id: "four", charId: "char_141_nights", charName: "夜烟", stars: 4 },
      { ...base, id: "three", charId: "char_123_fang", charName: "芬", stars: 3 },
      { ...base, id: "six-second", charId: "char_103_angel", charName: "能天使", stars: 6 },
      ...Array.from({ length: 30 }, (_, index) => ({ ...base, id: `five-mid-${index}`, charId: "char_002_amiya", charName: "阿米娅", stars: 5 })),
      { ...base, id: "six-third", charId: "char_103_angel", charName: "能天使", stars: 6 },
      ...Array.from({ length: 70 }, (_, index) => ({ ...base, id: `five-${index}`, charId: "char_002_amiya", charName: "阿米娅", stars: 5 })),
    ].map((record, index) => ({ ...record, timestamp: base.timestamp - Math.floor(index / 10) * 1000, pos: 9 - index % 10 })).reverse();
    return { uid: "10001", nickname: "统计测试", warnings: [], fetchedAt: new Date().toISOString(), records };
  })();
  await mockGachaArchive(page, history);
  await page.goto("/gacha");
  const content = page.locator("[data-gacha-history]");
  const sequence = content.getByRole("list", { name: "六星寻访分段，最近在前", exact: true });
  const poolHeader = content.getByRole("region", { name: "石白深蓝之夜", exact: true }).locator("header");
  const poolCard = content.getByRole("region", { name: "石白深蓝之夜", exact: true });
  await expect(poolCard).toHaveClass(/infra-room-surface/);
  await expect(poolCard).toHaveCSS("background-color", "rgb(39, 42, 43)");
  await expect(poolCard).toHaveCSS("border-top-width", "1px");
  expect(await poolCard.evaluate((node) => getComputedStyle(node, "::before").maskImage)).toContain("facility-grid.svg");
  const upPortraits = poolHeader.getByRole("list", { name: "卡池 UP 干员" }).getByRole("img");
  await expect(upPortraits).toHaveCount(3);
  await expect(upPortraits.first()).toHaveCSS("width", "24px");
  await expect(poolHeader.getByRole("heading", { name: "石白深蓝之夜" })).toHaveText("石白深蓝之夜");
  const titleCaption = poolHeader.getByText("石白深蓝之夜", { exact: true });
  await expect(titleCaption).toHaveCSS("font-size", "28px");
  await expect(poolHeader.getByLabel("卡池开放日期")).toHaveText("2026.09.04 – 09.18");
  await expect(content.locator('[data-gacha-kind="limited"] dd').first()).toHaveText("3 / 3");
  await expect(content.locator('[data-gacha-summary-metric="career-score"] strong')).toHaveText("欧气渐盛");
  await expect(poolCard.locator("[data-gacha-score], [data-gacha-luck]")).toHaveCount(0);
  await expect(poolCard).not.toContainText(/当期评分|卡池评分|本池垫抽|池末垫抽|六星出卡|歪卡|UP 平均|六星平均/);
  await expect(poolCard.locator("[data-gacha-pool-analysis]")).toHaveCount(0);
  for (const [width, height] of [[1280, 720], [390, 667], [320, 568]]) {
    await page.setViewportSize({ width, height });
    const cards = content.locator("[data-gacha-kind]");
    await expect(cards).toHaveCount(3);
    const cardBounds = await Promise.all((await cards.all()).map((card) => card.boundingBox()));
    for (const bounds of cardBounds) expect(bounds!.y).toBeCloseTo(cardBounds[0]!.y, 1);
    for (const card of await cards.all()) {
      const padding = await card.evaluate((node) => ({ top: getComputedStyle(node).paddingTop, bottom: getComputedStyle(node).paddingBottom }));
      expect(padding.top).toBe(padding.bottom);
    }
    const overviewBounds = await content.locator("[data-gacha-analysis] > div").first().boundingBox();
    expect(overviewBounds!.height).toBeLessThanOrEqual(height * .5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(content.locator('[data-gacha-kind="linkage"]')).toHaveCount(0);
  await expect(content.locator('[data-gacha-kind="limited"]')).toContainText("107");
  await expect(content.locator('[data-gacha-kind="limited"]')).toContainText("UP 平均");
  await expect(content.locator("[data-gacha-rules]")).not.toHaveAttribute("open", "");
  expect(await content.locator("[data-gacha-rules]").evaluate((node) => node === node.parentElement?.lastElementChild)).toBe(true);
  await expect(poolHeader.locator("dd > span")).toHaveText(["107"]);
  await expect(poolHeader.locator("dd").first()).toHaveAttribute("aria-label", "107");
  await expect(poolHeader.getByText("获得六星", { exact: true })).toHaveCount(0);
  await expect(poolHeader.locator("dd svg text:visible")).toHaveAttribute("stroke-width", "1");
  const gradientIds = await poolHeader.locator("linearGradient").evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(new Set(gradientIds).size).toBe(1);
  expect(await poolHeader.evaluate((node) => getComputedStyle(node).getPropertyValue("--gacha-pool-accent").trim())).toMatch(/^#[0-9a-f]{6}$/);
  const statFont = await poolHeader.locator("dd").first().evaluate((node) => getComputedStyle(node).fontFamily);
  expect(statFont).toBe(await sequence.locator("[data-gacha-draw-bar] strong").first().evaluate((node) => getComputedStyle(node).fontFamily));
  await page.setViewportSize({ width: 1536, height: 900 });
  const headingBounds = await poolHeader.getByRole("heading", { name: "石白深蓝之夜" }).boundingBox();
  const statsBounds = (await poolHeader.locator("dl").boundingBox())!;
  expect(statsBounds.x).toBeGreaterThanOrEqual(headingBounds!.x + headingBounds!.width);
  const nameBounds = (await titleCaption.boundingBox())!;
  for (const portrait of await upPortraits.all()) {
    const bounds = await portrait.boundingBox();
    expect(Math.abs(bounds!.y + bounds!.height / 2 - nameBounds.y - nameBounds.height / 2)).toBeLessThan(2);
  }
  const intervals = sequence.locator(":scope > [role=listitem]");
  await expect(intervals).toHaveCount(3);
  for (const interval of await intervals.all()) await expect(interval).toHaveCSS("border-top-width", "0px");
  await expect(content).not.toContainText("待出");
  await expect(content.getByRole("img", { name: "拉普兰德头像" })).toHaveCount(0);
  const first = intervals.first();
  const lower = first.getByRole("list", { name: "本段五星干员" });
  await expect(first).toHaveAttribute("aria-label", "能天使，记录内4抽");
  await expect(lower.getByRole("listitem")).toHaveCount(1);
  await expect(sequence.locator('[data-gacha-stars="3"], [data-gacha-stars="4"]')).toHaveCount(0);
  await expect(first.locator("[data-gacha-draw-bar]")).toHaveText("4抽");
  await expect(intervals.nth(1).locator("[data-gacha-draw-bar]")).toHaveText("31抽");
  await expect(intervals.last().locator("[data-gacha-draw-bar]")).toHaveText("71抽");
  await expect(content.locator("[data-gacha-luck]")).toHaveCount(0);
  await expect(sequence.locator("[data-gacha-multi-six]")).toHaveText(["十连二金"]);
  await expect(sequence.locator("[data-gacha-off-banner]")).toHaveCount(3);
  await expect(sequence.locator("[data-gacha-record]")).toHaveCount(104);
  await expect(sequence.getByRole("img", { name: "能天使头像" })).toHaveCount(3);
  for (const dark of [false, true]) {
    await page.evaluate((enabled) => document.documentElement.classList.toggle("dark", enabled), dark);
    const outline = poolHeader.locator("dd svg text:visible").first();
    await expect(outline).toHaveAttribute("fill", "none");
    await expect(outline).toHaveAttribute("stroke", `url(#${gradientIds[0]})`);
    await expect(poolHeader.locator("dd > span").first()).toHaveCSS("opacity", "0");
    const stops = await poolHeader.locator("linearGradient").first().locator("stop").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).stopColor));
    expect(new Set(stops).size).toBe(3);
    const statColor = await poolHeader.locator("dd").first().evaluate((node) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      context.fillStyle = getComputedStyle(node).color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    });
    expect(statColor[3]).toBe(255);
    const channels = statColor.slice(0, 3).map((channel) => channel / 255).map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
    const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    const cardLuminance = relativeLuminance(await poolCard.evaluate((node) => getComputedStyle(node).backgroundColor));
    expect((Math.max(luminance, cardLuminance) + .05) / (Math.min(luminance, cardLuminance) + .05)).toBeGreaterThan(3);
    const fills = sequence.locator("[data-gacha-draw-bar] > [aria-hidden]");
    const colors = await fills.evaluateAll((bars) => bars.map((bar) => getComputedStyle(bar).backgroundColor));
    expect(await fills.evaluateAll((bars) => bars.every((bar) => getComputedStyle(bar).borderLeftWidth === "0px"))).toBe(true);
    expect(new Set(colors).size).toBe(3);
  }
  await expect(sequence.getByRole("img", { name: "能天使头像" }).first()).toHaveCSS("width", "40px");
  await expect(lower.getByRole("img").first()).toHaveCSS("width", "28px");
  await expect(lower).toHaveText("");
  await expect(content).not.toContainText("最近记录");
  await expect(content.getByRole("button", { name: "加载更多", exact: true })).toHaveCount(0);
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const heading = (await poolHeader.getByRole("heading", { name: "石白深蓝之夜" }).boundingBox())!;
    await expect(titleCaption).toHaveCSS("font-size", width < 640 ? "18px" : "28px");
    const headerBounds = (await poolHeader.boundingBox())!;
    for (const value of await poolHeader.locator("dd").all()) {
      const clip = (await value.boundingBox())!;
      if (width >= 640) {
        const numeral = (await value.locator("span").boundingBox())!;
        expect(Math.abs(clip.height / numeral.height - .75)).toBeLessThan(.01);
        expect(clip.y).toBe(numeral.y);
      } else {
        const period = (await poolHeader.getByLabel("卡池开放日期").boundingBox())!;
        expect(clip.y).toBeCloseTo(heading.y, 1);
        expect(clip.y + clip.height).toBeCloseTo(period.y + period.height, 1);
      }
      const outline = (await value.locator(":scope > svg").boundingBox())!;
      expect(outline.y - clip.y).toBeCloseTo(width < 640 ? 0 : -16, 1);
      const label = (await value.locator("../dt").boundingBox())!;
      expect(clip.y + clip.height - label.y - label.height).toBeCloseTo(width < 640 ? 0 : 8, 1);
      if (width < 640) {
        await expect.poll(() => value.evaluate((node) => {
          const glyph = node.querySelector("svg svg text")!.getBoundingClientRect();
          const caption = node.previousElementSibling!.getBoundingClientRect();
          return glyph.left - caption.right;
        })).toBeCloseTo(6, 1);
      } else {
        expect(clip.x - label.x - label.width).toBeCloseTo(8, 1);
      }
      expect(headerBounds.y + headerBounds.height - 1 - clip.y - clip.height).toBeCloseTo(width < 640 ? 8 : 0, 1);
      await expect(value).toHaveCSS("overflow", "hidden");
      await expect(value).toHaveCSS("font-size", width < 640 ? "128px" : "96px");
    }
    const gutter = width < 640 ? 12 : 16;
    expect(Math.abs(heading.x - (headerBounds.x + gutter))).toBeLessThan(2);
    expect(Math.abs(heading.y - headerBounds.y - (width < 640 ? 8 : 16))).toBeLessThan(2);
    const stats = (await poolHeader.locator("dl").boundingBox())!;
    expect(Math.abs(stats.x + stats.width - (headerBounds.x + headerBounds.width - gutter))).toBeLessThan(2);
    if (width < 640) {
      expect(headerBounds.height).toBeLessThanOrEqual(125);
      const periodBounds = (await poolHeader.getByLabel("卡池开放日期").boundingBox())!;
      const topSpace = heading.y - headerBounds.y;
      const bottomSpace = headerBounds.y + headerBounds.height - 1 - periodBounds.y - periodBounds.height;
      expect(bottomSpace).toBeCloseTo(topSpace, 1);
      const identityBounds = (await poolHeader.locator("h4").locator("..").boundingBox())!;
      expect(stats.x).toBeGreaterThanOrEqual(identityBounds.x + identityBounds.width);
      expect(stats.y).toBeLessThan(identityBounds.y + identityBounds.height);
      expect(stats.y + stats.height).toBeGreaterThan(identityBounds.y);
      expect(heading.width).toBeGreaterThanOrEqual(90);
      expect((await first.boundingBox())!.height).toBeLessThanOrEqual(100);
    }
    for (const portrait of await upPortraits.all()) {
      const up = (await portrait.boundingBox())!;
      if (width >= 640) {
        const name = (await titleCaption.boundingBox())!;
        expect(Math.abs(up.y + up.height / 2 - name.y - name.height / 2)).toBeLessThan(2);
      } else {
        expect(up.y).toBeGreaterThanOrEqual(heading.y);
      }
    }
    const sixBounds = await first.getByRole("img", { name: "能天使头像" }).boundingBox();
    expect(sixBounds!.x).toBeCloseTo(heading.x, 1);
    const barBounds = await first.locator("[data-gacha-draw-bar]").boundingBox();
    const fillBounds = await first.locator("[data-gacha-draw-bar] > [aria-hidden]").boundingBox();
    const lowerBounds = await lower.boundingBox();
    expect(barBounds!.x).toBeGreaterThan(sixBounds!.x + sixBounds!.width);
    expect(barBounds!.y).toBe(sixBounds!.y);
    expect(fillBounds!.y).toBe(sixBounds!.y);
    expect(fillBounds!.height).toBe(sixBounds!.height);
    expect(lowerBounds!.x).toBe(barBounds!.x);
    expect(lowerBounds!.y).toBeGreaterThanOrEqual(barBounds!.y + barBounds!.height);
    const connector = sequence.locator("[data-gacha-multi-six]");
    await expect.poll(async () => {
      const link = (await connector.boundingBox())!;
      const secondBar = (await intervals.nth(1).locator("[data-gacha-draw-bar]").boundingBox())!;
      return Math.max(Math.abs(link.y - barBounds!.y), Math.abs(link.y + link.height - secondBar.y - secondBar.height));
    }).toBeLessThan(1);
    expect((await connector.boundingBox())!.x).toBeCloseTo(barBounds!.x + barBounds!.width, 1);
    await expect(connector).toHaveCSS("width", "28px");
    await expect(connector.locator("span")).toHaveCSS("writing-mode", "vertical-rl");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await expect(content.locator('[data-gacha-summary-metric="draws"] strong')).toHaveText("107");
  await expect(content.locator('[data-gacha-summary-metric="orundum"] strong > span').first()).toHaveText("64,200");
  await expect(intervals).toHaveCount(3);
  await expect(lower.getByRole("listitem")).toHaveCount(1);
  const showFiveStars = content.getByRole("switch", { name: "显示五星寻访记录" });
  await expect(showFiveStars).toBeChecked();
  const connector = sequence.locator("[data-gacha-multi-six]");
  const expandedHeight = (await connector.boundingBox())!.height;
  await showFiveStars.click();
  await expect(showFiveStars).not.toBeChecked();
  await expect(sequence.locator('[data-gacha-stars="5"]')).toHaveCount(0);
  await expect(sequence.locator('[data-gacha-stars="6"]')).toHaveCount(3);
  await expect(upPortraits).toHaveCount(3);
  await expect(content.locator('[data-gacha-summary-metric="draws"] strong')).toHaveText("107");
  await expect.poll(async () => (await connector.boundingBox())!.height).toBeLessThan(expandedHeight);
  await expect.poll(async () => {
    const link = (await connector.boundingBox())!;
    const bars = await Promise.all([0, 1].map((index) => intervals.nth(index).locator("[data-gacha-draw-bar]").boundingBox()));
    return Math.max(Math.abs(link.y - bars[0]!.y), Math.abs(link.y + link.height - bars[1]!.y - bars[1]!.height));
  }).toBeLessThan(1);
  await showFiveStars.focus();
  await page.keyboard.press("Space");
  await expect(showFiveStars).toBeChecked();
  await expect(sequence.locator('[data-gacha-stars="5"]')).toHaveCount(101);
});

test("gacha retains pool names and accent colors without requesting activity logos", async ({ page }) => {
  await mockApis(page, { sklandConfigured: true });
  await seedPreferences(page);
  let logoRequests = 0;
  await page.route("**/images/gacha-titles/**", (route) => { logoRequests++; return route.abort(); });
  await mockGachaSession(page, [{ uid: "10001", nickname: "测试" }], false);
  const history = (() => {
    const record = { id: "composite-title", category: "normal", poolId: "LIMITED_76_0_1", poolName: "车辙与风的归所", charId: "char_103_angel", charName: "能天使", stars: 6, isNew: false, timestamp: Date.now(), pos: 0 };
    return { uid: "10001", nickname: "测试", records: [record], warnings: [], fetchedAt: new Date().toISOString() };
  })();
  await mockGachaArchive(page, history);
  await page.goto("/gacha");
  const header = page.getByRole("region", { name: "车辙与风的归所", exact: true }).locator("header");
  await expect(header.getByRole("heading", { name: "车辙与风的归所" })).toHaveText("车辙与风的归所");
  await expect(header.locator('img[src*="gacha-titles"]')).toHaveCount(0);
  await expect(header.getByRole("list", { name: "卡池 UP 干员" }).getByRole("img")).toHaveCount(3);
  expect(await header.evaluate((node) => getComputedStyle(node).getPropertyValue("--gacha-pool-accent").trim())).toMatch(/^#[0-9a-f]{6}$/);
  await expect(header.locator("dd svg text:visible").first()).toHaveAttribute("fill", "none");
  await expect(header.locator("dd linearGradient").first().locator("stop")).toHaveCount(3);
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(header.getByRole("heading", { name: "车辙与风的归所" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  expect(logoRequests).toBe(0);
});

test("mobile gacha keeps the zero glyph the same width in 10 and 40 without changing desktop numbers", async ({ page }) => {
  await mockApis(page, { sklandConfigured: true });
  await seedPreferences(page);
  await mockGachaSession(page, [{ uid: "10001", nickname: "数字宽度测试" }]);
  await mockGachaArchive(page, { uid: "10001", nickname: "数字宽度测试", fetchedAt: new Date().toISOString(), warnings: [],
    records: [10, 40, 100].flatMap((count) => Array.from({ length: count }, (_, index) => ({ id: `digits-${count}-${index}`, category: "normal",
      poolId: `digits-${count}`, poolName: `数字测试${count}`, charId: "char_123_fang", charName: "芬", stars: 3,
      pos: 0, isNew: false, timestamp: 1791600000000 + index * 1000 }))),
  });
  await page.goto("/gacha");
  const values = page.locator("[data-gacha-pool-card] header dd");
  await expect(values).toHaveCount(3);
  await page.evaluate(() => document.fonts.ready);
  for (const width of [390, 320, 280]) {
    await page.setViewportSize({ width, height: 844 });
    const zeros = await values.locator("svg text:visible").evaluateAll((nodes) => nodes.map((node) => {
      const text = node as SVGTextElement;
      const bounds = text.getExtentOfChar(text.getNumberOfChars() - 1);
      const matrix = text.getScreenCTM()!;
      const textBounds = text.getBBox();
      return { width: bounds.width * Math.hypot(matrix.a, matrix.b), height: bounds.height * Math.hypot(matrix.c, matrix.d),
        stretched: text.hasAttribute("textLength"), fits: textBounds.x >= 0 && textBounds.x + textBounds.width <= text.ownerSVGElement!.viewBox.baseVal.width };
    }));
    expect(zeros[0].width).toBeGreaterThan(0);
    for (const zero of zeros.slice(1)) {
      expect(zeros[0].width).toBeCloseTo(zero.width, 1);
      expect(zeros[0].height).toBeCloseTo(zero.height, 1);
    }
    expect(zeros.every((zero) => !zero.stretched)).toBe(true);
    expect(zeros.every((zero) => zero.fits)).toBe(true);
    for (const value of await values.all()) {
      await expect.poll(() => value.evaluate((node) => {
        const glyph = node.querySelector("svg svg text")!.getBoundingClientRect();
        const caption = node.previousElementSibling!.getBoundingClientRect();
        return glyph.left - caption.right;
      })).toBeCloseTo(6, 1);
    }
    await expect(values.first()).toHaveCSS("font-size", "128px");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    if (width === 390) {
      // WebKit paints synthetic bold as multiple offset contours on scaled SVG
      // text. Compare the actual pixels with synthesis disabled, within the same
      // browser, so this catches duplicate outlines without platform snapshots.
      const outline = values.first().locator("svg").first();
      const actual = await outline.screenshot({ animations: "disabled" });
      const mobileText = outline.locator("svg text");
      const previousSynthesis = await mobileText.evaluate((node) => {
        const text = node as SVGTextElement;
        const previous = text.style.fontSynthesis;
        text.style.fontSynthesis = "none";
        return previous;
      });
      const withoutSynthesis = await outline.screenshot({ animations: "disabled" });
      expect(actual.equals(withoutSynthesis), "mobile outlines must match the font without synthetic bold").toBe(true);
      await mobileText.evaluate((node, previous) => { (node as SVGTextElement).style.fontSynthesis = previous; }, previousSynthesis);
    }
  }
  await page.setViewportSize({ width: 1280, height: 844 });
  for (const value of await values.all()) {
    await expect(value).toHaveCSS("font-size", "96px");
    await expect(value.locator("svg text:visible")).toHaveAttribute("textLength", "95%");
  }
});

test.describe("gacha touch layout", () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });

  test("mobile gacha hides dates and docks round icon actions at the bottom right", async ({ page }) => {
    await seedPreferences(page);
    await mockGachaSession(page, [{ uid: "10001", nickname: "船仔#2832" }]);
    await page.route("**/api/account/data-consent", (route) => route.fulfill({
      status: 401, json: { success: false, requestId, error: { code: "AIC-AUTH-2008", message: "fixture expired session", retryable: false } },
    }));
    await mockGachaArchive(page, { uid: "10001", nickname: "船仔#2832", warnings: [], fetchedAt: new Date().toISOString(), records: Array.from({ length: 150 }, (_, index) => ({
      id: `mobile-${index}`, category: "normal", poolId: "LIMITED_76_0_1", poolName: "【限定寻访·夏季】车辙与风的归所", charId: "char_103_angel", charName: "能天使", stars: index % 20 === 0 ? 6 : 5, isNew: false, timestamp: Date.now() - index * 1000, pos: 0,
    })) });
    await page.goto("/gacha");
    const content = page.locator("[data-gacha-history]");
    await expect(content.locator("[data-gacha-summary]")).toBeVisible();
    for (const width of [280, 320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      const overflow = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("body, body *")].filter((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && /^(auto|scroll)$/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1;
      }).map((node) => ({ tag: node.tagName, className: node.className, client: node.clientWidth, scroll: node.scrollWidth })));
      expect(overflow).toEqual([]);
      const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, window: innerWidth }));
      expect(dimensions.scroll, JSON.stringify(dimensions)).toBeLessThanOrEqual(width + 1);
      await expect(content.locator("[data-skland-synced-at]")).toBeHidden();
      await expect(content.locator("[data-gacha-record-start]")).toBeHidden();
      const toolbar = content.getByRole("group", { name: "寻访记录操作" });
      await expect(toolbar).toHaveCSS("position", "fixed");
      let previousBottom = -1;
      for (const button of await toolbar.getByRole("button").all()) {
        await expect(button).toHaveCSS("border-radius", "50%");
        await expect(button.locator("svg")).toBeVisible();
        await expect(button.locator("span")).toBeHidden();
        const bounds = (await button.boundingBox())!;
        expect(bounds.width).toBe(48);
        expect(bounds.height).toBe(48);
        expect(bounds.x + bounds.width).toBeCloseTo(width - 16, 1);
        expect(bounds.y).toBeGreaterThan(previousBottom);
        previousBottom = bounds.y + bounds.height;
      }
      expect(previousBottom).toBeCloseTo(844 - 16, 1);
    }
    const syncNotice = page.locator("[data-cloud-sync-error]");
    await expect(syncNotice).toBeVisible();
    const trigger = content.getByRole("button", { name: "授权记录", exact: true });
    const noticeBounds = (await syncNotice.boundingBox())!;
    expect(noticeBounds.x + noticeBounds.width).toBeLessThan((await trigger.boundingBox())!.x);
    await trigger.click();
    await expect(page.getByRole("dialog", { name: "授权寻访记录" })).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    const beforeScroll = (await trigger.boundingBox())!;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    expect((await trigger.boundingBox())!.y).toBeCloseTo(beforeScroll.y, 1);
    await page.setViewportSize({ width: 1280, height: 844 });
    await expect(content.locator("[data-skland-synced-at]")).toBeVisible();
    await expect(content.locator("[data-gacha-record-start]")).toBeVisible();
    await expect(trigger).toHaveCSS("border-radius", "18px");
    await expect(trigger.locator("span")).toBeVisible();
  });
});

test("gacha stays within the viewport when desktop switches to mobile emulation", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Chrome DevTools emulation regression");
  await seedPreferences(page);
  await mockGachaSession(page, [{ uid: "10001", nickname: "船仔#2832" }]);
  await mockGachaArchive(page, { uid: "10001", nickname: "船仔#2832", warnings: [], fetchedAt: new Date().toISOString(), records: [
    { id: "device-switch", category: "normal", poolId: "LIMITED_76_0_1", poolName: "车辙与风的归所", charId: "char_103_angel", charName: "能天使", stars: 6, isNew: false, timestamp: Date.now(), pos: 0 },
  ] });
  await page.goto("/gacha");
  await expect(page.locator("[data-gacha-summary]")).toBeVisible();
  const device = await page.context().newCDPSession(page);
  await device.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  for (const width of [390, 320, 280]) {
    await device.send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: true });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    await page.evaluate(() => window.scrollTo(100, 0));
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
  }
  await device.detach();
});

test("gacha authorization dialog stops polling when closed and refreshes after QR approval", async ({ page }) => {
  await mockApis(page, { sklandConfigured: true });
  await seedPreferences(page);
  await page.clock.install();
  await mockGachaSession(page);
  let scans = 0;
  let polls = 0;
  let approved = false;
  let histories = 0;
  await page.route("**/api/gacha/qr", (route) => {
    scans++;
    return route.fulfill({ json: { success: true, data: { scanId: `scan-${scans}`, scanUrl: "https://example.test/scan", expiresInSeconds: 300 }, requestId } });
  });
  await page.route("**/api/gacha/qr/status", (route) => {
    polls++;
    return route.fulfill({ json: { success: true, data: { status: approved ? "authenticated" : "waiting", roles: approved ? [{ uid: "10001", nickname: "扫码测试" }] : [] }, requestId } });
  });
  await page.route("**/api/gacha/history?*", (route) => {
    if (route.request().method() === "POST") histories++;
    return route.fulfill({ json: { success: true, data: { uid: "10001", nickname: "扫码测试", records: [], warnings: [], fetchedAt: new Date().toISOString() }, requestId } });
  });
  await page.goto("/gacha");
  const trigger = page.getByRole("button", { name: "授权记录", exact: true });
  const dialog = page.getByRole("dialog", { name: "授权寻访记录" });
  await expect(trigger.locator("../button").last()).toHaveText("授权记录");
  await expect(page.locator("[data-skland-policy-consent]")).toHaveCount(0);
  await trigger.click();
  await expect(dialog).toBeVisible();
  expect(scans).toBe(0);
  const desktopQr = await dialog.locator("[data-gacha-qr]").boundingBox();
  const desktopConsent = await dialog.locator("[data-skland-policy-consent]").boundingBox();
  expect(desktopQr!.x).toBeGreaterThanOrEqual(desktopConsent!.x + desktopConsent!.width);
  await expect(dialog.getByRole("button", { name: "生成二维码", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "同步本站森空岛登录状态", exact: true })).toBeDisabled();
  for (const checkbox of await dialog.getByRole("checkbox").all()) await checkbox.check();
  await dialog.getByRole("button", { name: "生成二维码", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("等待扫码确认");
  await page.clock.fastForward(3100);
  await expect.poll(() => polls).toBe(1);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.clock.fastForward(10_000);
  expect(polls).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  const mobileQr = await dialog.locator("[data-gacha-qr]").boundingBox();
  const mobileConsent = await dialog.locator("[data-skland-policy-consent]").boundingBox();
  expect(mobileQr!.y + mobileQr!.height).toBeLessThanOrEqual(mobileConsent!.y);
  await expect(dialog.getByRole("button", { name: "生成二维码", exact: true })).toBeDisabled();
  for (const checkbox of await dialog.getByRole("checkbox").all()) await checkbox.check();
  approved = true;
  await dialog.getByRole("button", { name: "生成二维码", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("等待扫码确认");
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.clock.fastForward(3100);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("已保存寻访", { exact: true }).locator("..").locator("strong")).toHaveText("0");
  expect(histories).toBe(1);
});

test("gacha authorization dialog offers consent-gated Skland reuse with a QR fallback", async ({ page }) => {
  await mockApis(page, { sklandConfigured: true });
  await seedPreferences(page);
  await mockGachaSession(page, [{ uid: "10002", nickname: "森空岛测试" }], false);
  let attempts = 0;
  await page.route("**/api/gacha/skland", (route) => {
    attempts++;
    expect(route.request().postDataJSON()).toMatchObject({ gachaConsent: true, consent: { termsAccepted: true, privacyAccepted: true } });
    return route.fulfill({ status: attempts === 1 ? 401 : 200, json: attempts === 1
      ? { success: false, error: { message: "当前森空岛登录未保存寻访所需的授权，请点击“生成二维码”完成授权。" }, requestId }
      : { success: true, data: { roles: [{ uid: "10002", nickname: "森空岛测试" }], selectedUid: "10002" }, requestId } });
  });
  await page.route("**/api/gacha/history?*", (route) => {
    expect(new URL(route.request().url()).searchParams.get("uid")).toBe("10002");
    return route.fulfill({ json: { success: true, data: { uid: "10002", nickname: "森空岛测试", records: [], warnings: [], fetchedAt: new Date().toISOString() }, requestId } });
  });
  await page.goto("/gacha");
  await page.getByRole("button", { name: "授权记录", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "授权寻访记录" });
  const sync = dialog.getByRole("button", { name: "同步本站森空岛登录状态", exact: true });
  await expect(sync).toBeDisabled();
  for (const checkbox of await dialog.getByRole("checkbox").all()) await checkbox.check();
  await expect(sync).toHaveCSS("border-radius", "18px");
  await sync.click();
  await expect(dialog.getByRole("alert")).toHaveText("当前森空岛登录未保存寻访所需的授权，请点击“生成二维码”完成授权。");
  await expect(dialog.getByRole("button", { name: "生成二维码", exact: true })).toBeEnabled();
  await sync.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("已保存寻访", { exact: true }).locator("..").locator("strong")).toHaveText("0");
});

test("mobile dark mode keeps every non-QR Skland state legible from first paint", async ({ page }) => {
  test.slow();
  await page.addInitScript(() => {
    const enableDarkMode = () => {
      const root = document.documentElement;
      if (!root) return false;
      root.classList.add("dark");
      return true;
    };
    if (!enableDarkMode()) {
      const observer = new MutationObserver(() => {
        if (!enableDarkMode()) return;
        observer.disconnect();
      });
      observer.observe(document, { childList: true });
    }
  });
  await page.emulateMedia({ colorScheme: "dark", forcedColors: "none" });
  await page.setViewportSize({ width: 375, height: 812 });
  await mockApis(page, { sklandConfigured: true });

  let releaseQr!: () => void;
  const qrGate = new Promise<void>((resolve) => {
    releaseQr = resolve;
  });
  await page.route("**/api/skland/auth/qr", async (route) => {
    await qrGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          scanId: "scan-login-dark-mobile",
          scanUrl: "hypergryph://scan_login?scanId=scan-login-dark-mobile",
          expiresInSeconds: 600,
        },
        requestId,
      }),
    });
  });
  await page.route("**/api/skland/auth/qr/status", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      data: { status: "scanned" },
      requestId,
    }),
  }));
  await seedPreferences(page);
  await page.goto("/skland");

  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(page.viewportSize()).toEqual({ width: 375, height: 812 });
  await expect(page.locator("[data-skland-page]")).toBeVisible();

  const qrSurface = page.locator("[data-skland-qr-visual]");
  await expect(qrSurface).toBeVisible({ timeout: 45_000 });
  const expectStateContrast = async (state: "idle" | "loading" | "scanned") => {
    const icon = qrSurface.locator(`[data-skland-login-status-icon="${state}"]`);
    await expect(icon).toBeVisible({ timeout: state === "scanned" ? 10_000 : 5_000 });
    await expectNonTextContrast(icon, qrSurface);
    await page.emulateMedia({ colorScheme: "dark", forcedColors: "active" });
    await expectNonTextContrast(icon, qrSurface);
    await page.emulateMedia({ colorScheme: "dark", forcedColors: "none" });
  };

  await expectStateContrast("idle");
  await page.getByRole("checkbox").nth(0).check();
  await page.getByRole("checkbox").nth(1).check();
  await expectStateContrast("loading");

  releaseQr();
  await expect(page.getByRole("img", { name: "森空岛登录二维码" })).toBeVisible();
  await expectStateContrast("scanned");
});

test("Skland login exposes both methods and starts QR only after explicit consent", async ({ page }) => {
  await mockApis(page, { sklandConfigured: true });
  let qrStartRequests = 0;
  await page.route("**/api/skland/auth/qr", (route) => {
    qrStartRequests += 1;
    expect(route.request().postDataJSON()).toEqual({
      consent: {
        termsAccepted: true,
        privacyAccepted: true,
        termsVersion: TERMS_VERSION,
        privacyVersion: PRIVACY_VERSION,
      },
    });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          scanId: "scan-login-1",
          scanUrl: "hypergryph://scan_login?scanId=scan-login-1&from=web",
          expiresInSeconds: 600,
        },
        requestId,
      }),
    });
  });
  await page.route("**/api/skland/auth/qr/status", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      data: { status: "waiting" },
      requestId,
    }),
  }));
  await seedPreferences(page);
  await page.addInitScript(() => window.localStorage.setItem("infra-demo-locale", "zh"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator("[data-skland-account-control]")).toHaveCount(0);
  await expect(page.locator("[data-skland-sidebar-account]")).toHaveCount(0);
  await openSklandOverview(page);
  await expect(page.getByRole("heading", { name: "把当前罗德岛带进排班助手" })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();

  await expect(page.locator("[data-skland-account-control]")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "把当前罗德岛带进排班助手" })).toBeVisible();
  await expect(page.getByText(/手机号|验证码|密码/)).toHaveCount(0);
  await expect(page.getByText("使用森空岛 App 扫码，或从已登录的森空岛网页导入凭证，同步当前角色的干员与基建数据。")).toBeVisible();
  await expect(page.getByText("登录凭证只保存在当前浏览器，7 天后失效。")).toBeVisible();
  await expect(page.getByRole("tab", { name: "扫码登录" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "凭证导入" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "登录森空岛账号" })).toHaveCount(0);
  await expect(page.getByText("登录信息经加密写入 HttpOnly Cookie，并在授权成功 7 天后固定失效。")).toHaveCount(0);
  await expect(page.locator("[data-skland-auth-copy]")).toHaveCount(0);
  expect(qrStartRequests).toBe(0);

  const consentCheckboxes = page.getByRole("checkbox");
  await expect(consentCheckboxes).toHaveCount(2);
  await expect(page.getByRole("button", { name: "生成登录二维码" })).toBeDisabled();
  await consentCheckboxes.nth(0).check();
  expect(qrStartRequests).toBe(0);
  await consentCheckboxes.nth(1).check();
  await expect(page.getByRole("img", { name: "森空岛登录二维码" })).toBeVisible();
  await expect(page.getByText("请使用森空岛 App 扫描二维码", { exact: true })).toBeVisible();
  await expect(page.locator("[data-skland-login-panel]")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.locator("[data-skland-login-copy]")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.getByRole("link", { name: "本站服务条款" }).first()).toHaveAttribute("href", "/terms");
  await expect(page.getByRole("link", { name: "本站隐私政策" }).first()).toHaveAttribute("href", "/privacy");
  await expect(page.getByText(/skland-kit/i)).toHaveCount(0);

  await page.evaluate(() => document.documentElement.classList.add("dark"));
  const qrVisual = page.locator("[data-skland-qr-visual]");
  const qrImage = page.getByRole("img", { name: "森空岛登录二维码" });
  await expect(qrVisual).toHaveCSS("background-color", "rgb(255, 255, 255)");
  if (await page.evaluate(() => CSS.supports("forced-color-adjust", "none"))) {
    await expect(qrVisual).toHaveCSS("forced-color-adjust", "none");
  }
  expect(await qrVisual.evaluate((element) => getComputedStyle(element).colorScheme)).toMatch(/\bonly\b.*\blight\b|\blight\b.*\bonly\b/);
  await expect(qrImage.locator("path").nth(0)).toHaveAttribute("fill", "#FFFFFF");
  await expect(qrImage.locator("path").nth(1)).toHaveAttribute("fill", "#000000");
  await expect(qrImage).toBeVisible();

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("img", { name: "森空岛登录二维码" })).toBeVisible();
    const qrBox = await page.locator("[data-skland-qr-visual]").boundingBox();
    expect(qrBox).not.toBeNull();
    expect(qrBox?.width).toBeGreaterThanOrEqual(208);
    expect(qrBox?.width).toBeLessThanOrEqual(224);
  }
  expect(qrStartRequests).toBe(1);
});

test("Skland QR polling pauses while hidden or offline and resumes immediately", async ({ page, context }) => {
  await mockApis(page, { sklandConfigured: true });
  let pollRequests = 0;
  await page.route("**/api/skland/auth/qr", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      data: {
        scanId: "scan-login-offline",
        scanUrl: "hypergryph://scan_login?scanId=scan-login-offline",
        expiresInSeconds: 600,
      },
      requestId,
    }),
  }));
  await page.route("**/api/skland/auth/qr/status", (route) => {
    pollRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { status: "waiting" }, requestId }),
    });
  });
  await seedPreferences(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await openSklandOverview(page);
  await page.getByRole("checkbox").nth(0).check();
  await page.getByRole("checkbox").nth(1).check();
  await expect(page.getByRole("img", { name: "森空岛登录二维码" })).toBeVisible();

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(6_500);
  expect(pollRequests).toBe(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => pollRequests, { timeout: 2_000 }).toBe(1);

  await context.setOffline(true);
  await page.waitForTimeout(6_500);
  expect(pollRequests).toBe(1);

  await context.setOffline(false);
  await expect.poll(() => pollRequests, { timeout: 2_000 }).toBe(2);
});

test("Skland QR expires locally without polling after its deadline", async ({ page }) => {
  await mockApis(page, { sklandConfigured: true });
  let qrStartRequests = 0;
  let pollRequests = 0;
  await page.route("**/api/skland/auth/qr", (route) => {
    qrStartRequests += 1;
    const scanId = `scan-login-expiry-${qrStartRequests}`;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          scanId,
          scanUrl: `hypergryph://scan_login?scanId=${scanId}`,
          expiresInSeconds: qrStartRequests === 1 ? 0.2 : 600,
        },
        requestId,
      }),
    });
  });
  await page.route("**/api/skland/auth/qr/status", (route) => {
    pollRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { status: "waiting" }, requestId }),
    });
  });
  await seedPreferences(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await openSklandOverview(page);
  await page.getByRole("checkbox").nth(0).check();
  await page.getByRole("checkbox").nth(1).check();

  await expect.poll(() => qrStartRequests).toBe(2);
  expect(pollRequests).toBe(0);
  await expect(page.getByRole("img", { name: "森空岛登录二维码" })).toBeVisible();
});

test("credential import explains the risk, gates consent, recovers from errors, and clears secrets on success", async ({ page, context }) => {
  await mockApis(page, { sklandConfigured: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const submittedCredential = "cred-private-fixture,token-private-fixture";
  const requestBodies: unknown[] = [];
  let attempts = 0;
  let releaseFirstAttempt!: () => void;
  const firstAttemptGate = new Promise<void>((resolve) => { releaseFirstAttempt = resolve; });

  await page.route("**/api/skland/auth/credential", async (route) => {
    attempts += 1;
    requestBodies.push(route.request().postDataJSON());
    if (attempts === 1) {
      await firstAttemptGate;
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: {
            code: "AIC-AUTH-2010",
            message: "森空岛凭证格式无效，请重新完整复制 cred,token。",
            requestId,
            retryable: false,
          },
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          authenticated: true,
          configured: true,
          authMethods: { qr: true, credential: true },
          accounts: [primarySklandAccount],
          activeAccountId: primarySklandAccount.accountId,
          bindingCount: 1,
          scheduleSnapshot: authenticatedSklandSnapshot,
          statusSnapshot: authenticatedSklandSnapshot,
        },
        requestId,
      }),
    });
  });

  await seedPreferences(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await openSklandOverview(page);
  await page.getByRole("tab", { name: "凭证导入" }).click();

  const credentialPanel = page.locator("[data-skland-credential-panel]");
  await expect(credentialPanel).toBeVisible();
  const credentialForm = credentialPanel.locator("[data-skland-credential-form]");
  await expect(credentialForm).toBeVisible();
  await expect.poll(() => credentialForm.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(credentialPanel.getByText("手机端优先使用扫码")).toBeVisible();
  await expect(credentialPanel.locator("ol > li")).toHaveCount(3);
  await expect(credentialPanel.getByText(/allow pasting.*允许粘贴/)).toBeVisible();
  await expect(credentialPanel.getByText("仓库物资数量", { exact: true })).toBeVisible();
  await expect(credentialPanel.getByText(/本站实际不读取、不保存、不展示仓库数据/)).toBeVisible();

  await credentialPanel.getByRole("button", { name: "复制命令" }).click();
  await expect(credentialPanel.getByRole("button", { name: "已复制" })).toBeVisible();
  const copiedCommand = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiedCommand).toBe("copy(localStorage.getItem('SK_OAUTH_CRED_KEY')+','+localStorage.getItem('SK_TOKEN_CACHE_KEY')),console.log('已复制到粘贴板，回到网页粘贴')");

  const input = credentialPanel.locator("[data-skland-credential-input]");
  const submit = credentialPanel.locator("[data-skland-credential-submit]");
  await expect(input).toHaveAttribute("type", "password");
  await input.fill(submittedCredential);
  await expect(submit).toBeDisabled();
  await credentialPanel.getByRole("checkbox").nth(0).check();
  await expect(submit).toBeDisabled();
  await credentialPanel.getByRole("checkbox").nth(1).check();
  await expect(submit).toBeEnabled();

  await submit.click();
  await expect(submit).toContainText("正在验证凭证…");
  releaseFirstAttempt();
  await expect(credentialPanel.getByText(/AIC-AUTH-2010/)).toBeVisible();
  await expect(input).toHaveValue(submittedCredential);
  await submit.click();
  await expect(page.getByRole("heading", { name: "测试博士" }).first()).toBeVisible();

  expect(requestBodies).toEqual([
    {
      credential: submittedCredential,
      consent: {
        termsAccepted: true,
        privacyAccepted: true,
        termsVersion: TERMS_VERSION,
        privacyVersion: PRIVACY_VERSION,
      },
    },
    {
      credential: submittedCredential,
      consent: {
        termsAccepted: true,
        privacyAccepted: true,
        termsVersion: TERMS_VERSION,
        privacyVersion: PRIVACY_VERSION,
      },
    },
  ]);
  const browserPersistence = await page.evaluate(() => ({
    local: JSON.stringify(localStorage),
    session: JSON.stringify(sessionStorage),
    bodyText: document.body.textContent ?? "",
  }));
  expect(browserPersistence.local).not.toContain(submittedCredential);
  expect(browserPersistence.session).not.toContain(submittedCredential);
  expect(browserPersistence.bodyText).not.toContain(submittedCredential);
});

test("credential import can add a second Skland account from the account dialog", async ({ page }) => {
  const secondarySnapshot = {
    ...authenticatedSklandSnapshot,
    player: {
      ...authenticatedSklandSnapshot.player,
      uid: "246813579",
      nickname: "凭证导入博士",
      channelName: "官服",
    },
    roles: [{
      uid: "246813579",
      nickname: "凭证导入博士",
      channelName: "官服",
      isDefault: true,
    }],
  };
  const secondaryAccount = {
    accountId: "account_credential_secondary",
    selectedUid: secondarySnapshot.player.uid,
    roles: secondarySnapshot.roles,
    credentialExpiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  const submittedCredential = "cred-dialog-fixture,token-dialog-fixture";
  let submittedBody: unknown;

  await mockApis(page, {
    sklandConfigured: true,
    sklandSnapshot: authenticatedSklandSnapshot,
  });
  await page.route("**/api/skland/auth/credential", async (route) => {
    submittedBody = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "X-Request-Id": requestId },
      body: JSON.stringify({
        success: true,
        data: {
          authenticated: true,
          configured: true,
          authMethods: { qr: true, credential: true },
          accounts: [primarySklandAccount, secondaryAccount],
          activeAccountId: secondaryAccount.accountId,
          bindingCount: 2,
          bindingSummary: {
            totalCount: 2,
            activeCount: 2,
            renewalDueCount: 0,
            nextExpiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
            latestExpiredAt: null,
          },
          scheduleSnapshot: secondarySnapshot,
          statusSnapshot: secondarySnapshot,
        },
        requestId,
      }),
    });
  });

  await seedPreferences(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await openSklandOverview(page);
  await page.locator("[data-skland-add-account]").click();

  const dialog = page.getByRole("dialog", { name: "添加森空岛账号" });
  await dialog.getByRole("tab", { name: "凭证导入" }).click();
  await expect(dialog).toHaveCSS("width", "960px");
  const credentialPanel = dialog.locator("[data-skland-credential-panel]");
  const credentialForm = credentialPanel.locator("[data-skland-credential-form]");
  const riskNotice = credentialPanel.locator("[data-skland-credential-risk]");
  const [panelBox, formBox, riskBox] = await Promise.all([
    credentialPanel.boundingBox(),
    credentialForm.boundingBox(),
    riskNotice.boundingBox(),
  ]);
  expect(panelBox).not.toBeNull();
  expect(formBox?.width).toBeCloseTo(768, 0);
  expect(riskBox?.width).toBeCloseTo(672, 0);
  expect(Math.abs((formBox?.x ?? 0) + (formBox?.width ?? 0) / 2 - ((panelBox?.x ?? 0) + (panelBox?.width ?? 0) / 2))).toBeLessThanOrEqual(2);
  expect(Math.abs((riskBox?.x ?? 0) + (riskBox?.width ?? 0) / 2 - ((formBox?.x ?? 0) + (formBox?.width ?? 0) / 2))).toBeLessThanOrEqual(2);
  await dialog.locator("[data-skland-credential-input]").fill(submittedCredential);
  await dialog.getByRole("checkbox").nth(0).check();
  await dialog.getByRole("checkbox").nth(1).check();
  await dialog.locator("[data-skland-credential-submit]").click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "凭证导入博士" }).first()).toBeVisible();
  expect(submittedBody).toEqual({
    credential: submittedCredential,
    consent: {
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
    },
  });
  await expect(page.locator("body")).not.toContainText(submittedCredential);
});

test("Skland login waits for explicit consent and explains slow preparation", async ({ page }) => {
  await mockApis(page, { sklandConfigured: true });
  let qrStartRequests = 0;
  let releaseQr: (() => void) | undefined;
  const qrGate = new Promise<void>((resolve) => {
    releaseQr = resolve;
  });
  await page.route("**/api/skland/auth/qr", async (route) => {
    qrStartRequests += 1;
    await qrGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          scanId: "scan-login-slow",
          scanUrl: "hypergryph://scan_login?scanId=scan-login-slow",
          expiresInSeconds: 600,
        },
        requestId,
      }),
    });
  });
  await page.route("**/api/skland/auth/qr/status", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      data: { status: "waiting" },
      requestId,
    }),
  }));
  await seedPreferences(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await openSklandOverview(page);
  expect(qrStartRequests).toBe(0);
  await page.getByRole("checkbox").nth(0).check();
  expect(qrStartRequests).toBe(0);
  await page.getByRole("checkbox").nth(1).check();
  await expect(page.locator("[data-skland-login-qr]").getByRole("status")).toContainText("正在生成二维码…");
  await expect(page.getByText("正在连接登录服务，请稍候…")).toBeVisible({ timeout: 3_000 });
  expect(qrStartRequests).toBe(1);

  releaseQr?.();
  await expect(page.getByRole("img", { name: "森空岛登录二维码" })).toBeVisible();
  expect(qrStartRequests).toBe(1);
});

test("Skland login replaces a scanned QR with progress while authentication finishes", async ({ page }) => {
  await mockApis(page, { sklandConfigured: true });
  await page.route("**/api/skland/auth/qr", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      data: {
        scanId: "scan-login-confirming",
        scanUrl: "hypergryph://scan_login?scanId=scan-login-confirming",
        expiresInSeconds: 600,
      },
      requestId,
    }),
  }));
  await page.route("**/api/skland/auth/qr/status", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      data: { status: "scanned" },
      requestId,
    }),
  }));
  await seedPreferences(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await openSklandOverview(page);
  await page.getByRole("checkbox").nth(0).check();
  await page.getByRole("checkbox").nth(1).check();
  await expect(page.getByRole("img", { name: "森空岛登录二维码" })).toBeVisible();
  await expect(page.locator("[data-skland-login-progress]")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("img", { name: "森空岛登录二维码" })).toHaveCount(0);
  await expect(page.locator("[data-skland-login-panel]").getByRole("status")).toContainText("已扫码，正在等待森空岛 App 确认并完成登录…");
});

test("Skland restore waits for website authentication and then starts summary and full requests once", async ({ page }) => {
  let releaseWebsiteSession!: () => void;
  const websiteSessionGate = new Promise<void>((resolve) => { releaseWebsiteSession = resolve; });
  let fullSessionRequests = 0;
  let summarySessionRequests = 0;
  await page.unroute("**/api/auth/get-session");
  await page.route("**/api/auth/get-session", async (route) => {
    await websiteSessionGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session: {
          id: "test-session",
          token: "test-token",
          userId: "test-user",
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        user: {
          id: "test-user",
          name: "测试用户",
          email: "test@example.com",
          emailVerified: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
    });
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/skland/accounts" && !url.searchParams.has("mode") && request.method() === "GET") {
      fullSessionRequests += 1;
    }
    if (url.pathname === "/api/skland/accounts" && url.searchParams.get("mode") === "summary" && request.method() === "GET") {
      summarySessionRequests += 1;
    }
  });
  await mockApis(page, { sklandConfigured: true, sklandSnapshot: authenticatedSklandSnapshot });
  await seedPreferences(page);
  const navigation = page.goto("/");

  await page.waitForTimeout(100);
  expect(fullSessionRequests).toBe(0);
  expect(summarySessionRequests).toBe(0);
  releaseWebsiteSession();
  await navigation;
  await expect.poll(() => fullSessionRequests).toBe(1);
  await expect.poll(() => summarySessionRequests).toBe(1);
});

test("a current Skland BOX still refreshes from the latest session snapshot", async ({ page }) => {
  await mockApis(page, {
    sklandConfigured: true,
    sklandSnapshot: authenticatedSklandSnapshot,
  });
  await seedV4Session(page, undefined, {
    boxSource: "skland",
    operbox: [authenticatedSklandSnapshot.operbox[0]],
  });
  await page.goto("/");

  await page.getByRole("button", { name: "配置Box与布局" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("森空岛同步", { exact: true })).toBeVisible();
  await expect(dialog.getByText("2 名干员 · 2 名可用", { exact: true })).toBeVisible();
});

test("an in-flight Skland restore cannot replace a newly imported MAA BOX", async ({ page }) => {
  let releaseFullRestore!: () => void;
  let markFullRestoreStarted!: () => void;
  const fullRestoreGate = new Promise<void>((resolve) => { releaseFullRestore = resolve; });
  const fullRestoreStarted = new Promise<void>((resolve) => { markFullRestoreStarted = resolve; });

  await mockApis(page, {
    sklandConfigured: true,
    sklandSnapshot: authenticatedSklandSnapshot,
  });
  await page.route(/\/api\/skland\/accounts(?:[/?]|$)/, async (route) => {
    const url = new URL(route.request().url());
    const isFullRestore = route.request().method() === "GET" && !url.searchParams.has("mode");
    if (isFullRestore) {
      markFullRestoreStarted();
      await fullRestoreGate;
    }
    await route.fallback();
  });
  await seedV4Session(page, undefined, {
    boxSource: "skland",
    operbox: [authenticatedSklandSnapshot.operbox[0]],
  });
  await page.goto("/");
  await fullRestoreStarted;

  await page.getByRole("button", { name: "配置Box与布局" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "更换", exact: true }).click();
  await dialog.getByRole("tab", { name: "MAA", exact: true }).click();
  await dialog.getByRole("button", { name: "粘贴 JSON", exact: true }).click();
  await dialog.getByLabel("JSON 内容").fill(JSON.stringify(sampleData));
  await dialog.getByRole("button", { name: "导入 JSON", exact: true }).click();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);

  const fullRestoreResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/skland/accounts"
      && !url.searchParams.has("mode");
  });
  releaseFullRestore();
  await fullRestoreResponse;

  await page.getByRole("button", { name: "配置Box与布局" }).first().click();
  const reopenedDialog = page.getByRole("dialog");
  await expect(reopenedDialog.getByText("粘贴的 Arknights_OperBox_Export.json", { exact: true })).toBeVisible();
  await expect(reopenedDialog.getByText("1 名干员 · 1 名可用", { exact: true })).toBeVisible();
});

test("an in-flight Skland restore cannot replace a locally selected layout", async ({ page }) => {
  let releaseFullRestore!: () => void;
  let markFullRestoreStarted!: () => void;
  const fullRestoreGate = new Promise<void>((resolve) => { releaseFullRestore = resolve; });
  const fullRestoreStarted = new Promise<void>((resolve) => { markFullRestoreStarted = resolve; });

  await mockApis(page, {
    sklandConfigured: true,
    sklandSnapshot: authenticatedSklandSnapshot,
  });
  await page.route(/\/api\/skland\/accounts(?:[/?]|$)/, async (route) => {
    const url = new URL(route.request().url());
    const isFullRestore = route.request().method() === "GET" && !url.searchParams.has("mode");
    if (isFullRestore) {
      markFullRestoreStarted();
      await fullRestoreGate;
    }
    await route.fallback();
  });
  await seedV4Session(page, undefined, {
    boxSource: "skland",
    operbox: [authenticatedSklandSnapshot.operbox[0]],
  });
  await page.goto("/");
  await fullRestoreStarted;

  await page.getByRole("button", { name: "配置Box与布局" }).first().click();
  const dialog = page.getByRole("dialog", { name: "排班设置" });
  await dialog.getByRole("button", { name: "继续", exact: true }).click();
  const selectedLayout = dialog.getByRole("button", { name: /^252/ });
  await selectedLayout.click();
  await expect(selectedLayout).toHaveAttribute("aria-pressed", "true");

  const fullRestoreResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/skland/accounts"
      && !url.searchParams.has("mode");
  });
  releaseFullRestore();
  await fullRestoreResponse;
  await page.waitForTimeout(100);

  await expect(selectedLayout).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "检查设施", exact: true }).click();
  await dialog.getByRole("button", { name: "完成", exact: true }).click();

  const planRequest = page.waitForRequest((request) => (
    request.method() === "POST" && new URL(request.url()).pathname === "/api/plan"
  ));
  await page.getByRole("button", { name: "生成排班", exact: true }).click();
  const submitted = await planRequest;
  const payload = submitted.postDataJSON() as { layout?: { template?: string } };
  expect(payload.layout?.template).toBe("252");
});

test("Skland status center loads full status on demand and deletion preserves non-Skland data", async ({ page }) => {
  const statusMethods: string[] = [];
  let fullSessionRequests = 0;
  let releaseAvatar!: () => void;
  const avatarGate = new Promise<void>((resolve) => { releaseAvatar = resolve; });
  const snapshotWithAvatar = {
    ...authenticatedSklandSnapshot,
    player: {
      ...authenticatedSklandSnapshot.player,
      avatarUrl: "https://example.com/skland-avatar.png",
    },
  };
  await page.route(snapshotWithAvatar.player.avatarUrl, async (route) => {
    await avatarGate;
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
    });
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/skland/status/refresh") statusMethods.push(request.method());
    if (url.pathname === "/api/skland/accounts" && !url.searchParams.has("mode")) fullSessionRequests += 1;
  });
  await mockApis(page, {
    sklandConfigured: true,
    sklandSnapshot: snapshotWithAvatar,
  });
  await seedV4Session(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const calculatorAccount = page.locator("[data-skland-account-control]:visible");
  await expect(calculatorAccount).toBeVisible();
  expect(fullSessionRequests).toBe(0);
  await expect(calculatorAccount.locator("[data-skland-account-avatar] img")).toHaveCount(0);
  const compactAvatarBox = await calculatorAccount.locator("[data-remote-avatar-state]").boundingBox();
  expect(compactAvatarBox?.width).toBeCloseTo(42, 0);
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await openSklandOverview(page);
  await expect.poll(() => fullSessionRequests).toBe(1);

  const statusAvatar = page.locator('[data-skland-page] [data-remote-avatar-state="loading"]');
  await expect(statusAvatar).toBeVisible();
  const statusAvatarBox = await statusAvatar.boundingBox();
  expect(statusAvatarBox?.width).toBeCloseTo(56, 0);
  expect(statusAvatarBox?.height).toBeCloseTo(56, 0);
  releaseAvatar();
  await expect(page.locator('[data-skland-page] [data-remote-avatar-state="loaded"]')).toBeVisible();
  await expect(page.locator('[data-skland-page] [data-remote-avatar-state="loaded"] img')).toBeVisible();

  await expect(page.getByText("UID 123••••789")).toBeVisible();
  await expect(page.getByRole("button", { name: "启用状态中心" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "撤回状态中心授权" })).toHaveCount(0);
  await expect.poll(() => statusMethods).toEqual([]);
  const [postStatus, deleteStatus] = await Promise.all([
    page.request.post("/api/skland/status"),
    page.request.delete("/api/skland/status"),
  ]);
  expect(postStatus.status()).toBe(405);
  expect(deleteStatus.status()).toBe(405);
  const dataControls = page.locator("[data-skland-data-controls]");
  await expect(dataControls).toContainText("MAA 导入与手动布局会保留");
  expect(await dataControls.evaluate((element) => element.parentElement?.lastElementChild === element)).toBe(true);
  const deleteAll = page.getByRole("button", { name: "按住删除全部森空岛数据" });
  await deleteAll.click();
  await expect(page.getByRole("heading", { name: "把当前罗德岛带进排班助手" })).toHaveCount(0);
  const deleteBox = await deleteAll.boundingBox();
  expect(deleteBox).not.toBeNull();
  await page.mouse.move(deleteBox!.x + deleteBox!.width / 2, deleteBox!.y + deleteBox!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1900);
  await page.mouse.up();
  await expect(page.getByRole("heading", { name: "把当前罗德岛带进排班助手" })).toBeVisible();

  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await page.getByRole("button", { name: "基建计算器", exact: true }).click();
  await expect(page.locator("[data-plan-board]")).toHaveAttribute("data-plan-revision", diagnosticId);
});

test("Skland status center keeps profile and recruitment in overview and supports role switching", async ({ page }) => {
  test.setTimeout(90_000);
  const switchedSnapshot = {
    ...authenticatedSklandSnapshot,
    player: {
      ...authenticatedSklandSnapshot.player,
      uid: "987654321",
      nickname: "测试博士二号",
    },
    infrastructure: {
      ...authenticatedSklandSnapshot.infrastructure,
      training: null,
    },
    sourceName: "森空岛同步",
  };
  let attendanceRequests = 0;
  let statusRequests = 0;
  let currentStatusSnapshot: typeof authenticatedSklandSnapshot | typeof switchedSnapshot = authenticatedSklandSnapshot;
  page.on("request", (request) => {
    if (/attendance|sign/i.test(request.url())) attendanceRequests += 1;
    if (new URL(request.url()).pathname === "/api/skland/status/refresh") statusRequests += 1;
  });
  await mockApis(page, {
    sklandConfigured: true,
    sklandSnapshot: authenticatedSklandSnapshot,
  });
  await page.route("**/api/skland/role", (route) => {
    currentStatusSnapshot = switchedSnapshot;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "X-Request-Id": requestId },
      body: JSON.stringify({
        success: true,
        data: {
          authenticated: true,
          configured: true,
          authMethods: { qr: true, credential: true },
          accounts: [{
            ...primarySklandAccount,
            selectedUid: switchedSnapshot.player.uid,
            roles: switchedSnapshot.roles,
          }],
          activeAccountId: primarySklandAccount.accountId,
          scheduleSnapshot: switchedSnapshot,
          statusSnapshot: switchedSnapshot,
        },
        requestId,
      }),
    });
  });
  await page.route("**/api/skland/status/refresh", (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "X-Request-Id": requestId },
      body: JSON.stringify({
        success: true,
        data: {
          accounts: [{
            ...primarySklandAccount,
            selectedUid: currentStatusSnapshot.player.uid,
            roles: currentStatusSnapshot.roles,
          }],
          activeAccountId: primarySklandAccount.accountId,
          snapshot: currentStatusSnapshot,
        },
        requestId,
      }),
    });
  });
  await seedPreferences(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  const scheduleViewTab = page.getByRole("tab", { name: "列表式布局" });
  await expect(scheduleViewTab).toBeVisible();
  await openSklandOverview(page);
  await expect(page.locator("[data-calculator-controls]")).toHaveCount(0);

  await expect(page.getByRole("img", { name: "测试博士的森空岛头像" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "测试博士" }).first()).toBeVisible();
  await expect(page.getByText("UID 123••••789")).toBeVisible();
  const accountCombobox = page.getByRole("combobox", { name: "选择账号与角色" });
  await expect(accountCombobox).toHaveValue("测试博士 · 官服");
  await expect(accountCombobox).not.toHaveValue(/123456789/);
  await accountCombobox.click();
  await waitForOwnAnimations(page.locator('[data-slot="combobox-content"]'));
  const [accountFieldBox, accountPopupBox] = await Promise.all([
    accountCombobox.locator("xpath=..").boundingBox(),
    page.locator('[data-slot="combobox-content"]').boundingBox(),
  ]);
  expect(accountPopupBox?.width).toBeCloseTo(accountFieldBox?.width ?? 0, 0);
  await accountCombobox.press("Escape");
  await expect(page.locator('[data-slot="select-trigger"]')).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "概览", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "基建", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "进度", exact: true })).toHaveCount(0);
  await expect(page.locator("[data-skland-view-tabs]")).toHaveAttribute("data-variant", "default");
  await expect(page.locator("[data-skland-view-tabs] svg")).toHaveCount(0);
  const layoutSync = page.locator('[data-slot="skland-layout-sync"]');
  await expect(layoutSync).toBeVisible();
  await expect(layoutSync).not.toHaveClass(/infra-room-surface/);
  const [viewTabsBox, layoutSyncBox] = await Promise.all([
    page.locator("[data-skland-view-tabs]").boundingBox(),
    layoutSync.boundingBox(),
  ]);
  expect((layoutSyncBox?.x ?? 0)).toBeGreaterThan(viewTabsBox?.x ?? 0);
  const dataControlsBox = await page.locator("[data-skland-data-controls]").boundingBox();
  expect(dataControlsBox?.y).toBeGreaterThan(viewTabsBox?.y ?? 0);
  const sklandViewTabHeight = await page.getByRole("tab", { name: "概览", exact: true })
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(sklandViewTabHeight).toBeCloseTo(26, 0);
  await expect(page.getByRole("tab", { name: "干员", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "实时数据", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "基建数据", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "当前理智", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "无人机", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "日常与周常", exact: true })).toBeVisible();
  await expect(page.locator("[data-skland-metric]")).toHaveCount(0);
  await expect(page.getByText("4 项状态提醒")).toBeVisible();
  await expect(page.getByText("博士档案", { exact: true })).toBeVisible();
  await expect(page.getByText("收藏概况", { exact: true })).toBeVisible();
  const overviewRecruit = page.locator('section[aria-labelledby="overview-recruit-title"]');
  await expect(overviewRecruit.getByRole("heading", { name: "公开招募", exact: true })).toBeVisible();
  await expect(overviewRecruit.getByText("槽位 1")).toBeVisible();

  await page.getByRole("tab", { name: "基建", exact: true }).click();
  await expect(page.getByRole("region", { name: "基建概览", exact: true })).toBeVisible();
  await expect(page.locator('[data-skland-metric="rest"]')).toHaveAttribute("data-metric-tone", "green");
  await expect(page.locator('[data-skland-metric="trading"]')).toHaveAttribute("data-metric-tone", "blue");
  await expect(page.locator('[data-skland-metric="manufacture"]')).toHaveAttribute("data-metric-tone", "amber");
  await expect(page.locator('[data-skland-metric="clue"]')).toHaveAttribute("data-metric-tone", "orange");
  await expect(page.locator('[data-skland-metric] .infra-room-surface')).toHaveCount(4);
  await expect(page.locator('[data-skland-metric] .infra-room-emblem')).toHaveCount(0);
  await expect(page.locator('[data-slot="skland-training-room"]')).toHaveClass(/infra-room-surface/);
  await expect(page.locator('[data-slot="skland-infra-assets"]')).toHaveClass(/infra-room-surface/);
  await expect(page.locator('[data-slot^="skland-"] .infra-room-emblem')).toHaveCount(0);
  await expect(page.locator('[data-slot="skland-layout-sync"] svg').first()).toBeVisible();
  await expect(page.locator('[data-slot="skland-training-room"] svg').first()).toBeVisible();
  await expect(page.locator('[data-slot="skland-infra-assets"] svg').first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "当前基建", exact: true })).toBeVisible();
  await expect(page.getByText("按计算器布局排列，快速核对进驻、心情与生产状态。", { exact: true })).toHaveCount(0);
  await expect(page.locator("[data-skland-compact-layout]")).toBeVisible();
  await expect(page.locator('[data-skland-compact-layout] article[data-room-group]')).toHaveCount(9);
  const recycling = page.locator('[data-skland-compact-layout] [data-room-group="recycling"]');
  await expect(recycling).toContainText("森空岛暂未提供数据");
  await expect(recycling.locator('.infra-operator-slot')).toHaveCount(2);
  await expect(recycling.getByText("未知", { exact: true })).toHaveCount(2);
  const currentTrainingRoom = page.locator('[data-skland-compact-layout] [data-room-group="training"]');
  await expect(currentTrainingRoom).toBeVisible();
  await expect(currentTrainingRoom).toContainText("2/2");
  await expect(currentTrainingRoom.locator('[data-position="训练位"]')).toContainText("凯尔希");
  await expect(currentTrainingRoom.locator('[data-position="协助位"]')).toContainText("阿米娅");
  await expect(currentTrainingRoom.locator('[aria-label^="训练位："]')).toHaveCount(1);
  await expect(currentTrainingRoom.locator('[aria-label^="协助位："]')).toHaveCount(1);
  await expect(currentTrainingRoom.locator('img[title^="职业："]')).toHaveCount(2);
  await expect(page.locator('[data-skland-compact-layout] [data-room-group="processing"]')).toBeVisible();
  await expect(page.getByText(/^线索板：/)).toHaveCount(0);
  const auxiliaryRoomBoxes = await page.locator("[data-skland-functional-rooms] article").evaluateAll((rooms) => Object.fromEntries(
    rooms.map((room) => {
      const bounds = room.getBoundingClientRect();
      return [room.dataset.roomGroup, { x: bounds.x, width: bounds.width }];
    }),
  ));
  expect(auxiliaryRoomBoxes.meeting.x).toBeCloseTo(auxiliaryRoomBoxes.training.x, 0);
  expect(auxiliaryRoomBoxes.hire.x).toBeCloseTo(auxiliaryRoomBoxes.processing.x, 0);
  expect(auxiliaryRoomBoxes.meeting.width).toBeGreaterThan(auxiliaryRoomBoxes.hire.width);
  const compactColumns = page.locator("[data-skland-compact-column]");
  await expect(compactColumns).toHaveCount(2);
  const compactColumnBottoms = await compactColumns.evaluateAll((columns) => columns.map((column) => (
    column.getBoundingClientRect().bottom
  )));
  expect(Math.abs(compactColumnBottoms[0] - compactColumnBottoms[1])).toBeLessThanOrEqual(1);
  const compactLastRoomBottoms = await compactColumns.evaluateAll((columns) => columns.map((column) => {
    const rooms = column.querySelectorAll<HTMLElement>("article[data-room-group]");
    return rooms.item(rooms.length - 1).getBoundingClientRect().bottom;
  }));
  expect(Math.abs(compactLastRoomBottoms[0] - compactLastRoomBottoms[1])).toBeLessThanOrEqual(1);
  const compactRoomEmblem = page.locator("[data-skland-compact-layout] .infra-room-emblem").first();
  await expect(compactRoomEmblem).toBeVisible();
  await expect.poll(() => compactRoomEmblem.evaluate((element) => ({
    backgroundSize: getComputedStyle(element).backgroundSize,
    opacity: getComputedStyle(element).opacity,
  }))).toEqual({ backgroundSize: "auto 100%", opacity: "0.16" });
  await expect(page.getByRole("heading", { name: "控制中枢", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "贸易站 1", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "制造站 1", exact: true })).toBeVisible();
  await expect(page.locator(".infra-room-surface").first()).toBeVisible();
  await expect(page.locator('.level-diamonds[data-variant="compact"]').first()).toBeVisible();
  await expect(page.locator(".infra-operator-slot").first()).toBeVisible();
  await expect(page.getByRole("img", { name: "阿米娅" }).first()).toBeVisible();
  await expect(page.getByText("氛围 5000", { exact: true })).toBeVisible();
  await expect(page.getByText("宿舍氛围 5000", { exact: true })).toHaveCount(0);
  await expect(page.getByText("当前进驻", { exact: true })).toHaveCount(0);
  await expect(page.getByText("设施运行正常", { exact: true })).toHaveCount(0);
  await expect(page.locator("[data-infra-complete-time]").first()).toHaveText(/^\d{4}\.\d{1,2}\.\d{1,2} \d{2}:\d{2}$/);
  await expect(page.getByText("已有 4 · 待接收 2 · 已接收 1", { exact: false })).toHaveCount(0);

  await accountCombobox.click();
  await page.getByRole("option", { name: "测试博士二号 · B服" }).click();
  await expect(page.getByRole("heading", { name: "测试博士二号" }).first()).toBeVisible();
  await expect(page.getByRole("img", { name: "测试博士二号的森空岛头像" })).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新" })).toHaveCount(0);
  const trainingRoom = page.locator('[data-slot="skland-training-room"]');
  await expect(trainingRoom.getByText("当前空闲", { exact: true })).toBeVisible();
  await expect(trainingRoom.getByText("暂无训练任务", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "概览", exact: true }).click();
  await expect(page.getByText("训练任务已完成", { exact: true })).toHaveCount(0);

  await expect.poll(async () => page.evaluate(() => JSON.stringify(localStorage))).not.toContain("987654321");
  const persisted = await page.evaluate(() => JSON.stringify(localStorage));
  expect(persisted).not.toContain("为了更好的明天");
  expect(persisted).not.toContain('"progress"');

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  }

  await page.getByRole("button", { name: "退出" }).click();
  await expect(page.getByRole("heading", { name: "把当前罗德岛带进排班助手" })).toBeVisible();
  expect(attendanceRequests).toBe(0);
  expect(statusRequests).toBe(0);
});

test("Skland layout sync stays beside the tabs and confirms replacement of dirty settings", async ({ page }) => {
  await mockApis(page, {
    sklandConfigured: true,
    sklandSnapshot: authenticatedSklandSnapshot,
  });
  await seedV4Session(page, planData, { layoutDirty: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await openSklandOverview(page);
  const layoutSync = page.locator('[data-slot="skland-layout-sync"]');
  await expect(layoutSync).toContainText("森空岛布局 243");
  const applyButton = layoutSync.getByRole("button", { name: "应用布局" });
  await expect(applyButton).toBeEnabled();
  await applyButton.click();

  const dialog = page.getByRole("dialog", { name: "覆盖当前布局设置？" });
  await expect(dialog).toBeVisible();
  await expectUnifiedDialogTypography(dialog);
  await expectUnifiedDialogAction(dialog.getByRole("button", { name: "取消" }), { height: "46px" });
  await expectUnifiedDialogAction(dialog.getByRole("button", { name: "覆盖并应用" }), { width: "196px", height: "46px" });
  await dialog.getByRole("button", { name: "覆盖并应用" }).click();
  await expect(layoutSync.getByRole("button", { name: "已同步" })).toBeDisabled();
});

test("Skland base metrics reuse the existing technical card grid and keyboard tab navigation", async ({ page }) => {
  await mockApis(page, {
    sklandConfigured: true,
    sklandSnapshot: authenticatedSklandSnapshot,
  });
  await seedPreferences(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await openSklandOverview(page);
  await page.getByRole("tab", { name: "基建", exact: true }).click();

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 960 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    const buildingCards = page.locator('[data-skland-metric-section="building"] [data-skland-metric]');
    await expect(buildingCards).toHaveCount(4);
    await expect(page.locator("[data-skland-overview-grid] > *")).toHaveCount(6);
    await expect(page.locator("[data-skland-metric-glyph]")).toHaveCount(0);

    const widthState = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      offenders: Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { tag: element.tagName, className: element.className, left: rect.left, right: rect.right, width: rect.width };
        })
        .filter((rect) => rect.right > window.innerWidth + 1 || rect.left < -1)
        .slice(0, 8),
    }));
    expect(widthState.overflow, JSON.stringify(widthState)).toBeLessThanOrEqual(1);
  }

  const overviewTab = page.getByRole("tab", { name: "概览", exact: true });
  const inventoryTab = page.getByRole("tab", { name: "背包", exact: true });
  const infrastructureTab = page.getByRole("tab", { name: "基建", exact: true });
  await expect(page.locator("[data-skland-view-tabs] [role=tab]")).toHaveText(["概览", "背包", "基建"]);
  await expect(page.getByRole("tab", { name: "进度", exact: true })).toHaveCount(0);
  await overviewTab.focus();
  await overviewTab.press("ArrowRight");
  await expect(inventoryTab).toBeFocused();
  await inventoryTab.press("ArrowRight");
  await expect(infrastructureTab).toBeFocused();
  await infrastructureTab.press("ArrowRight");
  await expect(overviewTab).toBeFocused();
});

for (const includeProcessing of [false, true]) {
test(`Skland compact layout aligns both column endings when production is taller (${includeProcessing ? "with" : "without"} workshop)`, async ({ page }) => {
  await mockApis(page, {
    sklandConfigured: true,
    sklandSnapshot: includeProcessing ? {
      ...productionHeavySklandSnapshot,
      infrastructure: {
        ...productionHeavySklandSnapshot.infrastructure,
        rooms: [...productionHeavySklandSnapshot.infrastructure.rooms, authenticatedSklandSnapshot.infrastructure.rooms.find((room) => room.group === "processing")!],
      },
    } : productionHeavySklandSnapshot,
  });
  await seedPreferences(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");

  await openSklandOverview(page);
  await page.getByRole("tab", { name: "基建", exact: true }).click();

  const compactColumns = page.locator("[data-skland-compact-column]");
  await expect(compactColumns).toHaveCount(2);
  await expect.poll(() => compactColumns.nth(1).evaluate((column) => (
    getComputedStyle(column).justifyContent
  ))).toBe("normal");

  const compactLastRoomBottoms = await compactColumns.evaluateAll((columns) => columns.map((column) => {
    const rooms = column.querySelectorAll<HTMLElement>("article[data-room-group]");
    return rooms.item(rooms.length - 1).getBoundingClientRect().bottom;
  }));
  expect(Math.abs(compactLastRoomBottoms[0] - compactLastRoomBottoms[1])).toBeLessThanOrEqual(2);

  const alignedRoomBoxes = await page.locator('[data-skland-compact-layout] article[data-room-group]').evaluateAll((rooms) => {
    const boxes = rooms.map((room) => {
      const bounds = room.getBoundingClientRect();
      return { group: room.dataset.roomGroup, top: bounds.top, bottom: bounds.bottom, height: bounds.height };
    });
    const group = (name: string) => boxes.filter((box) => box.group === name);
    return {
      controlBottom: group("control")[0]?.bottom,
      tradeTop: group("trading")[0]?.top,
      trainingTop: group("training")[0]?.top,
      meetingBottom: group("meeting")[0]?.bottom,
      recyclingTop: group("recycling")[0]?.top,
      recyclingBottom: group("recycling")[0]?.bottom,
      processingBottom: group("processing")[0]?.bottom,
      trainingBottom: group("training")[0]?.bottom,
      trainingHeight: group("training")[0]?.height,
      meetingHeight: group("meeting")[0]?.height,
      lastManufactureBottom: group("manufacture").at(-1)?.bottom,
      powerTop: group("power")[0]?.top,
    };
  });
  expect((alignedRoomBoxes.trainingTop ?? 0) - (alignedRoomBoxes.meetingBottom ?? 0)).toBeCloseTo(12, 0);
  expect((alignedRoomBoxes.recyclingTop ?? 0) - (alignedRoomBoxes.trainingBottom ?? 0)).toBeCloseTo(12, 0);
  if (includeProcessing) {
    expect(alignedRoomBoxes.processingBottom).toBeDefined();
    expect(Math.abs((alignedRoomBoxes.recyclingBottom ?? 0) - (alignedRoomBoxes.processingBottom ?? 0))).toBeLessThanOrEqual(1);
  } else {
    expect(alignedRoomBoxes.processingBottom).toBeUndefined();
  }
  expect((alignedRoomBoxes.tradeTop ?? 0) - (alignedRoomBoxes.controlBottom ?? 0)).toBeCloseTo(12, 0);
  expect(alignedRoomBoxes.trainingHeight).toBeCloseTo(alignedRoomBoxes.meetingHeight ?? 0, 0);
  expect(alignedRoomBoxes.meetingHeight).toBeLessThanOrEqual(150);
  expect(alignedRoomBoxes.trainingHeight).toBeLessThanOrEqual(112);
  expect((alignedRoomBoxes.powerTop ?? 0) - (alignedRoomBoxes.lastManufactureBottom ?? 0)).toBeCloseTo(12, 0);
  await expect(page.locator('[data-skland-compact-column="auxiliary"] > [data-room-group="dormitory"]').first()).toHaveCSS("flex-grow", "1");
  await expect(page.locator('[data-room-group="power"] [data-skland-power-efficiency]')).toHaveCount(3);
  await expect(page.locator('[data-room-group="power"] [data-skland-power-efficiency]').first()).toHaveText("效率基准 100%");

  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 960 }]) {
    await page.setViewportSize(viewport);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await expect(page.locator('[data-skland-compact-layout] [data-skland-power-efficiency]')).toHaveCount(3);
  }
});

}

test("Skland supports adding, switching, and individually logging out multiple accounts", async ({ page }) => {
  const secondarySnapshot = {
    ...authenticatedSklandSnapshot,
    player: {
      ...authenticatedSklandSnapshot.player,
      uid: "246813579",
      nickname: "第二账号博士",
      channelName: "官服",
    },
    roles: [{
      uid: "246813579",
      nickname: "第二账号博士",
      channelName: "官服",
      isDefault: true,
    }],
  };
  const secondaryAccount = {
    accountId: "account_secondary",
    selectedUid: secondarySnapshot.player.uid,
    roles: secondarySnapshot.roles,
    credentialExpiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  let currentSnapshot = authenticatedSklandSnapshot;
  let currentAccounts = [primarySklandAccount];
  let currentAccountId: string | null = primarySklandAccount.accountId;

  await mockApis(page, {
    sklandConfigured: true,
    sklandSnapshot: authenticatedSklandSnapshot,
  });
  await page.route(/\/api\/skland\/accounts(?:[/?]|$)/, async (route) => {
    if (route.request().method() === "DELETE") {
      const accountId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() ?? "");
      currentAccounts = currentAccounts.filter((account) => account.accountId !== accountId);
      if (currentAccounts.length) {
        const nextAccount = currentAccounts[0];
        currentAccountId = nextAccount.accountId;
        currentSnapshot = nextAccount.accountId === secondaryAccount.accountId
          ? secondarySnapshot
          : authenticatedSklandSnapshot;
      } else {
        currentAccountId = null;
      }
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "X-Request-Id": requestId },
      body: JSON.stringify({
        success: true,
        data: {
          authenticated: currentAccounts.length > 0,
          configured: true,
          authMethods: { qr: true, credential: true },
          accounts: currentAccounts,
          activeAccountId: currentAccountId,
          ...(currentAccounts.length ? { scheduleSnapshot: currentSnapshot } : {}),
          ...(currentAccounts.length ? { statusSnapshot: currentSnapshot } : {}),
        },
        requestId,
      }),
    });
  });
  await page.route("**/api/skland/auth/qr", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "X-Request-Id": requestId },
    body: JSON.stringify({
      success: true,
      data: {
        scanId: "scan-second-account",
        scanUrl: "hypergryph://scan_login?scanId=scan-second-account",
        expiresInSeconds: 600,
      },
      requestId,
    }),
  }));
  await page.route("**/api/skland/auth/qr/status", (route) => {
    currentAccounts = [primarySklandAccount, secondaryAccount];
    currentAccountId = secondaryAccount.accountId;
    currentSnapshot = secondarySnapshot;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "X-Request-Id": requestId },
      body: JSON.stringify({
        success: true,
        data: {
          status: "authenticated",
          accounts: currentAccounts,
          activeAccountId: currentAccountId,
          scheduleSnapshot: currentSnapshot,
          statusSnapshot: currentSnapshot,
        },
        requestId,
      }),
    });
  });
  await page.route("**/api/skland/role", async (route) => {
    const body = route.request().postDataJSON() as { accountId: string; uid: string };
    const selectedAccount = currentAccounts.find((account) => account.accountId === body.accountId);
    currentAccountId = body.accountId;
    currentSnapshot = body.accountId === secondaryAccount.accountId
      ? secondarySnapshot
      : {
          ...authenticatedSklandSnapshot,
          player: {
            ...authenticatedSklandSnapshot.player,
            uid: body.uid,
            nickname: selectedAccount?.roles.find((role) => role.uid === body.uid)?.nickname ?? "测试博士",
          },
        };
    currentAccounts = currentAccounts.map((account) => account.accountId === body.accountId
      ? { ...account, selectedUid: body.uid }
      : account);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "X-Request-Id": requestId },
      body: JSON.stringify({
        success: true,
        data: {
          authenticated: true,
          configured: true,
          accounts: currentAccounts,
          activeAccountId: currentAccountId,
          scheduleSnapshot: currentSnapshot,
          statusSnapshot: currentSnapshot,
        },
        requestId,
      }),
    });
  });
  await page.route("**/api/skland/status/refresh", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "X-Request-Id": requestId },
    body: JSON.stringify({
      success: true,
      data: {
        accounts: currentAccounts,
        activeAccountId: currentAccountId,
        snapshot: currentSnapshot,
      },
      requestId,
    }),
  }));

  await seedPreferences(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");

  const calculatorAccount = page.locator("[data-skland-account-control]");
  const calculatorAvatar = page.locator("[data-skland-account-avatar]");
  const accountSelect = page.locator("[data-skland-account-select]");
  const addAccount = page.locator("[data-skland-add-account]");
  const logout = page.locator("[data-skland-logout]");
  await expect(calculatorAccount).toBeVisible();
  await expect(calculatorAvatar).toBeVisible();
  const avatarBox = await calculatorAvatar.boundingBox();
  const calculatorAccountBox = await calculatorAccount.boundingBox();
  const setupBox = await page.getByRole("button", { name: "配置Box与布局" }).boundingBox();
  expect(avatarBox?.width).toBeCloseTo(34, 0);
  expect(calculatorAccountBox?.height).toBeCloseTo(36, 0);
  expect(calculatorAccountBox?.height).toBeCloseTo(setupBox?.height ?? 0, 0);
  await expect.poll(() => calculatorAccount.evaluate((element) => getComputedStyle(element).borderTopLeftRadius)).toBe("0px");
  await openSklandOverview(page);
  await expect(calculatorAccount).toHaveCount(0);
  const controlHeights = await Promise.all([
    accountSelect.evaluate((element) => element.getBoundingClientRect().height),
    addAccount.evaluate((element) => element.getBoundingClientRect().height),
    logout.evaluate((element) => element.getBoundingClientRect().height),
  ]);
  for (const height of controlHeights) {
    expect(height).toBeCloseTo(36, 2);
  }
  await expect(logout).toHaveClass(/text-destructive/);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileControlHeights = await Promise.all([
    accountSelect.evaluate((element) => element.getBoundingClientRect().height),
    addAccount.evaluate((element) => element.getBoundingClientRect().height),
    logout.evaluate((element) => element.getBoundingClientRect().height),
  ]);
  for (const height of mobileControlHeights) {
    expect(height).toBeCloseTo(44, 2);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  await addAccount.click();
  const addAccountDialog = page.getByRole("dialog", { name: "添加森空岛账号" });
  await expect(addAccountDialog).toBeVisible();
  await expectUnifiedDialogTypography(addAccountDialog);
  await expect(addAccountDialog).toHaveCSS("width", "960px");
  await expect(addAccountDialog.locator("[data-skland-login-panel]")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const generateLoginQr = addAccountDialog.getByRole("button", { name: "生成登录二维码" });
  await expectUnifiedDialogAction(generateLoginQr, { width: "196px", height: "46px" });
  await addAccountDialog.getByRole("checkbox").nth(0).check();
  await addAccountDialog.getByRole("checkbox").nth(1).check();
  await generateLoginQr.click();
  await expect(page.getByRole("heading", { name: "第二账号博士" }).first()).toBeVisible({ timeout: 12_000 });

  const accountCombobox = page.getByRole("combobox", { name: "选择账号与角色" });
  await accountCombobox.fill("测试博士");
  await expect(page.getByRole("option", { name: "测试博士 · 官服" })).toBeVisible();
  await expect(page.getByRole("option", { name: "第二账号博士 · 官服" })).toHaveCount(0);
  await expect(page.getByText("森空岛账号 1 · 测试博士", { exact: true })).toBeVisible();
  await expect(page.getByText("森空岛账号 2 · 第二账号博士", { exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: "测试博士 · 官服" }).click();
  await expect(accountCombobox).toHaveValue("测试博士 · 官服");
  await expect(page.getByRole("heading", { name: "测试博士" }).first()).toBeVisible();

  await logout.click();
  await expect(page.getByRole("heading", { name: "第二账号博士" }).first()).toBeVisible();
  await logout.click();
  await expect(page.getByRole("heading", { name: "把当前罗德岛带进排班助手" })).toBeVisible();
  await expect(page.locator("[data-skland-account-control]")).toHaveCount(0);
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await page.getByRole("button", { name: "基建计算器", exact: true }).click();
  await expect(page.locator("[data-skland-account-control]")).toHaveCount(0);

  const persisted = await page.evaluate(() => JSON.stringify(localStorage));
  expect(persisted).not.toContain(primarySklandAccount.accountId);
  expect(persisted).not.toContain(secondaryAccount.accountId);
  expect(persisted).not.toContain(secondarySnapshot.player.uid);
});

test("Skland disables adding another account after five accounts", async ({ page }) => {
  const accounts = Array.from({ length: 5 }, (_, index) => ({
    ...primarySklandAccount,
    accountId: `account_limit_${index}`,
  }));
  await mockApis(page, {
    sklandConfigured: true,
    sklandSnapshot: authenticatedSklandSnapshot,
    sklandAccounts: accounts,
    activeAccountId: accounts[0].accountId,
  });
  await seedPreferences(page);
  await page.goto("/");
  await openSklandOverview(page);

  const addAccount = page.locator("[data-skland-add-account]");
  await expect(addAccount).toBeDisabled();
  await expect(addAccount).toHaveAttribute("title", "最多可登录 5 个森空岛账号");
});

test("setup routes Skland account actions to the status center", async ({ page }) => {
  await mockApis(page, {
    sklandConfigured: true,
    sklandSnapshot: authenticatedSklandSnapshot,
  });
  await seedPreferences(page);
  await page.goto("/");

  await expect(page.locator("[data-skland-account-control]")).toBeVisible();
  await page.locator("[data-calculator-controls] [data-calculator-setup-group]")
    .getByRole("button", { name: "配置Box与布局" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /第 1 步，共 3 步：干员数据/ }).click();
  const changeSource = dialog.getByRole("button", { name: "更换", exact: true });
  if (await changeSource.isVisible()) await changeSource.click();
  const sklandTab = dialog.getByRole("tab", { name: "森空岛", exact: true });
  if (await sklandTab.isVisible()) await sklandTab.click();
  await expect(dialog.getByText(/测试博士/).first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: "前往森空岛同步" })).toBeVisible();
  await expect(page.getByRole("button", { name: "使用当前干员数据" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "前往森空岛同步" }).click();
  await expect(page.getByRole("heading", { name: "测试博士" }).first()).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("setup can restore cached Skland data after switching to the sample", async ({ page }) => {
  await mockApis(page, {
    sklandConfigured: true,
    sklandSnapshot: authenticatedSklandSnapshot,
  });
  await seedV4Session(page);
  await page.goto("/");

  await page.getByRole("button", { name: "配置Box与布局" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /第 1 步，共 3 步：干员数据/ }).click();
  await dialog.getByRole("button", { name: "更换", exact: true }).click();
  await dialog.getByRole("tab", { name: "森空岛", exact: true }).click();

  await expect(dialog.getByRole("button", { name: "使用森空岛数据", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "重新同步", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "使用森空岛数据", exact: true }).click();

  await expect(dialog.getByRole("button", { name: /第 2 步，共 3 步：布局/ })).toHaveAttribute("aria-current", "step");
  await expect(dialog.getByRole("button", { name: "检查设施", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: /第 1 步，共 3 步：干员数据/ }).click();
  await expect(dialog.getByText("森空岛同步", { exact: true })).toBeVisible();
  await expect(dialog.getByText("2 名干员 · 2 名可用", { exact: true })).toBeVisible();
});

test("settings clears local product data without logging out of Skland", async ({ page }) => {
  await mockApis(page);
  await seedV4Session(page);
  let logoutRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/skland/accounts/") && request.method() === "DELETE") {
      logoutRequests += 1;
    }
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("arknights-infra-telemetry-session"))).not.toBeNull();
  const telemetrySessionBeforeClear = await page.evaluate(() => window.localStorage.getItem("arknights-infra-telemetry-session"));

  await expect(page.locator("[data-plan-board]")).toHaveAttribute("data-plan-revision", diagnosticId);
  await page.locator("[data-calculator-more-tools]").getByLabel("更多工具", { exact: true }).click();
  await page.locator("[data-calculator-more-tools]").getByRole("button", { name: "配置Box与布局" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /第 1 步，共 3 步：干员数据/ }).click();
  await page.getByText("数据管理", { exact: true }).click();
  const storageCopy = page.getByText("数据在此浏览器保存 30 天。", { exact: true });
  await storageCopy.scrollIntoViewIfNeeded();
  await expect(storageCopy).toBeVisible();
  await page.getByRole("button", { name: "清除本地数据" }).first().click();
  const clearDialog = page.getByRole("dialog", { name: "清除本地数据？" });
  await expect(clearDialog).toBeVisible();
  await expectUnifiedDialogTypography(clearDialog, "24px");
  await expectUnifiedDialogAction(clearDialog.getByRole("button", { name: "保留数据" }), { height: "44px" });
  await expectUnifiedDialogAction(clearDialog.getByRole("button", { name: "清除本地数据" }), { width: "176px", height: "44px" });
  await page.getByRole("button", { name: "清除本地数据" }).last().click();

  const stored = await page.evaluate(() => ({
    v2: window.localStorage.getItem("arknights-infra-calc-beta-session-v2"),
    v3: window.localStorage.getItem("arknights-infra-calc-beta-session-v3"),
    v4: window.localStorage.getItem("arknights-infra-calc-session-v4"),
    v5: window.localStorage.getItem("arknights-infra-calc-session-v5"),
    telemetry: window.localStorage.getItem("arknights-infra-telemetry-session"),
    onboarding: window.localStorage.getItem("arknights-infra-calc-beta-onboarding-v1"),
  }));
  expect({ ...stored, telemetry: undefined }).toEqual({ v2: null, v3: null, v4: null, v5: null, telemetry: undefined, onboarding: null });
  expect(stored.telemetry).not.toBe(telemetrySessionBeforeClear);
  expect(logoutRequests).toBe(0);
});
