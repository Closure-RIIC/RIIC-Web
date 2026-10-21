import { readFile } from "node:fs/promises";
import { switchWorkbenchLanguage } from "./workbench-language";
import { expect, test, type Page } from "@playwright/test";
import { createManualScheduleDraft, type ManualScheduleDraft } from "../src/manual-schedule";
import { createPosterDocument } from "../src/schedule-poster-document";
import layout243 from "../src/layouts/243.json" with { type: "json" };
import { mockAnonymousWebsiteSession, mockApis, now, planData } from "./production-readiness.fixture";

const operators = [
  { id: "char_002_amiya", name: "阿米娅", elite: 2, level: 80, own: true, potential: 6, rarity: 5 },
  { id: "char_300_phenxi", name: "菲亚梅塔", elite: 2, level: 60, own: true, potential: 1, rarity: 6 },
  { id: "char_348_ceylon", name: "锡兰", elite: 2, level: 60, own: true, potential: 1, rarity: 5 },
];

test.beforeEach(async ({ page }) => {
  await mockApis(page);
  await page.addInitScript(({ layout, operbox, savedAt, expiresAt }) => {
    window.localStorage.setItem("arknights-infra-calc-beta-onboarding-v1", "1");
    window.localStorage.setItem("arknights-infra-calc-session-v5", JSON.stringify({
      version: 5,
      savedAt,
      expiresAt,
      presetLabel: "243",
      layout,
      operbox,
      sourceName: "手动排班测试样例",
      boxSource: "sample",
      layoutDirty: false,
      layoutSource: "local",
      localLayoutBackup: null,
      rotationProfile: "abc_12_6_6",
      fiammettaEnabled: false,
      result: null,
      activeShift: 0,
    }));
  }, {
    layout: layout243,
    operbox: operators,
    savedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });
});

test("calculator shows the two-slot recycling station with training visuals", async ({ page }) => {
  await page.addInitScript((result) => {
    const key = "arknights-infra-calc-session-v5";
    const session = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ ...session, result }));
  }, planData);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const board = page.locator('[data-compact-schedule-view]');
  const recycling = board.locator('[data-room-group="recycling"]');
  const training = board.locator('[data-room-group="training"]');
  await expect(recycling).toBeVisible();
  await expect(recycling.locator('.infra-operator-slot')).toHaveCount(2);
  await expect(recycling).toContainText("待配置");
  const visual = (element: Element) => ({
    accent: getComputedStyle(element).getPropertyValue('--room-accent'),
    background: getComputedStyle(element.querySelector('.infra-room-emblem')!).backgroundImage,
  });
  expect(await recycling.evaluate(visual)).toEqual(await training.evaluate(visual));
  const [recyclingBox, trainingBox] = await Promise.all([recycling.boundingBox(), training.boundingBox()]);
  expect(recyclingBox!.width).toBeCloseTo(trainingBox!.width, 0);
  expect(recyclingBox!.x).toBeCloseTo(trainingBox!.x, 0);
  expect(recyclingBox!.y).toBeGreaterThan(trainingBox!.y + trainingBox!.height);
});

