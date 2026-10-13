import { expect, test, type Locator } from "@playwright/test";
import arkntoolsSource from "../src/generated/arkntools/source.json" with { type: "json" };
import { twoShiftPlanData } from "./production-readiness.fixture";
import { requestId, diagnosticId, waitForOwnAnimations, gotoStable, expectVisibleNumbersUseNumberFont, profile, planData, scheduleVisualPlanData, sampleData, authenticatedSklandSnapshot, mockApis, openSklandOverview, seedPreferences, seedV4Session } from "./production-readiness.fixture";

const fullOperatorCount = arkntoolsSource.counts.operators;

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

async function expectSetupAction(button: Locator) {
  await expect(button).toHaveAttribute("data-setup-action", "");
  const expectedHeight = await button.evaluate(() => (
    window.matchMedia("(max-width: 639px)").matches ? "44px" : "36px"
  ));
  await expect(button).toHaveCSS("height", expectedHeight);
  await expect(button).toHaveCSS("border-radius", "18px");
  await expect(button).toHaveCSS("font-size", "12px");
}

test("drone selection updates exports and restores automatic allocation without solving", async ({ page }) => {
  await mockApis(page);
  await seedV4Session(page, twoShiftPlanData, { rotationProfile: "main_backup_12_12" });
  let solves = 0;
  page.on("request", request => { if (request.method() === "POST" && /\/api\/(?:plan|tasks)$/.test(new URL(request.url()).pathname)) solves++; });
  await page.goto("/");
  async function exportedDrones() {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出到 MAA", exact: true }).click();
    const stream = await (await pending).createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return JSON.parse(Buffer.concat(chunks).toString("utf8")).plans[1].drones;
  }
  const automatic = await exportedDrones();
  const automaticSwitch = page.getByRole("switch", { name: "自动分配无人机", exact: true });
  await expect(automaticSwitch).toBeChecked();
  const controls = page.locator('[data-schedule-view-controls]');
  await expect(controls.locator('[data-shift-tabs]')).toBeVisible();
  const summaryControls = page.locator('[data-plan-summary] [data-plan-summary-controls]');
  await expect(summaryControls.getByRole("switch", { name: "自动分配无人机" })).toBeVisible();
  await expect(page.locator('[data-schedule-toolbar]').getByRole("switch")).toHaveCount(0);
  const [orundumBox, droneBox, moraleBox] = await Promise.all([
    page.locator('[data-daily-product-group="orundum"]').boundingBox(),
    page.locator('[data-plan-support="drones"]').boundingBox(),
    page.locator('[data-plan-support="morale"]').boundingBox(),
  ]);
  expect(droneBox?.y).toBeCloseTo(orundumBox?.y ?? 0, 0);
  expect(moraleBox?.y).toBeCloseTo(orundumBox?.y ?? 0, 0);
  expect(droneBox?.x).toBeGreaterThan(orundumBox?.x ?? 0);
  expect(moraleBox?.x).toBeGreaterThan(droneBox?.x ?? 0);
  await automaticSwitch.click();
  await expect(automaticSwitch).not.toBeChecked();
  await page.getByRole("button", { name: "选择设施", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "选择无人机去向" });
  await picker.getByRole("button", { name: "贸易站 1", exact: true }).click();
  await expect(picker).toHaveCount(0);
  expect(await exportedDrones()).toMatchObject({ room: "trading", index: 1, enable: true });
  await expect(page.locator('[data-plan-support="drones"]')).toContainText("贸易站 1");
  const selectedDrone = page.getByRole("button", { name: /贸易站 1.*无人机加速/ });
  await expect(selectedDrone).toHaveAttribute("aria-pressed", "true");
  await selectedDrone.hover();
  await expect(selectedDrone).toHaveCSS("background-color", /0\.28/);
  await automaticSwitch.focus();
  await page.keyboard.press("Space");
  await expect(automaticSwitch).toBeChecked();
  expect(await exportedDrones()).toEqual(automatic);
  await page.setViewportSize({ width: 390, height: 844 });
  await automaticSwitch.click();
  await page.getByRole("button", { name: "选择设施", exact: true }).click();
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "不使用无人机", exact: true }).click();
  expect(await exportedDrones()).toBeUndefined();
  expect(solves).toBe(0);
});

test("mobile interactive targets remain at least 44 CSS pixels", async ({ page }) => {
  await mockApis(page);
  await seedV4Session(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const undersized = await page.locator('button:not(:disabled), a[href], input:not([type="hidden"]), [role="tab"]:not([aria-disabled="true"])').evaluateAll((elements) => (
    elements.flatMap((element) => {
      if (element.getAttribute("aria-label") === "Open Next.js Dev Tools") return [];
      if (element.closest("footer")) return [];
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none" || rect.width === 0 || rect.height === 0) return [];
      if (rect.width >= 44 && rect.height >= 44) return [];
      return [{
        name: element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }];
    })
  ));
  expect(undersized).toEqual([]);
});

test("an empty generated profile explains that no training action is needed", async ({ page }) => {
  await mockApis(page);
  await seedV4Session(page);
  await page.goto("/");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  await page.getByRole("button", { name: "练卡建议" }).click();

  await expect(page.getByRole("heading", { name: "本次排班暂无培养建议" })).toBeVisible();
  await expect(page.getByText("当前干员与布局没有需要优先培养的项目，可以继续使用现有排班。")).toBeVisible();
  await expect(page.getByRole("button", { name: "查看当前排班" })).toBeVisible();
  await expect(page.getByText("先导入干员数据、确认基建布局并生成一次排班。")).toHaveCount(0);
});

for (const format of ["report", "legacy"] as const) {
  test(`training owned filter uses Box ownership and restores all ${format} recommendations`, async ({ page }) => {
    const operators = ["阿米娅", "清流", "凯尔希"];
    const result = {
      ...planData,
      profile: { ...profile, actions: operators.map((operator) => ({
        priority: "高", kind: "promote", operator, domain_id: "manufacture", message: "培养建议", current_elite: 0,
      })) },
      ...(format === "report" ? { trainingAdvice: {
        schema_version: 2, context: {}, newbie_section_status: "complete", incomplete_newbie: [], combinations: [],
        recommendations: operators.map((operator) => ({
          action: "train", operator, priority: "high_efficiency_standalone", priority_rank: 1, reason: "standalone",
          current: { elite: 0, level: 1 }, target: { kind: "explicit", elite: 1, level: 30 },
        })),
      } } : {}),
    };
    await mockApis(page);
    await seedV4Session(page, result, { operbox: [
      ...sampleData,
      { id: "char_385_finlpp", name: "清流", elite: 0, level: 1, rarity: 4, own: false, potential: 1 },
    ] });
    await page.goto("/training");
    const cards = page.locator('[data-training-advice-list] [data-slot="training-advice-card"]');
    const filter = page.getByRole("button", { name: "只看已拥有", exact: true });
    await expect(cards).toHaveCount(3);
    await expect(filter).toHaveAttribute("aria-pressed", "false");
    await filter.click();
    await expect(filter).toHaveAttribute("aria-pressed", "true");
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("阿米娅");
    await filter.click();
    await expect(cards).toHaveCount(3);
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(filter).toBeVisible();
    await filter.click();
    await expect(cards).toHaveCount(1);
    await filter.click();
    const rarity = page.locator('[data-training-filters] [data-slot="tabs-list"]').first();
    await rarity.getByRole("tab").filter({ hasText: "6★" }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText("凯尔希");
    await rarity.getByRole("tab", { name: "全部", exact: true }).click();
    await expect(cards).toHaveCount(3);
    if (format === "report") {
      await cards.filter({ hasText: "阿米娅" }).getByRole("button", { name: "拉黑阿米娅", exact: true }).click();
      await expect(cards).toHaveCount(2);
      await page.reload();
      await expect(cards).toHaveCount(2);
      await page.getByRole("button", { name: "清除拉黑（1）", exact: true }).click();
      await expect(cards).toHaveCount(3);
    }
  });
}

test("setup keeps Box parse errors local and actionable", async ({ page }) => {
  await mockApis(page, {
    sklandConfigured: true,
    sklandSnapshot: authenticatedSklandSnapshot,
  });
  await seedV4Session(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.locator("[data-plan-board]")).toHaveAttribute("data-plan-revision", diagnosticId);
  const moreTools = page.locator("[data-calculator-more-tools]");
  await moreTools.getByLabel("更多工具", { exact: true }).click();
  const setupTrigger = moreTools.getByRole("button", { name: "配置Box与布局" });
  await setupTrigger.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /第 1 步，共 3 步：干员数据/ }).click();
  await expect(dialog.locator(".setup-data-summary")).toHaveCount(1);
  const changeBoxButton = dialog.getByRole("button", { name: "更换", exact: true });
  await expectSetupAction(changeBoxButton);
  await changeBoxButton.click();
  await page.getByRole("tab", { name: "森空岛", exact: true }).click();
  await expect(dialog.locator(".setup-import-action")).toHaveCount(1);
  await page.getByRole("tab", { name: "MAA", exact: true }).click();
  await dialog.getByRole("button", { name: "粘贴 JSON", exact: true }).click();
  const [boxContentBox, boxViewportBox] = await Promise.all([
    dialog.locator("[data-setup-box-content]").boundingBox(),
    dialog.locator('[data-slot="scroll-area-viewport"]:visible').boundingBox(),
  ]);
  expect(boxContentBox).not.toBeNull();
  expect(boxViewportBox).not.toBeNull();
  expect(boxContentBox?.width).toBeCloseTo(boxViewportBox?.width ?? 0, 0);
  const textarea = dialog.getByPlaceholder("粘贴 Arknights_OperBox_Export.json 内容");
  await textarea.fill("not valid json");
  const importJsonButton = dialog.getByRole("button", { name: "导入 JSON" });
  await expectSetupAction(importJsonButton);
  await importJsonButton.click();

  await expect(textarea).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.locator('[role="alert"]')).toHaveCount(1);
  await expect.poll(() => page.locator('[role="alert"]').evaluateAll((elements) => (
    elements.filter((element) => element.textContent?.trim()).length
  ))).toBe(1);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(setupTrigger).toBeFocused();
});

