import { expect, test, type Page } from "@playwright/test";
import { authenticatedSklandSnapshot, mockApis, planData, primarySklandAccount, requestId, seedV4Session } from "./production-readiness.fixture";

const initialBox = authenticatedSklandSnapshot.operbox.map((entry) => ({ ...entry, elite: 1, level: 50 }));
const report = {
  schema_version: 2, context: {}, newbie_section_status: "complete", incomplete_newbie: [], combinations: [],
  recommendations: [{
    action: "train", operator: "阿米娅", priority: "high_efficiency_standalone", priority_rank: 1, reason: "standalone",
    current: { elite: 1, level: 50 }, target: { kind: "explicit", elite: 2, level: 80 },
  }],
};
const oldResult = { ...planData, trainingAdvice: report };
const newResult = { ...planData, diagnosticId: "33333333-3333-4333-8333-333333333333", trainingAdvice: { ...report, recommendations: [] } };

async function setup(page: Page, queue = false, source: "skland" | "maa" = "skland") {
  await page.route("**/api/account/data-consent", (route) => route.fulfill({ json: {
    success: true, data: { current: false, cloudSyncEnabled: false, acceptedAt: null, revokedAt: null, termsVersion: "test", privacyVersion: "test" }, requestId,
  } }));
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    json: {
      session: { id: "training-session", userId: "test-user", expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
      user: { id: "test-user", name: "测试用户", email: "test@example.com", emailVerified: true },
    },
  }));
  await mockApis(page, {
    sklandConfigured: true, taskQueueEnabled: queue,
    sklandSnapshot: { ...authenticatedSklandSnapshot, operbox: initialBox },
  });
  await seedV4Session(page, oldResult, { boxSource: source, operbox: initialBox, layoutDirty: true });
  await page.clock.install();
}

test("sync refreshes training advice, preserves the schedule and skips unchanged solver input", async ({ page }) => {
  test.slow();
  await setup(page, true);
  let syncs = 0;
  let computes = 0;
  let failSync = false;
  await page.route("**/api/skland/training-sync", (route) => {
    syncs += 1;
    return route.fulfill({ json: failSync
      ? { success: false, error: { code: "AIC-RATE-6001", message: "Rate limited", retryable: true, retryAfterSeconds: 600 }, requestId }
      : { success: true, data: {
        authenticated: true, configured: true, accounts: [primarySklandAccount], activeAccountId: primarySklandAccount.accountId,
        scheduleSnapshot: authenticatedSklandSnapshot, statusSnapshot: authenticatedSklandSnapshot,
      }, requestId },
    });
  });
  await page.route("**/api/tasks", (route) => {
    computes += 1;
    expect(route.request().postDataJSON().operbox[0].elite).toBe(2);
    return route.fulfill({ json: { success: true, data: { status: "pending", taskId: "training-task" }, requestId } });
  });
  await page.route("**/api/tasks/training-task", (route) => route.fulfill({
    json: { success: true, data: { status: "done", taskId: "training-task", result: newResult }, requestId },
  }));
  await page.goto("/training");
  const sync = page.locator("[data-training-sync]");
  await expect(sync).toContainText("练度同步于", { timeout: 60_000 });
  await expect(sync).toHaveAttribute("data-slot", "live-activity");
  await expect(sync).toHaveAttribute("data-activity-kind", "training-sync");
  await expect(sync).toHaveAttribute("data-activity-phase", "success");
  await expect(page.locator('[data-training-page] [data-training-sync]')).toHaveCount(0);
  await expect(page.locator('[data-slot="live-activity"]')).toHaveCount(1);
  await expect(sync).toHaveAttribute("data-activity-view", "expanded");
  await expect(sync).toContainText("每 5 分钟自动同步");
  await page.clock.runFor(5_000);
  await expect(sync).toHaveCount(0);
  await expect(page.locator('[data-training-advice-list] [data-slot="training-advice-card"]')).toHaveCount(0);
  expect(computes).toBe(1);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("arknights-infra-calc-session-v5")!).operbox[0].elite)).toBe(2);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("arknights-infra-calc-session-v5")!));
  expect(saved.result.diagnosticId).toBe(oldResult.diagnosticId);
  expect(saved.result.maa).toEqual(oldResult.maa);
  expect(saved.layoutDirty).toBe(true);

  const firstSyncs = syncs;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-primary-navigation-page="calculator"]').click();
  await expect(page.locator('[data-training-sync]')).toHaveCount(0);
  await page.locator('[data-primary-navigation-page="training"]').click();
  // A dismissed success stays dismissed; stale-input warnings remain eligible.
  await expect(page.locator('[data-training-sync][data-activity-phase="success"]')).toHaveCount(0);
  const syncButton = page.locator('[data-training-page] [data-training-sync-action]');
  await expect(syncButton).toBeDisabled();
  await expect(page.locator('[data-training-advice-list] [data-slot="training-advice-card"]')).toHaveCount(0);
  expect(syncs).toBe(firstSyncs);
  expect(computes).toBe(1);
  await page.clock.fastForward(31_000);
  await expect(syncButton).toHaveText("立即同步");
  await syncButton.click();
  await expect.poll(() => syncs).toBe(firstSyncs + 1);
  await expect(sync).toContainText("练度同步于");
  expect(computes).toBe(1);

  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }));
  await page.clock.fastForward(301_000);
  expect(syncs).toBe(firstSyncs + 1);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => syncs).toBe(firstSyncs + 2);
  await expect(sync).toContainText("练度同步于");

  await page.clock.fastForward(301_000);
  await expect.poll(() => syncs).toBe(firstSyncs + 3);
  await expect(sync).toContainText("练度同步于");
  expect(computes).toBe(1);

  failSync = true;
  await page.clock.fastForward(301_000);
  await expect(sync).toContainText("更新未完成");
  await expect(sync).toHaveAttribute("data-activity-phase", "error");
  await sync.focus();
  await expect(sync.getByRole("button", { name: "复制诊断" })).toHaveCount(0);
  await expect(page.locator('[data-training-advice-list] [data-slot="training-advice-card"]')).toHaveCount(0);
  const failedSyncs = syncs;
  await page.clock.fastForward(301_000);
  expect(syncs).toBe(failedSyncs);
});