test("manual recycling assignments preserve the second slot across reload and mobile layout", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/manual");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible({ timeout: 30_000 });
  const compact = page.locator('[data-manual-editor-board] [data-compact-schedule-view] [data-room-group="recycling"]');
  await expect(compact).toBeVisible();
  await compact.getByRole('button', { name: '空置', exact: true }).nth(1).click();
  const picker = page.getByRole('dialog');
  await picker.getByLabel('搜索可选干员或基建技能').fill('阿米娅');
  await picker.getByRole('button', { name: /阿米娅/ }).click();
  await expect(compact.locator('[data-operator-identity="阿米娅"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('arknights-infra-manual-schedule-v1')!).shifts[0].rooms.recycling_station.operators)).toEqual([null, '阿米娅']);
  await page.reload();
  await expect(compact.locator('[data-operator-identity="阿米娅"]')).toBeVisible();
  expect(await compact.locator('[data-operator-identity]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-operator-identity')))).toEqual(['empty', '阿米娅']);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = page.locator('[data-manual-editor-board] [data-schedule-view="list"] [data-room-group="recycling"]');
  await expect(mobile).toBeVisible();
  await expect(mobile.locator('.infra-operator-slot')).toHaveCount(2);
  await expect(mobile.locator('[data-operator-identity="阿米娅"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mobile.getByRole('button', { name: '一键清空回收站' }).click();
  await expect(mobile.getByRole('button', { name: '空置', exact: true })).toHaveCount(2);
});

test("manual schedule poster loads, calculates and restores its metadata", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("requestfailed", request => {
    if (/\/(src|node_modules)\//.test(new URL(request.url()).pathname)) {
      errors.push(`${request.url()}: ${request.failure()?.errorText}`);
    }
  });
  page.on("response", response => {
    if (response.status() >= 400 && /\/(src|node_modules)\//.test(new URL(response.url()).pathname)) {
      errors.push(`${response.url()}: HTTP ${response.status()}`);
    }
  });
  await page.addInitScript(() => {
    if (localStorage.getItem("arknights-infra-manual-schedule-v1")) return;
    localStorage.setItem("arknights-infra-manual-schedule-v1", JSON.stringify({
      version: 2,
      activeShift: 0,
      fiammettaEnabled: false,
      shifts: [{ durationHours: 24, rooms: { trade_1: { operators: ["阿米娅", null, null] } } }],
    }));
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/manual");
  await page.getByRole("tab", { name: "作业图", exact: true }).click();
  const workbench = page.locator("[data-poster-workbench]");
  const poster = workbench.locator("[data-schedule-poster]");
  await expect(workbench).toBeVisible();
  await expect(poster.locator('[data-poster-room="trade_1"]')).toBeVisible();
  const dorm = poster.locator('[data-poster-room="dorm_1"]');
  const hanger = dorm.locator('[data-poster-shift="0"] [data-poster-hanger-slot]');
  await expect(dorm.locator('[data-poster-shift="0"] .poster-member')).toHaveCount(6);
  await expect(poster.locator('[data-poster-room="trade_1"] [data-poster-shift="0"]')).toContainText("08:00—次日07:59");
  const scheduledDormBefore = await page.evaluate(() => JSON.parse(localStorage.getItem("arknights-infra-manual-schedule-v1")!).shifts[0].rooms.dorm_1.operators);
  await hanger.getByRole("button", { name: "空位", exact: true }).click();
  const hangerPicker = page.getByRole("dialog");
  await expect(hangerPicker).toContainText("不会加入宿舍排班或参与效率计算");
  await hangerPicker.getByLabel("搜索可选干员或基建技能").fill("锡兰");
  await hangerPicker.getByRole("button", { name: /锡兰/ }).click();
  await expect(hanger).toContainText("锡兰");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("riic.schedule-poster.v1")!).presentation.dormHangerOperators[0])).toBe("锡兰");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("arknights-infra-manual-schedule-v1")!).shifts[0].rooms.dorm_1.operators)).toEqual(scheduledDormBefore);
  await page.getByRole("tab", { name: "排班编辑", exact: true }).click();
  await expect(page.locator('[data-manual-editor-board] [data-room-title="宿舍 1"] .infra-operator-slot')).toHaveCount(5);
  await page.getByRole("tab", { name: "作业图", exact: true }).click();
  const firstShiftStart = workbench.getByLabel("第一班开始时间", { exact: true });
  await workbench.getByRole("button", { name: "清除第一班开始时间", exact: true }).click();
  await expect(firstShiftStart).toHaveValue("");
  expect(await poster.innerText()).not.toMatch(/\b\d{2}:\d{2}\b/);
  await expect(poster).toContainText("24 h");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("arknights-infra-manual-evaluation-v1"))).not.toBeNull();
  const tradeEfficiency = poster.locator('[data-poster-room="trade_1"] .poster-efficiency-pair');
  await expect(tradeEfficiency).toContainText("纸面");
  await expect(tradeEfficiency).toContainText("等效");
  await expect(tradeEfficiency).toContainText("贸易");
  await expect(tradeEfficiency).toContainText("赤金");
  await workbench.getByRole("button", { name: "批量填写排班" }).click();
  const bulk = page.getByLabel("批量排班文本");
  const shiftCount = await poster.locator('[data-poster-room="trade_1"] [data-poster-shift]').count();
  await bulk.fill(`贸易站1：巫恋、龙舌兰、柏喙 @自动 #龙门币${Array.from({ length: shiftCount - 1 }, () => " | -").join("")}`);
  await page.getByRole("button", { name: "检查并应用" }).click();
  await expect(tradeEfficiency).toContainText(/(?:[1-9]\d*|\d+\.\d+)%赤金/);
  await expect(tradeEfficiency).toHaveAttribute("title", /巫恋 E2 \+ 龙舌兰 E2/);
  await workbench.getByLabel("班次数", { exact: true }).click();
  await page.getByRole("option", { name: "4 班", exact: true }).click();
  await expect(poster).toHaveAttribute("data-shift-count", "4");
  const productAlignment = await poster.locator('[data-poster-room="trade_1"] [data-poster-shift="0"]').evaluate(node => {
    const heading = node.querySelector(".poster-production-heading")!.getBoundingClientRect();
    const shift = node.querySelector(".poster-shift-label b")!.getBoundingClientRect();
    const product = node.querySelector(".poster-shift-meta")!.getBoundingClientRect();
    return { heading, shift, product };
  });
  expect(productAlignment.product.x).toBeGreaterThanOrEqual(productAlignment.shift.right - 1);
  expect(productAlignment.product.x).toBeLessThan(productAlignment.heading.x + productAlignment.heading.width / 2);
  const equivalentValueSizes = await poster.locator('[data-poster-room="trade_1"] .poster-equivalent-values').evaluateAll(nodes =>
    nodes.map(node => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth })),
  );
  expect(equivalentValueSizes).toHaveLength(4);
  expect(equivalentValueSizes.every(size => size.scrollWidth <= size.clientWidth + 1)).toBe(true);
  const productionLayout = await poster.locator('[data-poster-room="trade_1"] [data-poster-shift="0"]').evaluate(node => {
    const members = node.querySelector(".poster-members")!.getBoundingClientRect();
    const efficiency = node.querySelector(".poster-efficiency-panel")!.getBoundingClientRect();
    return { members, efficiency };
  });
  expect(productionLayout.efficiency.x).toBeGreaterThanOrEqual(productionLayout.members.right - 1);
  expect(productionLayout.efficiency.y).toBeLessThan(productionLayout.members.bottom);
  expect(productionLayout.efficiency.bottom).toBeGreaterThan(productionLayout.members.y);
  await workbench.getByLabel("班次数", { exact: true }).click();
  await page.getByRole("option", { name: "3 班", exact: true }).click();
  await expect(poster).toHaveAttribute("data-shift-count", "3");
  const dormLayout = await poster.locator('[data-poster-room="dorm_1"] [data-poster-shift]').evaluateAll(nodes =>
    nodes.map(node => {
      const members = node.querySelector(".poster-members")!.getBoundingClientRect();
      const slots = [...node.querySelectorAll(".poster-member")].map(slot => {
        const rect = slot.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      });
      return { members: { left: members.left, right: members.right }, slots };
    }),
  );
  expect(dormLayout).toHaveLength(3);
  expect(dormLayout.every(row => row.slots.length === 6)).toBe(true);
  expect(dormLayout.every(row => row.slots.every(slot => slot.left >= row.members.left - 1 && slot.right <= row.members.right + 1))).toBe(true);
  for (let slot = 0; slot < 6; slot += 1) {
    const positions = dormLayout.map(row => row.slots[slot]!.left);
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(1);
  }
  const imageDownload = page.waitForEvent("download");
  await workbench.getByRole("button", { name: "导出一页 PNG", exact: true }).click();
  const downloadedImage = await imageDownload;
  const image = await readFile((await downloadedImage.path())!);
  expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(image.readUInt32BE(16)).toBe(1920);
  expect(image.readUInt32BE(20)).toBe(1080);
  await workbench.getByLabel("作业名称", { exact: true }).fill("243 作业图测试");
  await expect(poster).toContainText("243 作业图测试");
  await page.goto("/manual?tab=poster");
  await expect(workbench).toBeVisible({ timeout: 20_000 });
  await expect(workbench.getByLabel("作业名称", { exact: true })).toHaveValue("243 作业图测试");
  await expect(poster).toContainText("243 作业图测试");
  await expect(page.getByText("Something went wrong!", { exact: true })).toHaveCount(0);
  await expect(workbench.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const entry of ["handoff", "code"] as const) {
  test(`imported poster ${entry} preserves edits and allows switching back to the editor`, async ({ page }) => {
    const draft = createManualScheduleDraft([24], "08:00", "period");
    draft.shifts[0]!.rooms.trade_1 = { operators: ["阿米娅", null, null] };
    const document = createPosterDocument(layout243, draft, operators);
    document.meta.title = "导入的作业";
    if (entry === "handoff") {
      await page.addInitScript(doc => sessionStorage.setItem("riic.schedule-poster.handoff.v1.manual", JSON.stringify(doc)), document);
    } else {
      await page.route("**/api/schedule-posters?code=abcdef123456", route => route.fulfill({ json: { document } }));
    }
    await page.goto(entry === "handoff" ? "/manual" : "/manual?tab=poster&code=abcdef123456");
    const workbench = page.locator("[data-poster-workbench]");
    await expect(workbench.getByLabel("作业名称", { exact: true })).toHaveValue("导入的作业", { timeout: 30_000 });
    await workbench.getByLabel("作业名称", { exact: true }).fill("修改后的作业");
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("riic.schedule-poster.v1")!).meta.title)).toBe("修改后的作业");
    await page.getByRole("tab", { name: "排班编辑", exact: true }).click();
    await expect(page.locator("[data-manual-editor-board]")).toBeVisible();
    await page.getByRole("tab", { name: "作业图", exact: true }).click();
    await expect(workbench.getByLabel("作业名称", { exact: true })).toHaveValue("修改后的作业");
    if (entry === "handoff") expect(await page.evaluate(() => sessionStorage.getItem("riic.schedule-poster.handoff.v1.manual"))).toBeNull();
  });
}

