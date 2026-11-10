import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { mockApis, seedV4Session } from "./production-readiness.fixture";

const autoResult = {
  mode: "auto", hours: [32, 32], complete: false,
  rooms: [{ roomId: "manu_1", kind: "factory",
    main: { operators: ["阿米娅"], evaluationHours: 32, missingSeats: 0, complete: true, productionEfficiency: 1.25 },
    backup: { operators: [], evaluationHours: 32, missingSeats: 3, complete: false },
  }], dormSupport: [], fiammetta: null, warnings: ["替补干员不足"], durationMs: 123, diagnosticId: "auto-test",
};

async function openRotation(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page.locator("[data-calculator-more-tools] > summary").click();
  }
  await page.getByRole("button", { name: "配置Box与布局" }).first().click();
  const dialog = page.locator("[data-setup-dialog]");
  await dialog.getByRole("button", { name: "继续", exact: true }).click();
  await dialog.getByRole("combobox", { name: "换班方式" }).click();
  return dialog;
}

async function finishSetup(page: Page) {
  const dialog = page.locator("[data-setup-dialog]");
  await dialog.getByRole("button", { name: /^(检查设施|继续)$/, exact: true }).click();
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
}

async function leaveAndReturnToCalculator(page: Page) {
  await page.locator('[data-primary-navigation-page="recruitment"]').click();
  await expect(page).toHaveURL(/\/recruitment$/);
  await page.locator('[data-primary-navigation-page="calculator"]').click();
  await expect(page.locator("[data-auto-rotation-result]")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await mockApis(page);
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: {
    session: { id: "auto-session", token: "auto-token", userId: "auto-user", expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
    user: { id: "auto-user", name: "测试用户", email: "auto@example.com", emailVerified: true },
  } }));
  await seedV4Session(page);
  await page.goto("/");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible({ timeout: 15_000 });
});