test("fresh MAA import requires one facility review before completion", async ({ page }) => {
  await mockApis(page);
  await seedPreferences(page);
  await page.goto("/");

  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  await page.getByRole("button", { name: "配置Box与布局" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "MAA", exact: true }).click();
  await dialog.getByRole("button", { name: "粘贴 JSON", exact: true }).click();
  await dialog.getByLabel("JSON 内容").fill(JSON.stringify(sampleData));
  await dialog.getByRole("button", { name: "导入 JSON", exact: true }).click();

  await expect(dialog.getByRole("button", { name: /第 2 步，共 3 步：布局/ })).toHaveAttribute("aria-current", "step");
  await expect(dialog.getByRole("button", { name: "检查设施", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "检查设施", exact: true }).click();
  await expect(dialog.getByRole("button", { name: /第 3 步，共 3 步：设施/ })).toHaveAttribute("aria-current", "step");
  await expect(dialog.getByRole("button", { name: "完成", exact: true })).toBeEnabled();
});

test("setup always reopens on operator data, including from the Skland overview", async ({ page }) => {
  await mockApis(page, {
    sklandConfigured: true,
    sklandSnapshot: authenticatedSklandSnapshot,
  });
  await seedV4Session(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const setupTrigger = page.getByRole("button", { name: "配置Box与布局" }).first();
  await setupTrigger.click();
  const dialog = page.getByRole("dialog");
  const boxStep = dialog.getByRole("button", { name: /第 1 步，共 3 步：干员数据/ });
  await expect(boxStep).toHaveAttribute("aria-current", "step");
  await dialog.getByRole("button", { name: "继续", exact: true }).click();
  await expect(dialog.getByRole("button", { name: /第 2 步，共 3 步：布局/ })).toHaveAttribute("aria-current", "step");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);

  await setupTrigger.click();
  await expect(boxStep).toHaveAttribute("aria-current", "step");
  await dialog.getByRole("button", { name: "Close" }).click();

  await openSklandOverview(page);
  await page.getByRole("button", { name: "继续配置布局", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(boxStep).toHaveAttribute("aria-current", "step");
});

test("setup with an empty BOX starts on operator data", async ({ page }) => {
  await mockApis(page);
  await seedPreferences(page);
  await page.goto("/");

  await page.getByRole("button", { name: "配置Box与布局" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: /第 1 步，共 3 步：干员数据/ })).toHaveAttribute("aria-current", "step");
});

test("progression adjustments sync back to the schedule settings manual BOX", async ({ page }) => {
  await mockApis(page, { taskQueueEnabled: true });
  const adjustedPlanData = {
    ...planData,
    maa: {
      ...planData.maa,
      plans: planData.maa.plans.map((plan, index) => index === 0 ? {
        ...plan,
        rooms: { ...plan.rooms, processing: [{ operators: [] }] },
      } : plan),
    },
    rotation: {
      ...planData.rotation,
      daily: {
        ...planData.rotation.daily,
        production: {
          ...planData.rotation.daily.production,
          lmd: 41_200,
        },
      },
    },
    diagnosticId: `${diagnosticId}-progression-adjustment`,
  };
  let releaseAdjustment!: () => void;
  const adjustmentGate = new Promise<void>((resolve) => {
    releaseAdjustment = resolve;
  });
  const taskId = "11111111-1111-4111-8111-111111111113";
  let directPlanRequests = 0;
  let taskSubmissions = 0;
  let taskPolls = 0;
  await page.route("**/api/plan", async (route) => {
    directPlanRequests += 1;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ success: false, error: { code: "AIC-PLAN-3001", message: "排班服务暂不可用，请稍后重试。", retryable: true }, requestId }),
    });
  });
  await page.route(/\/api\/tasks(?:\/[^/?]+)?$/, async (route) => {
    if (route.request().method() === "POST") {
      taskSubmissions += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { taskId, status: "pending", queuePosition: 1, etaSeconds: 3 }, requestId }),
      });
    }
    taskPolls += 1;
    await adjustmentGate;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { taskId, status: "done", result: adjustedPlanData }, requestId }),
    });
  });
  await seedV4Session(page, planData, { boxSource: "maa" });
  await page.goto("/");

  await page.getByRole("button", { name: "修改练度并重算", exact: true }).click();
  const adjustmentDialog = page.getByRole("dialog");
  const rosterScopeTabs = adjustmentDialog.getByRole("tablist", { name: "干员列表范围" });
  const scheduledTab = rosterScopeTabs.getByRole("tab", { name: /进入排班/ });
  const unscheduledTab = rosterScopeTabs.getByRole("tab", { name: /未进排班/ });
  await expect(rosterScopeTabs).toHaveAttribute("data-slot", "tabs-list");
  await expect(scheduledTab).toHaveAttribute("data-slot", "tabs-trigger");
  await expect(scheduledTab).toHaveAttribute("aria-selected", "true");
  await unscheduledTab.click();
  await expect(unscheduledTab).toHaveAttribute("aria-selected", "true");
  await scheduledTab.click();
  await adjustmentDialog.getByRole("textbox", { name: "搜索干员" }).fill("阿米娅");
  const adjustmentStage = adjustmentDialog.getByRole("radiogroup", { name: "阿米娅持有与精英阶段" });
  await adjustmentStage.getByRole("radio", { name: "精1", exact: true }).click();
  await adjustmentDialog.getByRole("button", { name: "保存练度并重新计算", exact: true }).click();
  const activity = page.locator('[data-slot="live-activity"]');
  await expect(activity).toHaveAttribute("data-activity-phase", "queued");
  await expect(activity).toBeVisible();
  await expect(activity).toContainText("正在排队");
  await expect(adjustmentDialog).toBeVisible();
  await expect(adjustmentDialog.getByRole("button", { name: "正在重新求解…", exact: true })).toBeDisabled();
  await expect.poll(() => ({ directPlanRequests, taskSubmissions, taskPolls })).toEqual({ directPlanRequests: 0, taskSubmissions: 1, taskPolls: 1 });
  releaseAdjustment();
  await expect(activity).toHaveAttribute("data-activity-phase", "success");
  await expect(activity).toContainText("调整练度已完成");
  await expect(adjustmentDialog).toBeHidden();

  const scheduleVariantTabs = page.getByRole("tablist", { name: "排班方案切换" });
  await expect(scheduleVariantTabs).toHaveAttribute("data-slot", "tabs-list");
  await expect(scheduleVariantTabs.getByRole("tab", { name: "练度调整后", exact: true })).toHaveAttribute("aria-selected", "true");
  const scheduleViewControls = page.locator("[data-schedule-view-controls]");
  const scheduleLayoutTabs = scheduleViewControls.getByRole("tablist", { name: "排班布局切换" });
  await expect(scheduleViewControls).toContainText("原方案");
  await expect(scheduleViewControls).toContainText("一图流布局");
  const [variantTabsBox, layoutTabsBox] = await Promise.all([
    scheduleVariantTabs.boundingBox(),
    scheduleLayoutTabs.boundingBox(),
  ]);
  expect(variantTabsBox?.y).toBeCloseTo(layoutTabsBox?.y ?? 0, 0);
  await expect(page.getByText(/正在查看练度调整后方案/)).toHaveCount(0);

  const lmdProduction = page.locator('[data-daily-product="lmd-orders"] [data-animated-value="number"]');
  await expect(lmdProduction).toHaveAttribute("aria-label", "41,200");
  const lmdCalligraph = lmdProduction.locator("[data-calligraph]");
  await expect(lmdCalligraph).toBeVisible();
  await lmdCalligraph.evaluate((element) => element.setAttribute("data-animation-sentinel", "stable"));
  await scheduleVariantTabs.getByRole("tab", { name: "原方案", exact: true }).click();
  await expect(lmdCalligraph).toHaveAttribute("data-animation-sentinel", "stable");
  await expect(lmdProduction).toHaveAttribute("aria-label", "34,254");
  await scheduleVariantTabs.getByRole("tab", { name: "练度调整后", exact: true }).click();
  await expect(lmdCalligraph).toHaveAttribute("data-animation-sentinel", "stable");
  await expect(lmdProduction).toHaveAttribute("aria-label", "41,200");

  await expect.poll(() => page.evaluate(() => {
    const session = JSON.parse(window.localStorage.getItem("arknights-infra-calc-session-v5") ?? "{}");
    return session.operbox?.find((operator: { name?: string }) => operator.name === "阿米娅")?.elite;
  })).toBe(1);

  await page.getByRole("button", { name: "配置Box与布局" }).first().click();
  const setupDialog = page.getByRole("dialog");
  await setupDialog.getByRole("button", { name: "更换", exact: true }).click();
  await expect(setupDialog.getByRole("tab", { name: "手动选择", exact: true })).toHaveAttribute("aria-selected", "true");
  const manualPicker = setupDialog.locator("[data-manual-operbox-picker]");
  await manualPicker.getByRole("textbox", { name: "搜索干员" }).fill("阿米娅");
  await manualPicker.getByRole("button", { name: "查看阿米娅的基建技能", exact: true }).hover();
  const manualSkillTooltip = page.locator('[data-slot="tooltip-content"]');
  await expect(manualSkillTooltip).toBeVisible();
  await expect(manualSkillTooltip.getByText("当前选择：精1 Lv.70", { exact: true })).toBeVisible();
  await expect(manualSkillTooltip.getByText("已解锁", { exact: true })).toBeVisible();
  await expect(manualSkillTooltip.getByText("未解锁", { exact: true })).toBeVisible();
  await expect(manualSkillTooltip.locator('[data-skill-unlocked="false"]')).toHaveCSS("opacity", "0.7");
  await expect(manualSkillTooltip.locator('[data-skill-unlocked="false"]')).toHaveCSS("filter", "grayscale(1)");
  await expect(manualPicker.getByRole("radiogroup", { name: "阿米娅持有与精英阶段" }).getByRole("radio", { name: "精1", exact: true })).toBeChecked();
  await setupDialog.getByRole("button", { name: "Close" }).click();

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(scheduleVariantTabs).toBeVisible();
    await expect(scheduleLayoutTabs).toBeHidden();
    const [mobileControlsBox, mobileVariantBox] = await Promise.all([
      scheduleViewControls.boundingBox(),
      scheduleVariantTabs.boundingBox(),
    ]);
    expect(mobileVariantBox?.width).toBeCloseTo(mobileControlsBox?.width ?? 0, 0);
    for (const tab of await scheduleVariantTabs.getByRole("tab").all()) {
      const box = await tab.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44 - 0.01);
    }
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-calculator-export-actions="desktop"]').getByRole("button", { name: "基于当前方案编辑" }).click();
  await expect(page).toHaveURL(/\/manual$/);
  await expect(page.locator('[data-manual-draft-source="progression-adjusted"]')).toContainText("基于「练度调整后方案」创建");
  await expect(page.locator('[data-room-title="加工站"] [data-operator-identity="阿米娅"]')).toHaveCount(0);
});