test("manual editor restores external operators before opening the lazy poster", async ({ page }) => {
  const draft = createManualScheduleDraft([24], "08:00", "period");
  draft.externalOperatorNames = ["巫恋"];
  draft.shifts[0]!.rooms.trade_1 = { operators: ["巫恋", null, null] };
  await page.addInitScript(value => localStorage.setItem("arknights-infra-manual-schedule-v1", JSON.stringify(value)), draft);
  const posterRequests: string[] = [];
  page.on("request", request => {
    if (/schedule-poster-(document|model)[-.]/.test(request.url())) posterRequests.push(request.url());
  });
  await page.goto("/manual");
  const operator = page.locator('[data-manual-editor-board] [data-room-title="贸易站 1"] [data-operator-identity="巫恋"]');
  await expect(operator).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("作业示例练度（非个人持有）：巫恋。", { exact: false })).toBeVisible();
  expect(posterRequests).toEqual([]);
  await page.getByRole("tab", { name: "作业图", exact: true }).click();
  await expect(page.locator("[data-poster-workbench]")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("riic.schedule-poster.v1")!).operators.find((entry: { name: string }) => entry.name === "巫恋")?.elite)).toBe(2);
});

test("poster uses current owned training instead of stale cached training", async ({ page }) => {
  const draft = createManualScheduleDraft([24], "08:00", "period");
  draft.shifts[0]!.rooms.trade_1 = { operators: ["阿米娅", null, null] };
  const document = createPosterDocument(layout243, draft, [{ ...operators[0]!, elite: 0, level: 1 }]);
  await page.addInitScript(({ draft, document }) => {
    localStorage.setItem("arknights-infra-manual-schedule-v1", JSON.stringify(draft));
    localStorage.setItem("riic.schedule-poster.v1", JSON.stringify(document));
  }, { draft, document });
  await page.goto("/manual?tab=poster");
  await expect(page.locator("[data-poster-workbench]")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => {
    const operator = JSON.parse(localStorage.getItem("riic.schedule-poster.v1")!).operators.find((entry: { name: string }) => entry.name === "阿米娅");
    return { elite: operator?.elite, level: operator?.level };
  })).toEqual({ elite: 2, level: 80 });
});