test("rotation menu is ordered and automatic rotation submits fixed hours and reuses the shared schedule board", async ({ page }) => {
  let body: Record<string, unknown> | undefined;
  await page.route("**/api/auto-rotation", async (route) => {
    body = route.request().postDataJSON();
    await route.fulfill({ json: { success: true, data: autoResult, requestId: "auto-request" } });
  });
  const dialog = await openRotation(page);
  await expect(page.getByRole("option")).toHaveText([
    "一天两换三班倒 12/12/12", "一天三换三班倒 12/6/6", "主备两班轮换 24/24", "自动队列轮换", "自定义时长",
  ]);
  await page.screenshot({ path: test.info().outputPath("rotation-menu.png") });
  await page.getByRole("option", { name: "自动队列轮换", exact: true }).click();
  await expect(dialog.locator("[data-rotation-auto] input")).toHaveCount(0);
  await finishSetup(page);
  const empty = page.locator("[data-auto-rotation-empty]");
  await expect(empty).toBeVisible();
  await expect(empty.locator('[data-plan-board]')).toBeVisible();
  await empty.getByRole("tab", { name: "替补队列", exact: true }).click();
  await expect(empty.locator('[data-room-title="制造站 1"] [data-operator-identity="empty"]')).toHaveCount(3);
  await expect(empty.getByRole("button", { name: "导出图片", exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("auto-rotation-empty.png") });
  await page.getByRole("button", { name: "生成排班", exact: true }).click();
  const result = page.locator("[data-auto-rotation-result]");
  await expect(result).toBeVisible();
  expect(body?.hours).toEqual([32, 32]);
  expect(body?.boxSource).toBe("sample");
  expect(body).not.toHaveProperty("operbox");
  expect(body).not.toHaveProperty("supportCombinationsEnable");
  await expect(result.locator('[data-plan-board]')).toBeVisible();
  const compact = result.locator('[data-compact-schedule-view]');
  await expect(compact).toBeVisible();
  await expect(compact.locator('[data-room-title="制造站 1"] [data-room-primary-efficiency]')).toHaveText("125%");
  await expect(compact.locator('[data-room-title="制造站 1"] [data-operator-identity="阿米娅"]')).toBeVisible();
  await result.getByRole("tab", { name: "列表式布局", exact: true }).click();
  await expect(result.locator('[data-schedule-view="list"]')).toBeVisible();
  await result.getByRole("tab", { name: "替补队列", exact: true }).click();
  await expect(result.getByText(/制造站 1 · 配置未完成，缺位 3/)).toBeVisible();
  await result.getByRole("tab", { name: "主力队列", exact: true }).click();
  await expect(result.getByText(/制造站 1 · 配置未完成，缺位 3/)).toHaveCount(0);
  await expect(result.getByText("替补干员不足", { exact: true })).toBeVisible();
  for (const queue of ["main", "backup"] as const) {
    await result.getByRole("tab", { name: queue === "main" ? "主力队列" : "替补队列", exact: true }).click();
    const pendingDownload = page.waitForEvent("download");
    await result.getByRole("button", { name: "导出图片", exact: true }).click();
    const download = await pendingDownload;
    expect(download.suggestedFilename()).toBe(`arknights-infra-auto-queue-${queue}.png`);
    const image = await readFile((await download.path())!);
    expect([...image.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  }
  await page.screenshot({ path: test.info().outputPath("auto-rotation-result.png") });
  await expect(page.getByRole("button", { name: /导出.*MAA|下载.*MAA/ })).toHaveCount(0);

  await page.reload();
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  await openRotation(page);
  await page.getByRole("combobox", { name: "换班方式" }).press("Escape");
  await expect(page.getByRole("combobox", { name: "换班方式" })).toHaveValue("自动队列轮换");
  await expect(page.locator("[data-rotation-auto] input")).toHaveCount(0);
  await expect(page.locator("[data-auto-rotation-result]")).toHaveCount(0);
  await expect(page.locator("[data-auto-rotation-empty] [data-plan-board]")).toBeVisible();
});

for (const cancel of ["button", "escape"] as const) test(`cancelling automatic rotation with ${cancel} prevents a late response from restoring a result`, async ({ page }) => {
  let releaseResponse: (() => void) | undefined;
  await page.route("**/api/auto-rotation", async (route) => {
    await new Promise<void>((resolve) => { releaseResponse = resolve; });
    await route.fulfill({ json: { success: true, data: autoResult, requestId: "late" } }).catch(() => undefined);
  });
  await openRotation(page);
  await page.getByRole("option", { name: "自动队列轮换", exact: true }).click();
  await finishSetup(page);
  await page.getByRole("button", { name: "生成排班", exact: true }).click();
  await expect.poll(() => Boolean(releaseResponse)).toBe(true);
  if (cancel === "escape") await page.keyboard.press("Escape");
  else {
    await page.getByRole("button", { name: /取消任务/ }).click();
    const confirmation = page.getByRole("dialog");
    await confirmation.getByRole("button", { name: /确认取消/ }).click();
  }
  releaseResponse?.();
  await expect(page.getByRole("button", { name: "生成排班", exact: true })).toBeEnabled();
  await expect(page.locator("[data-auto-rotation-result]")).toHaveCount(0);
  await expect(page.locator("[data-auto-rotation-empty] [data-plan-board]")).toBeVisible();
});

test("automatic rotation keeps the default facility structure while computing and after failure", async ({ page }) => {
  let releaseResponse: (() => void) | undefined;
  await page.route("**/api/auto-rotation", async route => {
    await new Promise<void>(resolve => { releaseResponse = resolve; });
    await route.fulfill({ status: 500, json: { success: false, error: { code: "AIC-PLAN-3001", summary: "测试求解失败" } } });
  });
  await openRotation(page);
  await page.getByRole("option", { name: "自动队列轮换", exact: true }).click();
  await finishSetup(page);
  const empty = page.locator("[data-auto-rotation-empty]");
  await expect(empty.locator('[data-plan-board]')).toBeVisible();
  await page.getByRole("button", { name: "生成排班", exact: true }).click();
  await expect(empty).toHaveAttribute("aria-busy", "true");
  await expect(empty.locator('[data-room-title="制造站 1"]')).toBeVisible();
  await expect.poll(() => Boolean(releaseResponse)).toBe(true);
  releaseResponse?.();
  await expect(empty).toHaveAttribute("aria-busy", "false");
  await expect(empty.locator('[data-plan-board]')).toBeVisible();
  await expect(page.locator("[data-auto-rotation-result]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "生成排班", exact: true })).toBeEnabled();
});

test("switching rotation modes clears automatic results", async ({ page }) => {
  await page.route("**/api/auto-rotation", (route) => route.fulfill({ json: { success: true, data: autoResult, requestId: "switch" } }));
  const dialog = await openRotation(page);
  await page.getByRole("option", { name: "自动队列轮换", exact: true }).click();
  await expect(dialog.locator("[data-rotation-auto] input")).toHaveCount(0);
  await finishSetup(page);
  await page.getByRole("button", { name: "生成排班", exact: true }).click();
  await expect(page.locator("[data-auto-rotation-result]")).toBeVisible();
  await openRotation(page);
  await page.getByRole("option", { name: "一天两换三班倒 12/12/12", exact: true }).click();
  await finishSetup(page);
  await expect(page.locator("[data-auto-rotation-result]")).toHaveCount(0);
  await openRotation(page);
  await page.getByRole("option", { name: "自动队列轮换", exact: true }).click();
  await finishSetup(page);
  await expect(page.locator("[data-auto-rotation-result]")).toHaveCount(0);
});

test("legacy automatic durations use fixed defaults and explain fallback without claiming missing seats", async ({ page }) => {
  let body: Record<string, unknown> | undefined;
  await page.route("**/api/auto-rotation", async route => {
    body = route.request().postDataJSON();
    await route.fulfill({ json: { success: true, data: {
      ...autoResult, complete: true,
      rooms: [{ ...autoResult.rooms[0], backup: autoResult.rooms[0].main }],
      warnings: ["可用干员太少，部分设施无法使用有技能的干员，已使用 Fallback 随机补位。"],
    }, requestId: "legacy" } });
  });
  await page.evaluate(() => {
    const key = "arknights-infra-calc-session-v5";
    const session = JSON.parse(localStorage.getItem(key)!);
    session.rotationSelection = "auto_24_12.5";
    localStorage.setItem(key, JSON.stringify(session));
  });
  await page.reload();
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  await page.getByRole("button", { name: "生成排班", exact: true }).click();
  const result = page.locator("[data-auto-rotation-result]");
  await expect(result).toBeVisible();
  expect(body?.hours).toEqual([32, 32]);
  await expect(result.getByRole("status")).toHaveText("主力与替补配置完整。");
  await expect(result.getByText(/补位干员不保证具备对应设施技能/)).toBeVisible();
  await expect(result.getByText(/可用干员太少/)).toHaveCount(0);
});

test("mobile automatic queues use the shared list and keep queue controls accessible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/auto-rotation", route => route.fulfill({ json: { success: true, data: autoResult, requestId: "mobile" } }));
  await openRotation(page);
  await page.getByRole("option", { name: "自动队列轮换", exact: true }).click();
  await finishSetup(page);
  await page.getByRole("button", { name: "知道了", exact: true }).click();
  await expect(page.locator('[data-auto-rotation-empty] [data-schedule-view="list"]')).toBeVisible();
  await page.getByRole("button", { name: "生成排班", exact: true }).click();
  const result = page.locator("[data-auto-rotation-result]");
  await expect(result.locator('[data-schedule-view="list"]')).toBeVisible();
  await result.getByRole("tab", { name: "替补队列", exact: true }).click();
  await expect(result.getByText(/制造站 1 · 配置未完成，缺位 3/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("automatic queues keep whole-plan output stable across tabs and reuse details, portraits and drone controls", async ({ page }) => {
  await page.route("**/api/auto-rotation", async route => {
    const { layout } = route.request().postDataJSON();
    const state = { operators: ["阿米娅"], evaluationHours: 32, missingSeats: 0, complete: true };
    const rooms = layout.rooms.filter((room: { kind: string }) => ["trade_post", "factory", "power_plant"].includes(room.kind)).map((room: { id: string; kind: string; product?: { factory?: { recipe: string } } }) => {
      const extra = room.kind === "trade_post" ? {
        efficiency: { final_efficiency: 3.42, total_efficiency: 1.9, base_efficiency: 1.03, equivalent_efficiency: 0.8, global_efficiency: 0.07, order_multiplier: 1.8, trade_equivalent_efficiency: 1.85, gold_equivalent_efficiency: 0.3, gold_output_multiplier: 0.3 / 1.9 },
        productionPerDay: 35_106.3,
      } : room.kind === "factory" ? {
        efficiency: { final_efficiency: 1.25, base_efficiency: 1.03, equivalent_efficiency: 0.2, global_efficiency: 0.02 },
        productionPerDay: room.product?.factory?.recipe === "gold" ? 12_500 : 10_000,
      } : { powerChargeEfficiency: 0.2 };
      const backupExtra = room.kind === "factory" && room.product?.factory?.recipe === "battle_record"
        ? { efficiency: { final_efficiency: 2.5, base_efficiency: 1.03, equivalent_efficiency: 1.45, global_efficiency: 0.02 }, productionPerDay: 20_000 }
        : room.kind === "power_plant" ? { powerChargeEfficiency: 0.1 } : extra;
      return { roomId: room.id, kind: room.kind, main: { ...state, ...extra }, backup: { ...state, ...backupExtra } };
    });
    await route.fulfill({ json: { success: true, data: { ...autoResult, complete: true, rooms, warnings: [], fiammetta: { enabled: true, available: true, targets: [{ target: "但书", roomId: "trade_1" }] } }, requestId: "rich-output" } });
  });
  await openRotation(page);
  await page.getByRole("option", { name: "自动队列轮换", exact: true }).click();
  await finishSetup(page);
  await page.getByRole("button", { name: "生成排班", exact: true }).click();
  const result = page.locator("[data-auto-rotation-result]");
  const summary = result.locator("[data-plan-summary]");
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("整套方案 · 综合日产估算");
  await expect(summary.locator('[data-daily-product="experience"]')).toContainText("30,000");
  await expect(summary.locator('[data-plan-support="morale"]')).toContainText("但书");
  const originalTotals = await summary.locator("[data-daily-product]").allTextContents();
  await result.getByRole("tab", { name: "替补队列", exact: true }).click();
  await expect(result.locator('[data-room-title="制造站 3"]')).toContainText("250%");
  expect(await summary.locator("[data-daily-product]").allTextContents()).toEqual(originalTotals);
  await result.getByRole("tab", { name: "主力队列", exact: true }).click();
  await expect(result.locator('[data-room-title="制造站 3"]')).toContainText("125%");
  expect(await summary.locator("[data-daily-product]").allTextContents()).toEqual(originalTotals);
  const portrait = result.locator('[data-room-title="制造站 1"] [data-operator-identity="阿米娅"] img').first();
  await expect(portrait).toBeVisible();
  await expect.poll(() => portrait.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  const trade = result.locator('[data-room-title="贸易站 1"]');
  await expect(trade).toContainText("190%");
  await expect(trade).toContainText("103%");
  await expect(trade).toContainText("80%");
  await expect(trade).toContainText("7%");
  await expect(trade).toContainText("等效 185%");
  await summary.locator("[data-plan-primary-details-trigger]").click();
  const details = page.getByRole("dialog");
  await expect(details.locator('[data-production-detail="lmd-orders"]')).toContainText("70,213");
  await expect(details.locator('[data-production-detail="gold"]')).toContainText("估算等效赤金");
  await page.keyboard.press("Escape");
  const automatic = summary.getByRole("switch");
  await expect(automatic).toBeChecked();
  await automatic.click();
  await summary.getByRole("button", { name: "选择设施" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "制造站 3", exact: true }).click();
  await expect(summary.locator('[data-plan-support="drones"]')).toContainText("制造站 3");
  await expect(summary.locator('[data-daily-product="experience"]')).toContainText("33,500");
  const manualTotals = await summary.locator("[data-daily-product]").allTextContents();
  await leaveAndReturnToCalculator(page);
  await expect(automatic).not.toBeChecked();
  await expect(summary.locator('[data-plan-support="drones"]')).toContainText("制造站 3");
  expect(await summary.locator("[data-daily-product]").allTextContents()).toEqual(manualTotals);
  await result.getByRole("tab", { name: "替补队列", exact: true }).click();
  await expect(automatic).toBeChecked();
  await expect(summary).toContainText("整套方案 · 综合日产估算");
  expect(await summary.locator("[data-daily-product]").allTextContents()).toEqual(manualTotals);
  await result.getByRole("tab", { name: "主力队列", exact: true }).click();
  await expect(automatic).not.toBeChecked();
  await expect(summary.locator('[data-plan-support="drones"]')).toContainText("制造站 3");
  await summary.getByRole("button", { name: "选择设施" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "不使用无人机", exact: true }).click();
  await expect(summary.locator('[data-daily-product="experience"]')).toContainText("30,000");
  await leaveAndReturnToCalculator(page);
  await expect(automatic).not.toBeChecked();
  await expect(summary.locator('[data-daily-product="experience"]')).toContainText("30,000");
  await automatic.click();
  await expect(automatic).toBeChecked();
  await page.screenshot({ path: test.info().outputPath("auto-rotation-complete-output.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(summary).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("automatic output confirms product changes and recalculates with the confirmed layout", async ({ page }) => {
  const layouts: Array<{ rooms: Array<{ id: string; product?: { factory?: { recipe: string }; trade?: { order: string } } }> }> = [];
  await page.route("**/api/auto-rotation", async route => {
    layouts.push(route.request().postDataJSON().layout);
    await route.fulfill({ json: { success: true, data: autoResult, requestId: `product-${layouts.length}` } });
  });
  await openRotation(page);
  await page.getByRole("option", { name: "自动队列轮换", exact: true }).click();
  await finishSetup(page);
  await page.getByRole("button", { name: "生成排班", exact: true }).click();
  const result = page.locator("[data-auto-rotation-result]");
  await expect(result).toBeVisible();
  await result.getByRole("tab", { name: "列表式布局", exact: true }).click();
  const factoryControls = result.getByRole("group", { name: "制造站 1 配方" });
  await factoryControls.getByRole("button", { name: "作战记录", exact: true }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText("制造站 1 的制造配方将切换为「作战记录」");
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await expect(result).toBeVisible();
  expect(layouts).toHaveLength(1);
  await expect(factoryControls.getByRole("button", { name: "贵金属", exact: true })).toHaveAttribute("aria-pressed", "true");
  await factoryControls.getByRole("button", { name: "作战记录", exact: true }).click();
  await confirmation.getByRole("button", { name: "确认并重新排班", exact: true }).click();
  await expect.poll(() => layouts.length).toBe(2);
  expect(layouts[1].rooms.find(room => room.id === "manu_1")?.product?.factory?.recipe).toBe("battle_record");
  await expect(confirmation).toBeHidden();
  await expect(result).toBeVisible();
  await result.getByRole("tab", { name: "列表式布局", exact: true }).click();
  await expect(factoryControls.getByRole("button", { name: "作战记录", exact: true })).toHaveAttribute("aria-pressed", "true");
});