test("setup exposes and persists only worker-supported rotation profiles", async ({ page }) => {
  test.slow();
  await mockApis(page);
  await seedV4Session(page);
  let planRequests = 0;
  let requestedRotation: unknown;
  let requestedOperbox: unknown;
  let requestedSourceName: unknown;
  let requestedBoxSource: unknown;
  await page.route("**/api/plan", async (route) => {
    planRequests += 1;
    const requestBody = route.request().postDataJSON() as {
      rotation?: unknown;
      operbox?: unknown;
      sourceName?: unknown;
      boxSource?: unknown;
    };
    requestedRotation = requestBody.rotation;
    requestedOperbox = requestBody.operbox;
    requestedSourceName = requestBody.sourceName;
    requestedBoxSource = requestBody.boxSource;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: planData, requestId }),
    });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "配置Box与布局" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveClass(/dialog-surface/);
  await expect(dialog.locator("[data-setup-top]")).toBeVisible();
  await expect(dialog.getByText("导入干员数据，再确认换班方式与基建设施。修改会立即应用，但不会自动生成排班。")).toHaveCount(0);
  await expect(dialog.locator("[data-setup-footer]")).toBeVisible();
  await expect(dialog.locator("[data-setup-footer]")).toHaveClass(/setup-dialog-footer/);
  await expect(dialog).toHaveCSS("border-radius", "32px");
  const dialogMaterial = await dialog.evaluate((element) => ({
    shadow: getComputedStyle(element).boxShadow,
    backdrop: getComputedStyle(element).backdropFilter,
    texture: getComputedStyle(element, "::before").backgroundImage,
  }));
  expect(dialogMaterial.texture).toContain("repeating-linear-gradient");
  expect(dialogMaterial.texture).toContain("radial-gradient");
  expect(dialogMaterial.texture).toContain("12px");
  expect(dialogMaterial.shadow).toContain("0px 18px 48px");
  expect(dialogMaterial.backdrop).toBe("none");
  await expect(dialog).toHaveCSS("width", "960px");
  const setupPrimaryAction = dialog.getByRole("button", { name: "继续", exact: true });
  await expect(setupPrimaryAction).toHaveCSS("width", "196px");
  await expect(setupPrimaryAction).toHaveCSS("height", "46px");
  await expect(setupPrimaryAction).toHaveCSS("border-radius", "22px");
  await expect(setupPrimaryAction).toHaveCSS("font-size", "13px");
  await expect(setupPrimaryAction.locator("svg")).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: "排班设置" })).toBeVisible();
  const closeButton = dialog.getByRole("button", { name: "Close" });
  await expect(closeButton).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await closeButton.hover();
  await expect(closeButton).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(dialog.getByText("森空岛、MAA 或测试样例", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("布局、换班、等级、产品和订单", { exact: true })).toHaveCount(0);
  const stepList = dialog.getByRole("list", { name: "设置步骤" });
  await expect(stepList.locator(":scope > *")).toHaveCount(3);
  expect((await stepList.boundingBox())?.width ?? 0).toBeGreaterThan(600);
  await expect(dialog).toHaveCSS("height", "720px");
  const initialStepListBox = await stepList.boundingBox();
  await dialog.getByRole("button", { name: /第 1 步，共 3 步：干员数据/ }).click();
  const changeBoxButton = dialog.getByRole("button", { name: "更换", exact: true });
  await expectSetupAction(changeBoxButton);
  await dialog.getByText("数据管理", { exact: true }).click();
  await expectSetupAction(dialog.getByRole("button", { name: "清除本地数据", exact: true }));
  await dialog.getByText("数据管理", { exact: true }).click();
  await changeBoxButton.click();
  await expect(dialog.locator("#setup-import-options")).toBeVisible();
  await expect(dialog).toHaveCSS("height", "720px");
  await dialog.getByRole("tab", { name: "MAA", exact: true }).click();
  await dialog.getByRole("button", { name: "粘贴 JSON", exact: true }).click();
  await expectSetupAction(dialog.getByRole("button", { name: "导入 JSON", exact: true }));
  await dialog.getByRole("tab", { name: "手动选择", exact: true }).click();
  const manualPicker = dialog.locator("[data-manual-operbox-picker]");
  await expect(manualPicker).toHaveAttribute("data-density", "compact");
  const manualHeading = manualPicker.getByRole("heading", { name: "手动选择干员 Box" });
  await expect(manualHeading).toBeVisible();
  await expect(manualHeading.locator("svg")).toHaveCount(0);
  const manualActions = manualPicker.locator("[data-manual-operbox-actions]");
  const manualActionButtons = [
    manualPicker.getByRole("button", { name: "只看已拥有", exact: true }),
    manualPicker.getByRole("button", { name: "全干员精二", exact: true }),
    manualPicker.getByRole("button", { name: "已拥有全精英", exact: true }),
    manualPicker.getByRole("button", { name: "清空选择", exact: true }),
  ];
  await expectSetupAction(manualActionButtons[0]);
  await expectSetupAction(manualActionButtons[1]);
  await expectSetupAction(manualActionButtons[2]);
  await expect(manualActionButtons[0]).toHaveAttribute("aria-pressed", "false");
  await manualActionButtons[0].click();
  await expect(manualActionButtons[0]).toHaveAttribute("aria-pressed", "true");
  await manualActionButtons[0].click();
  await expect(manualActionButtons[0]).toHaveAttribute("aria-pressed", "false");
  await expect(manualActions).toHaveCSS("display", "flex");
  await expect(manualActions).toHaveCSS("flex-wrap", "nowrap");
  const manualActionBoxes = await Promise.all(manualActionButtons.map((button) => button.boundingBox()));
  expect(new Set(manualActionBoxes.map((box) => Math.round(box?.y ?? -1))).size).toBe(1);
  const manualStageGroup = manualPicker.getByRole("radiogroup").first();
  await expect(manualStageGroup.locator('[role="radio"] span[aria-hidden="true"]')).toHaveCount(0);
  for (const status of [
    { name: "未拥有", color: "rgb(113, 113, 122)" },
    { name: "精0", color: "rgb(34, 187, 255)" },
    { name: "精1", color: "rgb(184, 240, 58)" },
    { name: "精2", color: "rgb(255, 216, 0)" },
  ]) {
    const stageButton = manualStageGroup.getByRole("radio", { name: status.name, exact: true });
    await stageButton.click();
    await expect(stageButton).toHaveAttribute("aria-checked", "true");
    await expect(stageButton).toHaveCSS("background-color", status.color);
    await expect(stageButton).toHaveCSS("height", "28px");
    await expect(stageButton).toHaveCSS("border-radius", "4px");
  }
  const stagesBeforeAllMaximum = await manualPicker.getByRole("radiogroup").evaluateAll((groups) => groups.map((group) => {
    const selected = group.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]');
    return [group.getAttribute("aria-label"), selected?.textContent?.trim() ?? null];
  }));
  const ownedSummaryBeforeAllMaximum = await manualPicker.getByText(/^已拥有 \d+ 名$/).textContent();
  await manualActionButtons[1].click();
  await expect(manualActionButtons[1]).toHaveAttribute("aria-pressed", "true");
  await expect(manualPicker.getByText(`已拥有 ${fullOperatorCount} 名`, { exact: true })).toBeVisible();
  await manualActionButtons[1].click();
  await expect(manualActionButtons[1]).toHaveAttribute("aria-pressed", "false");
  await expect(manualPicker.getByText(ownedSummaryBeforeAllMaximum ?? "", { exact: true })).toBeVisible();
  await expect.poll(() => manualPicker.getByRole("radiogroup").evaluateAll((groups) => groups.map((group) => {
    const selected = group.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]');
    return [group.getAttribute("aria-label"), selected?.textContent?.trim() ?? null];
  }))).toEqual(stagesBeforeAllMaximum);
  await manualActionButtons[1].click();
  const manualApplyButtons = manualPicker.locator("[data-manual-operbox-apply]");
  await expect(manualApplyButtons).toHaveCount(1);
  for (const manualApplyButton of await manualApplyButtons.all()) {
    await expect(manualApplyButton).toBeEnabled();
    await expectSetupAction(manualApplyButton);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(manualApplyButtons.first()).toHaveCSS("height", "44px");
  const narrowActionBoxes = await Promise.all(manualActionButtons.map((button) => button.boundingBox()));
  expect(new Set(narrowActionBoxes.map((box) => Math.round(box?.y ?? -1))).size).toBe(2);
  expect(narrowActionBoxes.every((box) => box !== null && box.x >= 0 && box.x + box.width <= 390), JSON.stringify(narrowActionBoxes)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await manualApplyButtons.first().click();
  await expect(manualPicker).toHaveCount(0);
  const layoutStepListBox = await stepList.boundingBox();
  expect(layoutStepListBox?.y ?? -1).toBeCloseTo(initialStepListBox?.y ?? -1, 0);
  const completedDataStep = dialog.getByRole("button", { name: /第 1 步，共 3 步：干员数据/ });
  await expect(completedDataStep.locator("svg")).toHaveCount(1);

  await dialog.getByText("高级工具", { exact: true }).click();
  const importLayoutButton = dialog.locator('[data-setup-action]').filter({ hasText: "导入布局" });
  await expectSetupAction(importLayoutButton);
  await expect(dialog.getByRole("button", { name: "导入布局", exact: true })).toHaveCount(1);
  await expectSetupAction(dialog.getByRole("button", { name: "导出布局", exact: true }));
  await importLayoutButton.click();
  const upload = page.locator("[data-file-upload-dialog]");
  await expect(upload).toHaveAccessibleName("导入布局");
  const fileChooserEvent = page.waitForEvent("filechooser");
  await upload.getByRole("button", { name: "选择文件", exact: true }).click();
  expect((await fileChooserEvent).isMultiple()).toBe(false);
  await upload.getByRole("button", { name: "取消", exact: true }).click();
  await expect(upload).toHaveCount(0);
  await expect(importLayoutButton).toBeFocused();

  const selectedPreset = dialog.getByRole("button", { name: /^243/ });
  await expect(selectedPreset).toHaveAttribute("aria-pressed", "true");
  await expect(selectedPreset).toHaveCSS("background-color", "rgb(48, 48, 39)");
  await expect(selectedPreset).toHaveCSS("box-shadow", "none");
  const presetColumns = await dialog
    .getByRole("group", { name: "布局预设" })
    .evaluate((element) => getComputedStyle(element).gridTemplateColumns);
  expect(presetColumns.split(" ").filter(Boolean)).toHaveLength(5);

  const rotationTrigger = dialog.getByRole("combobox", { name: "换班方式" });
  await rotationTrigger.click();
  await waitForOwnAnimations(page.locator('[data-slot="combobox-content"]'));
  const [triggerBox, popupBox] = await Promise.all([
    rotationTrigger.locator("xpath=..").boundingBox(),
    page.locator('[data-slot="combobox-content"]').boundingBox(),
  ]);
  expect(triggerBox).not.toBeNull();
  expect(popupBox).not.toBeNull();
  expect(Math.abs((triggerBox?.x ?? 0) - (popupBox?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(popupBox?.width).toBeCloseTo(triggerBox?.width ?? 0, 0);
  await expect(dialog.locator('[data-slot="select-trigger"]')).toHaveCount(0);
  await expect(page.getByRole("option", { name: /自动轮换/ })).toHaveCount(0);
  await expect(page.getByRole("option", { name: /一天两换/ })).toHaveCount(1);
  await expect(page.getByRole("option", { name: /自定义/ })).toHaveCount(0);
  await expect(page.getByRole("option")).toHaveCount(3);
  await expect(rotationTrigger).toHaveJSProperty("readOnly", true);
  await page.getByRole("option", { name: /一天两换/ }).click();
  await expect(rotationTrigger).toHaveValue("一天两换 · 12/12/12");
  await rotationTrigger.click();
  await expect(page.locator('[data-slot="combobox-content"]')).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(3);
  await rotationTrigger.press("Escape");
  await expect(rotationTrigger).toHaveValue("一天两换 · 12/12/12");
  await expect(dialog.getByText("完整循环 24 小时")).toHaveCount(0);
  await expect(dialog.getByText("第 4 班 4h")).toHaveCount(0);
  await dialog.getByRole("button", { name: "检查设施", exact: true }).click();
  await dialog.getByRole("button", { name: "完成", exact: true }).click();

  await page.getByRole("button", { name: "生成排班" }).click();
  await expect.poll(() => planRequests).toBe(1);
  expect(requestedRotation).toBe("abc_12_12_12");
  expect(requestedSourceName).toBe("手动选择的 Box");
  expect(requestedBoxSource).toBe("maa");
  expect(Array.isArray(requestedOperbox)).toBe(true);
  expect(requestedOperbox).toHaveLength(fullOperatorCount);
  expect(new Set((requestedOperbox as Array<{ id: string }>).map((operator) => operator.id)).size).toBe(fullOperatorCount);
  expect((requestedOperbox as Array<{ own: boolean }>).every((operator) => operator.own)).toBe(true);
  const persisted = await page.evaluate(() => JSON.parse(
    window.localStorage.getItem("arknights-infra-calc-session-v5") ?? "{}"
  ));
  expect(persisted.rotationProfile).toBe("abc_12_12_12");
  expect(persisted.sourceName).toBe("手动选择的 Box");
  expect(persisted.boxSource).toBe("maa");
  expect(persisted.operbox).toHaveLength(fullOperatorCount);
});

test("layout level steppers respect bounds and expose the power-safe 342 defaults", async ({ page }) => {
  await mockApis(page);
  await seedV4Session(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");

  await page.getByRole("button", { name: "配置Box与布局" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "继续", exact: true }).click();

  await dialog.getByRole("button", { name: /^342/ }).click();
  await expect(dialog.getByRole("button", { name: "检查设施", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "检查设施", exact: true }).click();

  const tradeGroup = dialog.locator('[data-facility-group="trade"]');
  const factoryGroup = dialog.locator('[data-facility-group="factory"]');
  const functionGroup = dialog.locator('[data-facility-group="function"]');
  await expect(tradeGroup.locator('[data-slot="accordion-trigger"]')).toHaveAttribute("aria-expanded", "true");
  await expect(factoryGroup.locator('[data-slot="accordion-trigger"]')).toHaveAttribute("aria-expanded", "true");
  await expect(functionGroup.locator('[data-slot="accordion-trigger"]')).toHaveAttribute("aria-expanded", "false");

  await functionGroup.locator('[data-slot="accordion-trigger"]').click();
  const controlLevel = dialog.locator('output[aria-label="control 等级"]');
  await expect(controlLevel).toHaveText("5");
  await expect(dialog.getByRole("button", { name: "control 等级加一" })).toBeDisabled();
  await dialog.getByRole("button", { name: "control 等级减一" }).click();
  await expect(controlLevel).toHaveText("4");
  for (let count = 0; count < 3; count++) await dialog.getByRole("button", { name: "control 等级减一" }).click();
  await expect(controlLevel).toHaveText("1");
  await expect(dialog.getByRole("button", { name: "control 等级减一" })).toBeDisabled();
  for (let count = 0; count < 4; count++) await dialog.getByRole("button", { name: "control 等级加一" }).click();
  await expect(controlLevel).toHaveText("5");
  await expect(dialog.getByRole("button", { name: "control 等级加一" })).toBeDisabled();

  await dialog.locator('[data-facility-group="power"] [data-slot="accordion-trigger"]').click();
  await dialog.locator('[data-facility-group="dormitory"] [data-slot="accordion-trigger"]').click();
  if (await tradeGroup.locator('[data-slot="accordion-trigger"]').getAttribute("aria-expanded") !== "true") {
    await tradeGroup.locator('[data-slot="accordion-trigger"]').click();
  }
  if (await factoryGroup.locator('[data-slot="accordion-trigger"]').getAttribute("aria-expanded") !== "true") {
    await factoryGroup.locator('[data-slot="accordion-trigger"]').click();
  }
  const activeTradeOrder = dialog.getByRole("group", { name: "贸易站 1 订单" }).getByRole("button", { name: "龙门商法" });
  await expect(activeTradeOrder).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.locator('[data-slot="setup-room-row"]')).toHaveCount(18);
  await expect(dialog.locator('[data-slot="setup-room-row"][data-room-group="trading"]')).toHaveCount(3);
  await expect(dialog.locator('[data-slot="setup-room-row"][data-room-group="manufacture"]')).toHaveCount(4);
  await expect(dialog.locator('[data-slot="setup-room-row"][data-room-group="power"]')).toHaveCount(2);
  await expect(dialog.locator('output[aria-label="trade_2 等级"]')).toHaveText("2");
  await expect(dialog.locator('output[aria-label="dorm_1 等级"]')).toHaveText("2");
  const normalPowerStatus = dialog.getByText("电力正常 · 540/540", { exact: true });
  await expect(normalPowerStatus).toBeVisible();
  await expect(normalPowerStatus).toHaveClass(/text-emerald-700/);

  const lowerFactoryRecipe = dialog.getByRole("group", { name: "制造站 3 配方" });
  await lowerFactoryRecipe.getByRole("button", { name: "源石碎片" }).click();
  await expect(lowerFactoryRecipe.getByRole("button", { name: "源石碎片" })).toHaveAttribute("aria-pressed", "true");
  for (const roomId of ["manu_1", "manu_2"]) {
    await dialog.getByRole("button", { name: `${roomId} 等级减一` }).click();
    await expect(dialog.locator(`output[aria-label="${roomId} 等级"]`)).toHaveText("2");
  }
  await expect(lowerFactoryRecipe.getByRole("button", { name: "贵金属" })).toHaveAttribute("aria-pressed", "true");
  await expect(lowerFactoryRecipe.getByRole("button", { name: "源石碎片" })).toBeDisabled();

  await page.setViewportSize({ width: 768, height: 900 });
  const mediumOverflow = await dialog.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(mediumOverflow.scrollWidth).toBeLessThanOrEqual(mediumOverflow.clientWidth);

  await page.setViewportSize({ width: 390, height: 844 });
  await waitForOwnAnimations(dialog);
  const footerBox = await dialog.locator("[data-setup-footer]").boundingBox();
  expect(footerBox?.height ?? Infinity).toBeLessThanOrEqual(68);
  expect((footerBox?.y ?? Infinity) + (footerBox?.height ?? Infinity)).toBeLessThanOrEqual(844);
  expect(await activeTradeOrder.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  const mobileTradeLevel = dialog.getByRole("group", { name: "trade_2 等级", exact: true });
  const decreaseTradeLevel = mobileTradeLevel.getByRole("button", { name: "trade_2 等级减一" });
  await decreaseTradeLevel.scrollIntoViewIfNeeded();
  expect(await decreaseTradeLevel.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  expect(await mobileTradeLevel.locator('[data-setup-stepper]').evaluate(element => element.getBoundingClientRect().width)).toBeLessThan(120);
  await decreaseTradeLevel.click();
  await expect(mobileTradeLevel.locator("output")).toHaveText("1");
  await expect(decreaseTradeLevel).toBeDisabled();
});

test("training recommendation shows readable promotion and current elite stages", async ({ page }, testInfo) => {
  await mockApis(page);
  await seedV4Session(page, {
    ...planData,
    profile: { ...profile, actions: [{
      priority: "中", kind: "promote_tier_up", operator: "阿米娅", domain_id: "general",
      message: "将「阿米娅」升至 tier_up（需精2）——参考组合成员，现5★精0 1级",
      current_elite: 0, tier_up_requirement: "精2",
    }] },
  });
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "zh", url: testInfo.project.use.baseURL! }]);
  await page.goto("/training");
  const card = page.locator('[data-recommendation-card="full"]');
  await expect(card).toContainText("升至精二");
  await expect(card).toContainText("目前精零 1级（5★）");
  await expect(card).toContainText("目前精零 · 目标精二");
  await expect(card).not.toContainText("tier_up");
  await card.screenshot({ path: testInfo.outputPath("promotion-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card).toBeVisible();
  expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await card.screenshot({ path: testInfo.outputPath("promotion-mobile.png") });
});

test("calculator owns scheduling controls and training advice uses a single technical stream", async ({ page }) => {
  const adviceResult = {
    ...planData,
    profile: {
      ...profile,
      actions: [
        {
          priority: "高",
          kind: "promote",
          operator: "清流",
          domain_id: "manufacture",
          message: "优先完成精英化与技能等级，补齐制造站轮换深度。",
          current_elite: 0,
          tier_up_requirement: "精1",
        },
        {
          priority: "中",
          kind: "advice",
          operator: "凯尔希",
          domain_id: "power",
          message: "保留发电站轮换位，避免高心情干员长期空转。",
        },
      ],
    },
  };
  await mockApis(page);
  await seedV4Session(page, adviceResult);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  await page.getByRole("button", { name: "中文", exact: true }).click();

  const calculatorControls = page.locator("[data-calculator-controls]");
  await expect(calculatorControls).toBeVisible();
  const exportMaa = page.getByRole("button", { name: "导出到 MAA" });
  await expect(exportMaa).toHaveCSS("height", "28px");
  const controlOrder = await calculatorControls.locator("button").allTextContents();
  expect(controlOrder.at(-1)).toContain("生成排班");
  expect(controlOrder.some((label) => label.includes("全角色导入"))).toBe(false);
  await expect(page.locator("[data-calculator-export-actions]").getByRole("button", { name: "导出图片", includeHidden: true })).toHaveCount(2);
  const exportOrder = await page.locator("[data-calculator-export-actions]").locator("button").allTextContents();
  expect(exportOrder).toEqual([
    expect.stringContaining("调整方案"),
    expect.stringContaining("导出到 MAA"),
    expect.stringContaining("导出图片"),
    expect.stringContaining("修改练度并重算"),
    expect.stringContaining("基于当前方案编辑"),
    expect.stringContaining("导出到 MAA"),
    expect.stringContaining("导出图片"),
  ]);

  await page.getByRole("button", { name: "练卡建议" }).click();
  await expect(calculatorControls).toHaveCount(0);
  await expect(page.getByText("这里只展示求解器给出的结构化建议", { exact: false })).toHaveCount(0);
  await expect(page.locator('[data-slot="training-summary"]')).toHaveClass(/infra-room-surface/);
  await expect(page.locator('[data-slot="training-data-check"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="training-summary"] svg')).toHaveCount(1);
  await expect(page.locator('[data-slot^="training-"] .infra-room-emblem')).toHaveCount(0);
  const adviceCards = page.locator('[data-slot="training-advice-card"]');
  await expect(adviceCards).toHaveCount(2);
  await expect(adviceCards.locator("svg")).toHaveCount(0);
  const advicePortrait = adviceCards.locator('img[src^="/images/operator-portraits/"]').first();
  await expect(advicePortrait).toHaveAttribute("width", "80");
  await expect(advicePortrait).toHaveAttribute("height", "80");
  await expect(advicePortrait).toHaveAttribute("loading", "lazy");
  await expect(advicePortrait).toHaveAttribute("decoding", "async");
  await advicePortrait.hover();
  const adviceSkillTooltip = page.locator('[data-slot="tooltip-content"]').filter({ hasText: "再生能源" });
  await expect(adviceSkillTooltip).toBeVisible();
  await expect(adviceSkillTooltip).toContainText("干员基建技能 · 已标出本次目标");
  await expect(adviceSkillTooltip).toContainText("本次目标");
  await page.keyboard.press("Escape");
  await expect(adviceSkillTooltip).toBeHidden();
  const adviceSkillTrigger = adviceCards.first().locator('[tabindex="0"]').first();
  await adviceSkillTrigger.click();
  await expect(adviceSkillTooltip).toBeVisible();
  const cardBoxes = await adviceCards.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, top: box.top, width: box.width };
  }));
  expect(cardBoxes[0].left).toBeCloseTo(cardBoxes[1].left, 0);
  expect(cardBoxes[0].width).toBeCloseTo(cardBoxes[1].width, 0);
  expect(cardBoxes[1].top).toBeGreaterThan(cardBoxes[0].top);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await page.getByRole("button", { name: "基建计算器" }).click();
  const mobileHeights = await Promise.all([
    page.locator('[data-calculator-export-actions="mobile"]').getByRole("button", { name: "导出到 MAA" }).evaluate((element) => element.getBoundingClientRect().height),
    page.getByRole("button", { name: "生成排班" }).evaluate((element) => element.getBoundingClientRect().height),
  ]);
  expect(Math.min(...mobileHeights)).toBeGreaterThanOrEqual(44 - 0.01);
});

test("schedule visuals use a stable technical canvas and responsive level markers", async ({ page }) => {
  await mockApis(page);
  await seedV4Session(page, scheduleVisualPlanData, { boxSource: "maa" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const canvas = page.locator("[data-infra-canvas]");
  const roomSurface = page.locator(".infra-room-surface").first();
  const listDiamonds = page.locator('.level-diamonds[data-variant="list"]').first();
  const listViewTab = page.getByRole("tab", { name: "列表式布局" });
  const compactViewTab = page.getByRole("tab", { name: "一图流布局" });

  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await expect(roomSurface).toBeVisible();
  await expect(compactViewTab).toHaveAttribute("aria-selected", "true");
  await listViewTab.click();
  await expect(listViewTab).toHaveAttribute("aria-selected", "true");
  await expect(listDiamonds).toBeVisible();

  const buildingSkillBadge = page.getByRole("button", { name: /基建技能 S1：合作协议/ }).first();
  await expect(buildingSkillBadge).toBeVisible();
  await buildingSkillBadge.focus();
  await expect(page.getByText("S1 · 合作协议").first()).toBeVisible();
  await expect(page.getByText(/所有贸易站订单效率\+7%/).first()).toBeVisible();
  await expect(page.getByLabel("基建技能 S99，暂无技能资料").first()).toBeVisible();
  await expect.poll(() => page.locator('img[src^="/images/building-skills/"]').first().evaluate(
    (image) => (image as HTMLImageElement).naturalWidth
  )).toBe(36);
  const operatorPortrait = page.locator('img[src^="/images/operator-portraits/"]').first();
  await expect(operatorPortrait).toHaveAttribute("src", /\.webp\?v=\d+-[0-9a-f]{12}$/);
  await expect(operatorPortrait).toHaveAttribute("width", "180");
  await expect(operatorPortrait).toHaveAttribute("height", "180");
  await expect(operatorPortrait).toHaveAttribute("loading", "lazy");
  await expect(operatorPortrait).toHaveAttribute("decoding", "async");

  const visualStyles = await page.evaluate(() => {
    const room = document.querySelector<HTMLElement>(".infra-room-surface");
    if (!room) throw new Error("Missing room surface");
    const surface = getComputedStyle(room);
    const mesh = getComputedStyle(room, "::before");
    const emblem = room.querySelector<HTMLElement>(".infra-room-emblem");
    if (!emblem) throw new Error("Missing room emblem");
    const emblemStyle = getComputedStyle(emblem);
    return {
      bodyFont: getComputedStyle(document.body).fontFamily,
      backdropFilter: surface.backdropFilter
        || (surface as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter,
      surfaceBackground: surface.backgroundColor,
      meshMask: mesh.maskImage || mesh.webkitMaskImage,
      emblemImage: emblemStyle.backgroundImage,
      emblemBackgroundSize: emblemStyle.backgroundSize,
      emblemOpacity: emblemStyle.opacity,
      emblemFilter: emblemStyle.filter,
      emblemBlendMode: emblemStyle.mixBlendMode,
    };
  });
  expect(visualStyles.bodyFont).toContain("Microsoft YaHei");
  expect(visualStyles.bodyFont).toContain("PingFang SC");
  expect(visualStyles.bodyFont).not.toContain("Segoe UI");
  expect(visualStyles.backdropFilter).toBe("none");
  expect(visualStyles.surfaceBackground).toBe("rgb(39, 42, 43)");
  expect(visualStyles.meshMask).toContain("facility-grid.svg");
  expect(visualStyles.emblemImage).toContain("building-room-emblems/emblem_");
  expect(visualStyles.emblemImage).toContain(".png");
  expect(visualStyles.emblemBackgroundSize).toBe("auto 100%");
  expect(visualStyles.emblemOpacity).toBe("0.16");
  expect(visualStyles.emblemFilter).toBe("none");
  expect(visualStyles.emblemBlendMode).toBe("normal");

  const listBox = await listDiamonds.boundingBox();
  expect(listBox?.height).toBeCloseTo(20, 0);
  const listDiamondBox = await listDiamonds.locator(".level-diamond").first().boundingBox();
  expect(listDiamondBox?.width).toBeCloseTo(10, 0);

  await compactViewTab.click();
  const compactDiamonds = page.locator('.level-diamonds[data-variant="compact"]').first();
  await expect(compactDiamonds).toBeVisible();
  const compactProductBadge = page.locator("[data-compact-product-badge]").first();
  const compactFeedbackButton = page.getByRole("button", { name: /反馈排班问题/ }).first();
  await expect(compactProductBadge).toBeVisible();
  await expect(compactFeedbackButton).toBeVisible();
  const [compactProductBox, compactFeedbackBox] = await Promise.all([
    compactProductBadge.boundingBox(),
    compactFeedbackButton.boundingBox(),
  ]);
  expect(compactProductBox).not.toBeNull();
  expect(compactFeedbackBox).not.toBeNull();
  expect((compactProductBox?.x ?? 0) + (compactProductBox?.width ?? 0)).toBeLessThanOrEqual((compactFeedbackBox?.x ?? 0) - 8);
  await compactFeedbackButton.click();
  const compactFeedbackDialog = page.getByRole("dialog");
  await expect(compactFeedbackDialog).toBeVisible();
  await expect(compactFeedbackDialog.getByText("反馈排班问题", { exact: true })).toBeVisible();
  await compactFeedbackDialog.getByRole("button", { name: "取消" }).click();
  await expect(compactFeedbackDialog).toHaveCount(0);
  const compactBox = await compactDiamonds.boundingBox();
  expect(compactBox?.height).toBeCloseTo(14, 0);
  const compactDiamondBox = await compactDiamonds.locator(".level-diamond").first().boundingBox();
  expect(compactDiamondBox?.width).toBeCloseTo(7.5, 0);

  await listViewTab.click();
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(compactViewTab).toHaveCount(0);
  await expect(listViewTab).toHaveCount(0);
  await expect(page.locator('[data-schedule-view="list"]')).toBeVisible();
  const tabletOperatorGrid = page.locator(".infra-list-operator-grid").first();
  await expect(tabletOperatorGrid).toBeVisible();
  const tabletGridSize = await tabletOperatorGrid.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(tabletGridSize.scrollWidth).toBeLessThanOrEqual(tabletGridSize.clientWidth);
  const tabletTradeRoom = page.locator('[data-room-group="trading"]').first();
  const tabletTradeLayout = await tabletTradeRoom.evaluate((element) => ({
    flexDirection: getComputedStyle(element).flexDirection,
  }));
  expect(tabletTradeLayout.flexDirection).toBe("column");
  const tabletTradeSections = tabletTradeRoom.locator(":scope > div");
  const tabletTradeSummaryBox = await tabletTradeSections.nth(0).boundingBox();
  const tabletTradeOccupancyBox = await tabletTradeSections.nth(1).boundingBox();
  expect(tabletTradeSummaryBox).not.toBeNull();
  expect(tabletTradeOccupancyBox).not.toBeNull();
  expect(tabletTradeOccupancyBox!.y).toBeGreaterThanOrEqual(
    tabletTradeSummaryBox!.y + tabletTradeSummaryBox!.height - 1.5
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(compactViewTab).toHaveCount(0);
  await expect(listViewTab).toHaveCount(0);
  const mobileDiamonds = page.locator('.level-diamonds[data-variant="list"]').first();
  await expect(mobileDiamonds).toBeVisible();
  const mobileBox = await mobileDiamonds.boundingBox();
  expect(mobileBox?.height).toBeCloseTo(16, 0);
  const mobileDiamondBox = await mobileDiamonds.locator(".level-diamond").first().boundingBox();
  expect(mobileDiamondBox?.width).toBeCloseTo(8, 0);
  const mobileSkillBox = await buildingSkillBadge.boundingBox();
  expect(mobileSkillBox?.width).toBeGreaterThanOrEqual(44);
  expect(mobileSkillBox?.height).toBeGreaterThanOrEqual(44);
});

test("self-hosts Bender Bold for technical numbers while preserving UI-font exceptions", async ({ page }) => {
  await mockApis(page, {
    sklandConfigured: true,
    sklandSnapshot: authenticatedSklandSnapshot,
  });
  await seedV4Session(page, scheduleVisualPlanData);
  const fontRequests: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "font") fontRequests.push(request.url());
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.locator("[data-infra-canvas]")).toBeVisible({ timeout: 15_000 });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    await expectVisibleNumbersUseNumberFont(page);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth, JSON.stringify({ viewport, dimensions })).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  }

  await page.getByRole("button", { name: "配置Box与布局" }).first().click();
  const setupDialog = page.getByRole("dialog");
  await expect(setupDialog).toBeVisible();
  await expectVisibleNumbersUseNumberFont(page, setupDialog);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "练卡建议" }).click();
  await expect(page.getByRole("heading", { name: "训练建议" })).toBeVisible();
  await expectVisibleNumbersUseNumberFont(page);

  await openSklandOverview(page);
  await expect(page.getByRole("heading", { name: "测试博士" }).first()).toBeVisible();
  await expectVisibleNumbersUseNumberFont(page);
  await page.getByRole("tab", { name: "基建", exact: true }).click();
  await expectVisibleNumbersUseNumberFont(page);

  for (const path of ["/privacy", "/terms"]) {
    await gotoStable(page, path);
    await expectVisibleNumbersUseNumberFont(page);
  }

  const loadedFontResources = await page.evaluate(() => performance.getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((url) => /\.(?:otf|woff2?)(?:\?|$)/i.test(url)));
  const allFontUrls = [...new Set([...fontRequests, ...loadedFontResources])];
  expect(allFontUrls.some((url) => /\.otf(?:\?|$)/i.test(url))).toBe(true);
  expect(allFontUrls.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  expect(allFontUrls.join("\n")).not.toMatch(/1001fonts|fonts2u|fontsquirrel|hypergryph/i);
});

test("publishes the site terms and privacy policy with upstream policy links", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoStable(page, "/privacy");
  await expect(page.getByRole("heading", { name: "隐私政策", level: 1 })).toBeVisible();
  await expect(page.getByText("版本与生效日期：2026-09-06")).toBeVisible();
  await expect(page.getByText(/服务端 CLI 运行记录和主动反馈的私有复现快照最多保存 30 天/)).toBeVisible();
  await expect(page.getByText(/提交的干员 Box、轮换设置、轮换次数、菲亚梅塔启用状态/)).toBeVisible();
  await expect(page.getByText(/第一方体验分析会自动记录/)).toBeVisible();
  await expect(page.getByText(/30 天到期/)).toBeVisible();
  await expect(page.getByText("可露希尔基建终端项目维护者", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "森空岛使用许可及服务协议" })).toHaveAttribute(
    "href",
    "https://assets.skland.com/protocols/agreement.html"
  );
  await expect(page.getByRole("link", { name: "森空岛个人信息保护政策" })).toHaveAttribute(
    "href",
    "https://assets.skland.com/protocols/privacy.html"
  );

  await gotoStable(page, "/terms");
  await expect(page.getByRole("heading", { name: "服务条款", level: 1 })).toBeVisible();
  await expect(page.getByText("版本与生效日期：2026-09-06")).toBeVisible();
  await expect(page.locator('a[href="https://space.bilibili.com/3707051935009359"]').first()).toBeVisible();
  await expect(page.getByText(/非官方、非商业工具/)).toBeVisible();
});