test("sidebar resumes an existing manual draft without invoking the solver and keeps editing scoped to manual", async ({ page }) => {
  let planRequests = 0;
  await page.route("**/api/plan", (route) => {
    planRequests += 1;
    return route.abort();
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  await page.evaluate(() => {
    window.localStorage.setItem("arknights-infra-manual-schedule-v1", JSON.stringify({
      version: 2,
      activeShift: 0,
      fiammettaEnabled: false,
      shifts: [{
        durationHours: 9,
        fiammettaTarget: null,
        rooms: { trade_1: { operators: ["阿米娅", null, null] } },
      }],
    }));
  });
  await expect(page.locator('[data-calculator-export-actions="desktop"]')).toHaveCount(0);
  await page.getByRole("button", { name: "手动排班", exact: true }).click();
  await expect(page).toHaveURL(/\/manual$/);
  await expect(page.getByRole("tab", { name: /第 1 班.*24h/ })).toBeVisible();
  await expect(page.locator('[data-manual-editor-board] [data-room-title="贸易站 1"] [data-operator-identity="阿米娅"]')).toBeVisible();
  const recycling = page.locator('[data-manual-editor-board] [data-compact-schedule-view] [data-room-group="recycling"]');
  await recycling.getByRole("button", { name: "空置", exact: true }).nth(1).click();
  const picker = page.getByRole("dialog");
  await picker.getByLabel("搜索可选干员或基建技能").fill("锡兰");
  await picker.getByRole("button", { name: /锡兰/ }).click();
  await expect(recycling.locator('[data-operator-identity="锡兰"]')).toBeVisible();
  await page.reload();
  await expect(recycling.locator('[data-operator-identity="锡兰"]')).toBeVisible();
  await page.locator('[data-primary-navigation-page="calculator"]').click();
  await expect(page.locator('[data-primary-page="calculator"]')).toBeVisible();
  await expect(page.locator("[data-manual-editor-board]")).toHaveCount(0);
  expect(planRequests).toBe(0);
});

test("manual scheduling hides a personal Box until website login", async ({ page }) => {
  await mockAnonymousWebsiteSession(page);
  await page.addInitScript(() => {
    const key = "arknights-infra-calc-session-v5";
    const session = JSON.parse(window.localStorage.getItem(key) ?? "null");
    window.localStorage.setItem(key, JSON.stringify({ ...session, boxSource: "maa" }));
  });

  await page.goto("/manual");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  await expect(page.locator("[data-manual-schedule-page]")).toHaveCount(0);
  await page.getByRole("button", { name: "配置 Box 与布局" }).click();
  await expect(page.getByRole("dialog", { name: "登录网站账号" })).toBeVisible();
});

test("clearing local data from manual scheduling does not recreate its draft", async ({ page }) => {
  await page.goto("/manual");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  await page.getByRole("button", { name: "配置 Box 与布局" }).first().click();
  const setup = page.getByRole("dialog");
  await setup.getByText("数据管理", { exact: true }).click();
  await setup.getByRole("button", { name: "清除本地数据" }).click();
  const confirmation = page.getByRole("dialog", { name: "清除本地数据？" });
  await confirmation.getByRole("button", { name: "清除本地数据" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => page.evaluate(() => (
    window.localStorage.getItem("arknights-infra-manual-schedule-v1")
  ))).toBeNull();
});

test("calculator onboarding does not expose manual editing", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.removeItem("arknights-infra-calc-beta-onboarding-v1");
  });
  await page.goto("/");
  const startPanel = page.locator("[data-calculator-start-panel]");
  await expect(startPanel).toBeVisible();
  await expect(startPanel.getByRole("button", { name: "基于当前方案编辑" })).toHaveCount(0);
});

test("calculator converts a solved schedule into editable manual assignments", async ({ page }) => {
  await page.addInitScript((result) => {
    const key = "arknights-infra-calc-session-v5";
    const session = JSON.parse(window.localStorage.getItem(key) ?? "null");
    window.localStorage.setItem(key, JSON.stringify({ ...session, result }));
  }, planData);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  await page.evaluate(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      if (key === "arknights-infra-manual-schedule-v1") {
        throw new DOMException("Storage disabled", "SecurityError");
      }
      return originalSetItem.call(this, key, value);
    };
  });
  const desktopActions = page.locator('[data-calculator-export-actions="desktop"]');
  await expect(desktopActions.getByRole("button", { name: "导出到 MAA" })).toBeEnabled();
  await desktopActions.getByRole("button", { name: "基于当前方案编辑" }).click();

  await expect(page).toHaveURL(/\/manual$/);
  await expect(page.locator('[data-manual-draft-source="baseline"]')).toContainText("基于「原方案」创建");
  await expect(page.getByRole("tab", { name: /班次 1.*08:00至19:59.*12小时/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /班次 2.*20:00至01:59.*6小时/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /班次 3.*02:00至07:59.*6小时/ })).toBeVisible();
  await expect(page.locator('[data-manual-editor-board] [data-room-title="加工站"] [data-operator-identity="阿米娅"]')).toBeVisible();
});

test("calculator protects a different manual draft before replacing it from a result", async ({ page }) => {
  await page.addInitScript((result) => {
    const key = "arknights-infra-calc-session-v5";
    const session = JSON.parse(window.localStorage.getItem(key) ?? "null");
    window.localStorage.setItem(key, JSON.stringify({ ...session, result }));
  }, planData);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  await page.evaluate(() => {
    window.localStorage.setItem("arknights-infra-manual-schedule-v1", JSON.stringify({
      version: 2,
      activeShift: 0,
      fiammettaEnabled: false,
      shifts: [{
        durationHours: 9,
        fiammettaTarget: null,
        rooms: { trade_1: { operators: ["阿米娅", null, null] } },
      }],
    }));
  });

  const editCurrentPlan = page.locator('[data-calculator-plan-actions="desktop"]').getByRole("button", { name: "基于当前方案编辑" });
  await editCurrentPlan.click();
  const confirmation = page.getByRole("dialog", { name: "替换现有手动草稿？" });
  await expect(confirmation).toContainText("基于「原方案」创建手动排班");
  await confirmation.getByRole("button", { name: "保留现有草稿" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => page.evaluate(() => JSON.parse(
    window.localStorage.getItem("arknights-infra-manual-schedule-v1") ?? "null",
  )?.shifts?.[0]?.durationHours)).toBe(9);

  await editCurrentPlan.click();
  await confirmation.getByRole("button", { name: "替换并进入" }).click();
  await expect(page).toHaveURL(/\/manual$/);
  await expect(page.locator('[data-manual-draft-source="baseline"]')).toContainText("基于「原方案」创建");
});

test("mobile result actions explain both adjustment paths", async ({ page }) => {
  await page.addInitScript((result) => {
    const key = "arknights-infra-calc-session-v5";
    const session = JSON.parse(window.localStorage.getItem(key) ?? "null");
    window.localStorage.setItem(key, JSON.stringify({ ...session, result }));
  }, planData);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  await page.getByRole("button", { name: "调整方案", exact: true }).click();
  const actions = page.getByRole("dialog", { name: "调整当前方案" });
  await expect(actions).toContainText("当前正在查看「原方案」");
  await expect(actions.getByRole("button", { name: /修改练度并重新计算/ })).toBeVisible();
  await expect(actions.getByRole("button", { name: /基于当前方案手动编辑/ })).toBeVisible();
});

test("manual MAA downloads normalize dorm autofill without changing the editor switch", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/manual");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  const autofill = page.getByRole("button", { name: /宿舍 1.*自动补位/ });
  await expect(autofill).toHaveAttribute("aria-pressed", "true");
  await autofill.click();
  await expect(autofill).toHaveAttribute("aria-pressed", "false");

  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出到 MAA", exact: true }).click();
  const download = await pending;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  for (const plan of exported.plans) {
    for (const room of plan.rooms.dormitory) {
      expect(room).toMatchObject({ autofill: true, skip: false });
      expect(room).not.toHaveProperty("candidates");
    }
  }
  await expect(autofill).toHaveAttribute("aria-pressed", "false");
});

