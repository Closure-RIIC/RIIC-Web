import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { mockApis, seedV4Session } from "./production-readiness.fixture";

// Fully synthetic public-protocol data; no private solver run or account data.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/auto-main-backup-public.json", import.meta.url), "utf8"));

async function expectEmptyBoard(page: Page) {
  const board = page.locator("[data-plan-board]");
  await expect(board).toBeVisible();
  await expect(board).toContainText("等待排班");
  await expect(board).toContainText("贸易站");
  await expect(board).toContainText("制造站");
  await expect(page.locator("[data-plan-summary]")).toHaveCount(0);
}

async function acknowledgeAutomaticResult(page: Page) {
  const notice = page.getByRole("dialog", { name: "排班已生成", exact: true });
  await expect(notice).toContainText("自动队列轮换结果已更新，可以查看或导出");
  await notice.getByRole("button", { name: "关闭", exact: true }).first().click();
}

async function prepare(page: Page, queue = true, legacySelection?: string) {
  await mockApis(page, { taskQueueEnabled: queue, dismissSolverWarning: false });
  await page.route("**/api/auth/get-session", route => route.fulfill({ json: {
    session: { id: "auto-session", token: "auto-token", userId: "auto-user", expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
    user: { id: "auto-user", name: "测试用户", email: "auto@example.com", emailVerified: true },
  } }));
  await seedV4Session(page, null, { operbox: fixture.operbox, boxSource: queue ? "maa" : "sample" });
  await page.addInitScript(({ layout, legacySelection }) => {
    const key = "arknights-infra-calc-session-v4";
    const session = JSON.parse(localStorage.getItem(key)!);
    session.layout = layout;
    if (legacySelection) session.rotationSelection = legacySelection;
    localStorage.setItem(key, JSON.stringify(session));
  }, { layout: fixture.layout, legacySelection });
  await page.goto("/");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible({ timeout: 15_000 });
  if (legacySelection) {
    await expectEmptyBoard(page);
    return;
  }
  await page.getByRole("button", { name: "配置Box与布局" }).first().click();
  const dialog = page.locator("[data-setup-dialog]");
  await dialog.getByRole("button", { name: "继续", exact: true }).click();
  await dialog.getByRole("combobox", { name: "换班方式" }).click();
  await expect(page.getByRole("option")).toHaveText([
    "一天两换三班倒 12/12/12", "一天三换三班倒 12/6/6", "主备两班轮换 24/24", "自动队列轮换", "自定义时长",
  ]);
  await page.getByRole("option", { name: "自动队列轮换", exact: true }).click();
  await expect(dialog.locator("[data-rotation-auto] input")).toHaveCount(0);
  await dialog.getByRole("button", { name: /^(检查设施|继续)$/, exact: true }).click();
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  await expectEmptyBoard(page);
}

for (const queue of [true, false]) test(`automatic rotation uses shared ${queue ? "task" : "plan"} output, exports and production`, async ({ page }) => {
  await prepare(page, queue);
  let request: Record<string, unknown> | undefined;
  let obsoleteRequests = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/auto-rotation") obsoleteRequests++; });
  await page.route(queue ? "**/api/tasks" : "**/api/plan", route => {
    request = route.request().postDataJSON();
    return route.fulfill({ json: { success: true, data: queue ? { status: "done", result: fixture.data } : fixture.data, requestId: "auto-public" } });
  });
  await page.getByRole("button", { name: "生成排班", exact: true }).click();
  await acknowledgeAutomaticResult(page);
  const board = page.locator("[data-plan-board]");
  await expect(board).toBeVisible();
  await expect.poll(() => request?.rotation).toEqual({ topology: "auto", shift_hours: [24, 24] });
  expect(request?.boxSource).toBe(queue ? "maa" : "sample");
  if (queue) expect(request?.operbox).toHaveLength(fixture.operbox.length);
  else expect(request).not.toHaveProperty("operbox");
  expect(obsoleteRequests).toBe(0);
  const tabs = page.locator("[data-shift-tabs]").getByRole("tab");
  await expect(tabs).toHaveCount(2);
  await expect(tabs).toHaveText(["第 1 班", "第 2 班"]);
  const summary = page.locator("[data-plan-summary]");
  await expect(summary).toBeVisible();
  await expect(page.locator("[data-rotation-warnings]")).toContainText(fixture.data.rotation.warnings[0]);
  await expect(summary.locator('[data-plan-support="morale"]')).toContainText("但书");
  const totals = await summary.locator("[data-daily-product]").allTextContents();
  expect(totals.length).toBeGreaterThan(0);
  await tabs.nth(1).click();
  expect(await summary.locator("[data-daily-product]").allTextContents()).toEqual(totals);
  await tabs.nth(0).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出到 MAA", exact: true }).click();
  const stream = await (await pending).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const maa = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(maa.plans).toHaveLength(2);
  expect(maa.plans.map((plan: { Fiammetta: unknown }) => plan.Fiammetta)).toEqual(fixture.data.maa.plans.map((plan: { Fiammetta: unknown }) => plan.Fiammetta));
  const automatic = summary.getByRole("switch", { name: "自动分配无人机", exact: true });
  await expect(automatic).toBeChecked();
  await automatic.click();
  await expect(automatic).not.toBeChecked();
  await automatic.click();
  await expect(automatic).toBeChecked();
  await page.screenshot({ path: test.info().outputPath("auto-public-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(summary).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("auto-public-mobile.png"), fullPage: true });
  await page.reload();
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("arknights-infra-calc-session-v5")!).rotationSelection)).toBe("auto_24_24");
});

test("automatic rotation cancellation uses the shared queue", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/tasks", route => route.fulfill({ json: { success: true, data: { taskId: "auto-cancel", status: "pending" }, requestId: "queued" } }));
  let cancelled = false;
  await page.route("**/api/tasks/auto-cancel", route => {
    if (route.request().method() === "DELETE") {
      cancelled = true;
      return route.fulfill({ json: { success: true, data: { taskId: "auto-cancel", cancelled: true, reason: null }, requestId: "cancelled" } });
    }
    return route.fulfill({ json: { success: true, data: { taskId: "auto-cancel", status: "pending" }, requestId: "pending" } });
  });
  await page.getByRole("button", { name: "生成排班", exact: true }).click();
  await expectEmptyBoard(page);
  await page.getByRole("button", { name: /取消任务/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /确认取消/ }).click();
  await expect.poll(() => cancelled).toBe(true);
  await expect(page.getByRole("button", { name: "生成排班", exact: true })).toBeEnabled();
  await expectEmptyBoard(page);
});