test("failed recomputation preserves old advice and can retry with the new progression", async ({ page }) => {
  test.slow();
  await setup(page);
  await page.route("**/api/skland/training-sync", (route) => route.fulfill({ json: { success: true, data: {
    authenticated: true, configured: true, accounts: [primarySklandAccount], activeAccountId: primarySklandAccount.accountId,
    scheduleSnapshot: authenticatedSklandSnapshot, statusSnapshot: authenticatedSklandSnapshot,
  }, requestId } }));
  let failCompute = true;
  await page.route("**/api/plan", (route) => route.fulfill({ json: failCompute
    ? { success: false, error: { code: "AIC-PLAN-3001", message: "Unavailable", retryable: true }, requestId }
    : { success: true, data: newResult, requestId },
  }));
  await page.goto("/training");
  const sync = page.locator("[data-training-sync]");
  await expect(sync).toContainText("更新未完成", { timeout: 60_000 });
  await expect(page.locator('[data-training-advice-list] [data-slot="training-advice-card"]')).toHaveCount(1);
  failCompute = false;
  await page.clock.fastForward(31_000);
  await sync.focus();
  await sync.getByRole("button", { name: "立即同步" }).click();
  await expect(sync).not.toContainText("更新未完成");
  await expect(page.locator('[data-training-advice-list] [data-slot="training-advice-card"]')).toHaveCount(0);
});

test("a manual import is not overwritten by an attached Skland account", async ({ page }) => {
  await setup(page, false, "maa");
  let syncs = 0;
  await page.route("**/api/skland/training-sync", (route) => { syncs += 1; return route.abort(); });
  await page.goto("/training");
  await expect(page.locator('[data-training-advice-list] [data-slot="training-advice-card"]')).toHaveCount(1);
  await page.clock.fastForward(301_000);
  await expect(page.locator("[data-training-sync]")).toHaveCount(0);
  expect(syncs).toBe(0);
});

test("an authentication pause releases training sync so reauthentication can retry", async ({ page }) => {
  test.slow();
  await setup(page, true);
  await page.route("**/api/skland/training-sync", route => route.fulfill({ json: { success: true, data: {
    authenticated: true, configured: true, accounts: [primarySklandAccount], activeAccountId: primarySklandAccount.accountId,
    scheduleSnapshot: authenticatedSklandSnapshot, statusSnapshot: authenticatedSklandSnapshot,
  }, requestId } }));
  let submissions = 0;
  await page.route("**/api/tasks", route => {
    submissions++;
    return route.fulfill({ json: { success: true, data: { status: "pending", taskId: `training-auth-${submissions}` }, requestId } });
  });
  await page.route("**/api/tasks/training-auth-*", route => route.fulfill({ json: submissions === 1
    ? { success: false, error: { code: "AIC-AUTH-2001", message: "Authentication expired" }, requestId }
    : { success: true, data: { status: "done", taskId: "training-auth-2", result: newResult }, requestId },
  }));
  await page.goto("/training");
  const sync = page.locator("[data-training-sync]");
  await expect(sync).toContainText("更新未完成", { timeout: 60_000 });
  await page.clock.fastForward(31_000);
  await sync.focus();
  await sync.getByRole("button", { name: "立即同步" }).click();
  await expect(sync).not.toContainText("更新未完成");
  await expect(page.locator('[data-training-advice-list] [data-slot="training-advice-card"]')).toHaveCount(0);
  expect(submissions).toBe(2);
});