async function openManualWorkflow(page: Page, tradeOperators?: Array<string | null>) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let planRequests = 0;
  await page.route("**/api/plan", (route) => {
    planRequests += 1;
    return route.abort();
  });
  if (tradeOperators) {
    // Later scenarios start from the persisted state verified by the setup and
    // assignment scenarios, without repeating every unrelated editor action.
    const draft: ManualScheduleDraft = {
      version: 3,
      scheduleMode: "period",
      externalOperatorNames: [],
      startTime: "09:00",
      activeShift: 0,
      fiammettaEnabled: true,
      shifts: [11, 13].map((durationHours) => ({
        durationHours,
        fiammettaTarget: null,
        droneTargetRoomId: "manu_1",
        rooms: { trade_1: { operators: tradeOperators } },
      })),
    };
    draft.shifts[1]!.rooms = {};
    await page.addInitScript((value) => localStorage.setItem("arknights-infra-manual-schedule-v1", JSON.stringify(value)), draft);
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/manual");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  await expect(page.locator("[data-manual-schedule-page]")).toBeVisible();
  await expect(page.locator('[data-primary-navigation-page="manual"]')).toHaveAttribute("aria-current", "page");
  return () => planRequests;
}

test("manual scheduling configures independent shifts and responsive drone controls", async ({ page }) => {
  const planRequests = await openManualWorkflow(page);

  await switchWorkbenchLanguage(page, "en");
  await expect(page.getByRole("button", { name: "Configure Box & layout" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Export MAA" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Shift 1.*12h/ })).toBeVisible();
  await switchWorkbenchLanguage(page, "zh");

  const scheduleToolbar = page.locator("[data-manual-editor-board] [data-schedule-toolbar]");
  const layoutTabs = scheduleToolbar.getByRole("tablist", { name: "排班布局切换" });
  const shiftTabs = scheduleToolbar.locator("[data-manual-shift-actions] [data-shift-tabs]");
  await expect(layoutTabs).toHaveAttribute("data-slot", "tabs-list");
  await expect(shiftTabs).toHaveAttribute("data-slot", "tabs-list");
  const [layoutTabsBox, shiftTabsBox] = await Promise.all([layoutTabs.boundingBox(), shiftTabs.boundingBox()]);
  expect(shiftTabsBox?.y).toBeCloseTo(layoutTabsBox?.y ?? 0, 0);
  expect(shiftTabsBox?.x).toBeGreaterThan((layoutTabsBox?.x ?? 0) + (layoutTabsBox?.width ?? 0));
  await expect(shiftTabs.getByRole("tab", { name: /第 1 班.*12h/ })).toBeVisible();

  await page.getByRole("button", { name: "配置 Box 与布局" }).first().click();
  const setup = page.getByRole("dialog");
  await setup.getByRole("button", { name: "继续", exact: true }).click();
  await expect(setup.locator("[data-manual-shift-settings]")).toBeVisible();
  await expect(setup.getByRole("combobox", { name: "换班方式" })).toHaveCount(0);
  const modeTabs = setup.getByRole("tablist", { name: "排班模式" });
  await expect(modeTabs.locator('[data-slot="tabs-indicator"]')).toHaveCount(1);
  await expect(modeTabs.getByRole("tab", { name: /顺序轮换/ })).toHaveAttribute("aria-selected", "true");
  await modeTabs.getByRole("tab", { name: /时间区间/ }).click();
  const shiftCount = setup.getByRole("group", { name: "班次数", exact: true });
  const decreaseShift = shiftCount.getByRole("button", { name: "减少一个班次" });
  const increaseShift = shiftCount.getByRole("button", { name: "增加一个班次" });
  await expect(shiftCount.locator("output")).toHaveText("3");
  await expect(increaseShift).toBeDisabled();
  await decreaseShift.click();
  await decreaseShift.click();
  await expect(shiftCount.locator("output")).toHaveText("1");
  await expect(decreaseShift).toBeDisabled();
  await increaseShift.click();
  await increaseShift.click();
  await expect(shiftCount.locator("output")).toHaveText("3");
  await expect(increaseShift).toBeDisabled();
  await expect(shiftCount.locator("[data-setup-stepper]")).toHaveCount(1);
  await expect(setup.getByRole("group", { name: "首班开始", exact: true }).locator("[data-setup-stepper]")).toHaveCount(1);
  await expect(setup.locator('input[type="time"]')).toHaveCount(0);
  await expect(setup.getByLabel("班次 1 开始时间")).toHaveText("08:00");
  await setup.getByRole("button", { name: "首班推迟一小时" }).click();
  const firstBoundary = setup.getByRole("slider", { name: "班次 1 与班次 2 的分界" });
  await firstBoundary.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(firstBoundary).toHaveAttribute("aria-valuenow", "11");
  await expect(setup.locator("[data-shift-hour-cells] > span")).toHaveCount(24);
  await expect(setup.locator("[data-shift-timeline-legend]")).toContainText("20:00");
  await setup.getByRole("button", { name: "减少一个班次" }).click();
  await expect(setup.getByRole("slider")).toHaveCount(1);
  await expect(setup.locator("[data-shift-timeline-legend]")).toContainText("08:59");
  await setup.getByRole("checkbox", { name: /未启用/ }).click();
  await setup.getByRole("button", { name: "继续", exact: true }).click();
  await setup.getByRole("button", { name: "完成", exact: true }).click();

  await expect(page.getByRole("tab", { name: /班次 1.*09:00至19:59.*11小时/ })).toBeVisible();
  await expect(page.locator("[data-manual-shift-actions] [data-shift-tabs]").getByRole("tab")).toHaveCount(2);
  const manualShiftActions = scheduleToolbar;
  const moraleTarget = manualShiftActions.getByRole("button", { name: "选择换心情目标" });
  const [moraleTargetBox, configuredShiftTabsBox] = await Promise.all([
    moraleTarget.boundingBox(),
    manualShiftActions.locator("[data-shift-tabs]").boundingBox(),
  ]);
  expect(moraleTargetBox?.x).toBeGreaterThan(configuredShiftTabsBox?.x ?? 0);
  expect((moraleTargetBox?.y ?? 0) + (moraleTargetBox?.height ?? 0) / 2)
    .toBeCloseTo((configuredShiftTabsBox?.y ?? 0) + (configuredShiftTabsBox?.height ?? 0) / 2, 0);
  await moraleTarget.click();
  await expect(page.getByRole("dialog").locator("[data-manual-operator-choice]")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toContainText("请先在页面中安排干员");
  await page.keyboard.press("Escape");


  const trade = page.locator('[data-manual-editor-board] [data-room-title="贸易站 1"]');
  const factory = page.locator('[data-manual-editor-board] [data-room-title="制造站 1"]');
  const tradeDrones = trade.getByRole("button", { name: "贸易站 1 无人机加速" });
  const factoryDrones = factory.getByRole("button", { name: "制造站 1 无人机加速" });
  await tradeDrones.click();
  await expect(tradeDrones).toHaveAttribute("aria-pressed", "true");
  await factoryDrones.click();
  await expect(tradeDrones).toHaveAttribute("aria-pressed", "false");
  await expect(factoryDrones).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 1100, height: 1000 });
  await expect(page.locator('[data-manual-editor-board] [data-schedule-view="list"]')).toBeVisible();
  const listFactoryDrones = page.locator('[data-manual-editor-board] [data-schedule-view="list"] [data-room-title="制造站 1"]').getByRole("button", { name: "制造站 1 无人机加速" });
  await listFactoryDrones.hover();
  await expect(listFactoryDrones).toHaveCSS("background-color", /0\.28/);
  await expect(page.getByText("取消当前班次无人机加速", { exact: true })).toBeVisible();
  const listAutofill = page.getByRole("button", { name: /宿舍 1.*自动补位/ });
  await expect(listAutofill.locator("svg")).toHaveCount(0);
  await listAutofill.hover();
  await expect(listAutofill).toHaveCSS("background-color", /0\.28/);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('[data-manual-editor-board] [data-schedule-view="compact"]')).toBeVisible();
  await expect(trade.getByRole("button", { name: "空置" }).first()).toContainText("可编辑");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("arknights-infra-manual-schedule-v1")!))).toMatchObject({
    scheduleMode: "period", startTime: "09:00", fiammettaEnabled: true,
    shifts: [{ durationHours: 11, droneTargetRoomId: "manu_1" }, { durationHours: 13 }],
  });
  expect(planRequests()).toBe(0);
});