test("automatic rotation failure preserves the default facility structure", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/tasks", route => route.fulfill({ status: 500, json: {
    success: false, error: { code: "AIC-PLAN-3004", message: "排班失败，请重试。", retryable: true }, requestId: "synthetic-auto-failure",
  } }));
  await page.getByRole("button", { name: "生成排班", exact: true }).click();
  await expect(page.getByText("AIC-PLAN-3004", { exact: false }).first()).toBeVisible();
  await expectEmptyBoard(page);
});

test("legacy automatic 32/32 sessions submit the current 24/24 request", async ({ page }) => {
  await prepare(page, true, "auto_32_32");
  let request: Record<string, unknown> | undefined;
  await page.route("**/api/tasks", route => {
    request = route.request().postDataJSON();
    return route.fulfill({ json: { success: true, data: { status: "done", result: fixture.data }, requestId: "synthetic-auto-migration" } });
  });
  await page.getByRole("button", { name: "生成排班", exact: true }).click();
  await expect.poll(() => request?.rotation).toEqual({ topology: "auto", shift_hours: [24, 24] });
  await acknowledgeAutomaticResult(page);
  await expect(page.locator("[data-shift-tabs]").getByRole("tab")).toHaveText(["第 1 班", "第 2 班"]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("arknights-infra-calc-session-v5")!).rotationSelection)).toBe("auto_24_24");
});

for (const { profile, durations } of [
  { profile: "main_backup_24_24", durations: [24, 24] },
  { profile: "abc_12_6_6", durations: [12, 6, 6] },
]) test(`ordinary ${profile} shift tabs retain their durations`, async ({ page }) => {
  await mockApis(page);
  const data = structuredClone(fixture.data);
  delete data.rotation.auto_rotation;
  delete data.rotation.warnings;
  data.rotation.profile = profile;
  data.profile.rotation_profile = profile;
  data.rotation.shifts = durations.map((hours, index) => ({
    ...structuredClone(fixture.data.rotation.shifts[index % 2]), index, duration_hours: hours,
  }));
  data.maa.plans = durations.map((_, index) => ({
    ...structuredClone(fixture.data.maa.plans[index % 2]), name: `第 ${index + 1} 班`,
  }));
  await seedV4Session(page, data, { rotationProfile: profile, operbox: fixture.operbox });
  await page.goto("/");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-shift-tabs]").getByRole("tab")).toHaveText(
    durations.map((hours, index) => `第 ${index + 1} 班 · ${hours}h`),
  );
});