test("automatic first-party telemetry sends only the disclosed browser whitelist", async ({ page }) => {
  const telemetryBatches: Array<Array<Record<string, unknown>>> = [];
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: () => false,
    });
  });
  await mockApis(page, { telemetryBatches });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("arknights-infra-telemetry-session"))).not.toBeNull();
  await page.getByRole("button", { name: "练卡建议", exact: true }).click();
  await expect(page).toHaveURL(/\/training$/);
  await expect(page.locator("[data-training-page]")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(() => telemetryBatches.flat().some((event) => (
    event.name === "page_view" && event.page === "/training"
  ))).toBe(true);

  const events = telemetryBatches.flat();
  const allowedKeys = new Set(["sessionId", "type", "name", "durationMs", "value", "page", "meta"]);
  for (const event of events) {
    expect(Object.keys(event).every((key) => allowedKeys.has(key))).toBe(true);
    expect(event).not.toHaveProperty("createdAt");
    expect(event).not.toHaveProperty("userId");
    expect(event).not.toHaveProperty("dataOwnerTag");
  }
  expect(events.some((event) => event.name === "device_info")).toBe(true);
  expect(events).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "page_view", page: "/" }),
    expect.objectContaining({ name: "page_view", page: "/training" }),
  ]));
  expect(new Set(events.map((event) => event.sessionId)).size).toBe(1);
});

test("telemetry mock accepts a bodyless browser delivery", async ({ page }) => {
  const telemetryBatches: Array<Array<Record<string, unknown>>> = [];
  await mockApis(page, { telemetryBatches });
  await page.goto("/");

  const responseStatus = await page.evaluate(async () => {
    const response = await fetch("/api/telemetry", { method: "POST" });
    return response.status;
  });

  expect(responseStatus).toBe(200);
  expect(telemetryBatches).toContainEqual([]);
});