test("manual scheduling filters morale targets and moves conflicting operators", async ({ page }) => {
  const planRequests = await openManualWorkflow(page, []);
  const manualShiftActions = page.locator("[data-manual-editor-board] [data-schedule-toolbar]");
  const moraleTarget = manualShiftActions.getByRole("button", { name: "选择换心情目标" });
  const trade = page.locator('[data-manual-editor-board] [data-room-title="贸易站 1"]');
  const factory = page.locator('[data-manual-editor-board] [data-room-title="制造站 1"]');
  const factoryDrones = factory.getByRole("button", { name: "制造站 1 无人机加速" });
  await trade.getByRole("button", { name: "空置" }).first().click();
  let operatorPicker = page.getByRole("dialog");
  await expect(operatorPicker.getByRole("tab", { name: "贸易站", exact: true })).toHaveAttribute("aria-selected", "true");
  await operatorPicker.getByRole("tab", { name: "贸易站", exact: true }).click();
  await expect(operatorPicker.getByRole("tab", { name: "贸易站", exact: true })).toHaveAttribute("aria-selected", "true");
  await operatorPicker.getByRole("tablist", { name: "工作房间" }).getByRole("tab", { name: "全部", exact: true }).click();
  await expect(operatorPicker.getByRole("tablist", { name: "工作房间" }).getByRole("tab", { name: "全部", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(operatorPicker.getByText("技能标签", { exact: true })).toBeVisible();
  await expect(operatorPicker.getByText("暂无可选标签", { exact: true })).toBeVisible();
  await operatorPicker.getByLabel("搜索可选干员或基建技能").fill("阿米娅");
  await operatorPicker.getByRole("button", { name: /阿米娅/ }).click();
  const editableAmiyaSlot = trade.getByRole("button", { name: /阿米娅/ });
  await expect(editableAmiyaSlot).toBeVisible();
  await expect(editableAmiyaSlot.locator("button")).toHaveCount(0);

  await trade.getByRole("button", { name: "空置" }).first().click();
  operatorPicker = page.getByRole("dialog");
  await operatorPicker.getByRole("tablist", { name: "工作房间" }).getByRole("tab", { name: "全部", exact: true }).click();
  await operatorPicker.getByLabel("搜索可选干员或基建技能").fill("锡兰");
  await operatorPicker.getByRole("button", { name: /锡兰/ }).click();

  await moraleTarget.click();
  const fiammettaPicker = page.getByRole("dialog");
  await expect(fiammettaPicker.locator("[data-manual-operator-choice]").first().locator('img[width="180"]')).toBeVisible();
  await expect(fiammettaPicker.locator("[data-elite-badge]").first()).toBeVisible();
  await expect(fiammettaPicker.getByRole("group", { name: "星级" })).toBeVisible();
  await expect(fiammettaPicker.getByRole("button", { name: "上一页" })).toBeDisabled();
  await expect(fiammettaPicker.getByRole("button", { name: "下一页" })).toBeDisabled();
  await expect(fiammettaPicker.locator("[data-manual-operator-placeholder]")).toHaveCount(22);
  await expect(fiammettaPicker.getByRole("button", { name: /菲亚梅塔/ })).toHaveCount(0);
  const pickerSearch = fiammettaPicker.getByLabel("搜索可选干员或基建技能");
  await pickerSearch.fill("锡兰");
  await fiammettaPicker.getByRole("button", { name: /锡兰/ }).hover();
  await expect(page.locator('[data-slot="tooltip-content"][data-open]')).toBeVisible({ timeout: 1_000 });
  await fiammettaPicker.locator('[data-slot="scroll-area-viewport"]').evaluate((element) => {
    element.dispatchEvent(new Event("scroll"));
  });
  await expect(page.locator('[data-slot="tooltip-content"][data-open]')).toHaveCount(0);
  await page.waitForTimeout(200);
  await pickerSearch.fill("阿米娅");
  await fiammettaPicker.getByRole("button", { name: /阿米娅/ }).hover();
  await expect(page.locator('[data-slot="tooltip-content"][data-open]')).toBeVisible({ timeout: 1_000 });
  await pickerSearch.fill("锡兰");
  await fiammettaPicker.getByRole("button", { name: /锡兰/ }).click();
  await expect(manualShiftActions.getByRole("button", { name: "换心情 锡兰" })).toBeVisible();
  await expect(manualShiftActions.locator("[data-fiammetta-target-chip] img")).toBeVisible();

  await manualShiftActions.locator("[data-fiammetta-target-chip]").click();
  const clearMoraleTarget = fiammettaPicker.locator("[data-manual-clear-morale-target]");
  await expect(clearMoraleTarget).toBeVisible();
  await clearMoraleTarget.click();
  await expect(manualShiftActions.getByRole("button", { name: "选择换心情目标" })).toBeVisible();

  await trade.getByRole("button", { name: /阿米娅/ }).click();
  operatorPicker = page.getByRole("dialog");
  await operatorPicker.getByRole("tablist", { name: "工作房间" }).getByRole("tab", { name: "全部", exact: true }).click();
  await operatorPicker.getByLabel("搜索可选干员或基建技能").fill("阿米娅");
  await expect(operatorPicker.locator('[data-current-selection=""]')).toContainText("贸易站 1");
  await operatorPicker.getByRole("button", { name: /阿米娅/ }).click();
  await expect(trade.getByRole("button", { name: /阿米娅/ })).toBeVisible();

  await trade.getByRole("button", { name: /锡兰/ }).click();
  operatorPicker = page.getByRole("dialog");
  await operatorPicker.getByRole("tablist", { name: "工作房间" }).getByRole("tab", { name: "全部", exact: true }).click();
  await operatorPicker.getByLabel("搜索可选干员或基建技能").fill("阿米娅");
  await operatorPicker.getByRole("button", { name: /阿米娅/ }).click();
  await expect(trade.locator('[data-operator-identity]')).toHaveCount(3);
  const orderedIdentities = await trade.locator('[data-operator-identity]').evaluateAll((elements) => (
    elements.map((element) => element.getAttribute("data-operator-identity"))
  ));
  expect(orderedIdentities.slice(0, 3)).toEqual(["锡兰", "阿米娅", "empty"]);

  await factory.getByRole("button", { name: "空置" }).first().click();
  operatorPicker = page.getByRole("dialog");
  await expect(operatorPicker.getByRole("tab", { name: "制造站", exact: true })).toHaveAttribute("aria-selected", "true");
  await operatorPicker.getByRole("tablist", { name: "工作房间" }).getByRole("tab", { name: "全部", exact: true }).click();
  await operatorPicker.getByLabel("搜索可选干员或基建技能").fill("阿米娅");
  await operatorPicker.getByRole("button", { name: /阿米娅/ }).click();
  const moveDialog = page.getByRole("dialog", { name: "移动该干员？" });
  await expect(moveDialog).toContainText("已经在贸易站 1工作");
  await moveDialog.getByRole("button", { name: "移动干员" }).click();
  await expect(trade.locator('[data-operator-identity="阿米娅"]')).toHaveCount(0);
  await expect(factory.locator('[data-operator-identity="阿米娅"]')).toBeVisible();
  await factory.getByRole("button", { name: "一键清空制造站 1" }).click();
  await expect(factory.locator('[data-operator-identity="阿米娅"]')).toHaveCount(0);
  await expect(factoryDrones).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("arknights-infra-manual-schedule-v1")!).shifts[0])).toMatchObject({
    fiammettaTarget: null, droneTargetRoomId: "manu_1",
    rooms: { trade_1: { operators: ["锡兰", null, null] }, manu_1: { operators: [null, null, null] } },
  });
  expect(planRequests()).toBe(0);
});

test("manual scheduling clears autofill and shifts and exports independent periods", async ({ page }) => {
  const planRequests = await openManualWorkflow(page, ["锡兰", null, null]);
  const moraleTarget = page.locator("[data-manual-editor-board] [data-schedule-toolbar]").getByRole("button", { name: "选择换心情目标" });
  const trade = page.locator('[data-manual-editor-board] [data-room-title="贸易站 1"]');
  const factory = page.locator('[data-manual-editor-board] [data-room-title="制造站 1"]');
  const factoryDrones = factory.getByRole("button", { name: "制造站 1 无人机加速" });

  const dorm = page.locator('[data-manual-editor-board] [data-room-title="宿舍 1"]');
  await expect(dorm.locator('[data-operator-identity="autofill"]')).toHaveCount(5);
  const dormAutofill = dorm.getByRole("button", { name: /宿舍 1.*自动补位/ });
  await expect(dormAutofill).toHaveAttribute("aria-pressed", "true");
  await expect(dormAutofill.locator("svg")).toHaveCount(0);
  await dormAutofill.hover();
  await expect(dormAutofill).toHaveCSS("background-color", /0\.28/);
  await factoryDrones.hover();
  await expect(factoryDrones).toHaveCSS("background-color", /0\.28/);
  await dormAutofill.click();
  await expect(dorm.locator('[data-operator-identity="autofill"]')).toHaveCount(0);
  await expect(dormAutofill).toHaveAttribute("aria-pressed", "false");
  await dormAutofill.click();
  await expect(dorm.locator('[data-operator-identity="autofill"]')).toHaveCount(5);
  await dorm.getByRole("button", { name: "一键清空宿舍 1" }).click();
  await expect(dorm.locator('[data-operator-identity="autofill"]')).toHaveCount(0);
  await expect(dormAutofill).toHaveAttribute("aria-pressed", "false");

  await page.getByRole("tab", { name: /班次 2.*20:00至08:59.*13小时/ }).click();
  await moraleTarget.click();
  await expect(page.getByRole("dialog").locator("[data-manual-operator-choice]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(factory.locator('[data-operator-identity="阿米娅"]')).toHaveCount(0);
  await factory.getByRole("button", { name: "空置" }).first().click();
  await page.getByRole("dialog").getByRole("tablist", { name: "工作房间" }).getByRole("tab", { name: "全部", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /阿米娅/ }).click();
  await expect(factory.locator('[data-operator-identity="阿米娅"]')).toBeVisible();
  await page.getByRole("button", { name: "清空当前班次所有设施" }).click();
  const clearShiftDialog = page.getByRole("dialog", { name: "清空当前班次所有设施？" });
  await expect(clearShiftDialog).toContainText("其他班次不会改变");
  await clearShiftDialog.getByRole("button", { name: "清空当前班次" }).click();
  await expect(factory.locator('[data-operator-identity="阿米娅"]')).toHaveCount(0);
  await page.getByRole("tab", { name: /班次 1.*09:00至19:59.*11小时/ }).click();
  await expect(trade.locator('[data-operator-identity="锡兰"]')).toBeVisible();
  expect(planRequests()).toBe(0);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出到 MAA" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("arknights-infra-schedule-maa.json");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(exported).toMatchObject({ title: "手动排班 · 243", planTimes: "2班" });
  expect(exported.plans[0].period).toEqual([["09:00", "19:59"]]);
  expect(exported.plans[1].period).toEqual([["20:00", "23:59"], ["00:00", "08:59"]]);
  expect(exported.plans[0].drones).toBeUndefined();
  for (const plan of exported.plans) {
    for (const room of plan.rooms.dormitory) {
      expect(room).toMatchObject({ autofill: true, skip: false });
      expect(room).not.toHaveProperty("candidates");
    }
  }
  expect(exported.plans[1].drones).toEqual({ enable: true, room: "manufacture", index: 1, rule: "all", order: "pre" });
  for (const plan of exported.plans) {
    for (const rooms of Object.values(plan.rooms) as Array<Array<{ operators: unknown[] }>>) {
      for (const room of rooms) expect(room.operators.every((operator) => typeof operator === "string")).toBe(true);
    }
  }

});

test("manual scheduling previews and imports an external MAA schedule file", async ({ page }) => {
  await page.goto("/manual");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  await expect(page.locator("[data-manual-schedule-page]")).toBeVisible();

  const importedSchedule = {
    title: "外部排版",
    plans: [
      {
        name: "白班",
        period: [["08:15", "19:59"]],
        rooms: {
          control: [{ operators: ["外部测试干员"] }],
          trading: [{ product: "Originium Shard", operators: [] }],
        },
      },
      {
        name: "夜班",
        period: [["20:00", "23:59"], ["00:00", "08:14"]],
        rooms: {
          trading: [{ product: "Originium Shard", operators: ["锡兰"] }],
          manufacture: [{ product: "Battle Record", operators: [] }],
        },
      },
    ],
  };
  await expect(page.getByRole("button", { name: "导入排班文件" })).toBeVisible();
  await page.getByRole("button", { name: "导入排班文件" }).click();
  const upload = page.locator("[data-file-upload-dialog]");
  await expect(upload).toHaveAccessibleName("导入排班文件");
  const chooser = page.waitForEvent("filechooser");
  await upload.getByRole("button", { name: "选择文件", exact: true }).click();
  await (await chooser).setFiles({
    name: "external-schedule.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(importedSchedule)),
  });

  await expect(upload).toHaveCount(0);
  const preview = page.getByRole("dialog", { name: "导入这个 MAA 排班？" });
  await expect(preview).toContainText("external-schedule.json");
  await expect(preview).toContainText("干员位置：2 / 2");
  await preview.getByRole("button", { name: "导入并替换草稿" }).click();

  await expect(page.getByRole("tab", { name: /班次 1.*08:15至19:59.*11小时45分钟/ })).toBeVisible();
  await expect(page.locator('[data-manual-editor-board] [data-room-title="控制中枢"] [data-operator-identity="外部测试干员"]')).toBeVisible();
  await expect(page.locator('[data-manual-editor-board] [data-room-title="贸易站 1"]')).toContainText("开采协力");
  await expect(page.locator('[data-manual-editor-board] [data-room-title="制造站 1"]')).toContainText("作战记录");
  await page.getByRole("tab", { name: /班次 2.*20:00至08:14.*12小时15分钟/ }).click();
  await expect(page.locator('[data-manual-editor-board] [data-room-title="贸易站 1"] [data-operator-identity="锡兰"]')).toBeVisible();

  await page.getByRole("button", { name: "配置 Box 与布局" }).first().click();
  const setup = page.getByRole("dialog");
  await setup.getByRole("button", { name: "继续", exact: true }).click();
  await setup.getByRole("button", { name: "继续", exact: true }).click();
  await expect(setup.locator('[data-facility-group="trade"] [data-slot="setup-room-row"]').first().getByRole("button", { name: "开采协力" })).toHaveAttribute("aria-pressed", "true");
  await expect(setup.locator('[data-facility-group="factory"] [data-slot="setup-room-row"]').first().getByRole("button", { name: "作战记录" })).toHaveAttribute("aria-pressed", "true");
});
