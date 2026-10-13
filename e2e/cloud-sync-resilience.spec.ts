import { expect, test } from "@playwright/test";
import { PRIVACY_VERSION, TERMS_VERSION } from "../src/legal-policy";
import { SESSION_KEY_V5 } from "../src/persistence";
import { cloudSyncPreferenceKey } from "../src/cloud-sync";
import { mockApis, planData, requestId, seedV4Session } from "./production-readiness.fixture";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: {
    session: { id: "test-session", token: "test-token", userId: "test-user", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    user: { id: "test-user", name: "测试用户", email: "test@example.com", emailVerified: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  } }));
});

for (const failure of [
  { code: "AIC-DATA-8001", status: 403 },
  { code: "AIC-RATE-6001", status: 429 },
  { code: "AIC-DATA-8003", status: 422 },
  { code: "AIC-DATA-8005", status: 409 },
]) {
  test(`cloud sync shows ${failure.code} and does not repeatedly upload`, async ({ page }) => {
    await mockApis(page);
    await seedV4Session(page, planData, { boxSource: "maa" });
    let writes = 0;
    await page.route("**/api/account/data-consent", (route) => route.fulfill({
      json: { success: true, requestId, data: { current: true, cloudSyncEnabled: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, acceptedAt: new Date().toISOString(), revokedAt: null } },
    }));
    await page.route("**/api/workspace", (route) => {
      if (route.request().method() === "GET") return route.fulfill({ json: {
        success: true, requestId,
        data: { exists: false, revision: 0, state: null, operbox: null, result: null, updatedAt: null, syncedAt: null, revisions: [] },
      } });
      writes++;
      return route.fulfill({ status: failure.status, headers: { "Retry-After": "60" }, json: {
        success: false, requestId, error: { code: failure.code, message: "fixture failure", retryable: failure.status === 429, retryAfterSeconds: 60 },
      } });
    });
    await page.goto("/");
    await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
    if (failure.status === 403) {
      const dialog = page.locator("[data-cloud-consent-dialog]");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "继续纯本地模式" }).click();
    } else {
      await expect(page.locator("[data-cloud-sync-error]")).toContainText(failure.code);
      await page.waitForTimeout(2600);
      expect(writes).toBe(1);
      await page.locator("[data-cloud-sync-error]").getByRole("button", { name: "仅使用本地", exact: true }).click();
    }
    await expect(page.locator("[data-cloud-sync-error]")).toHaveCount(0);
    await page.waitForTimeout(2600);
    expect(writes).toBe(1);
    const local = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SESSION_KEY_V5);
    expect(local.operbox[0].id).toBe("char_002_amiya");
    await page.reload();
    await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
    await page.waitForTimeout(1400);
    await expect(page.locator("[data-cloud-sync-error], [data-cloud-consent-dialog]")).toHaveCount(0);
    expect(writes).toBe(1);
  });
}

for (const width of [390, 1440]) {
  test(`local-only choice stays quiet and can be re-enabled from account settings at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApis(page);
    await seedV4Session(page, planData, { boxSource: "maa" });
    let consentCurrent = false;
    let consentReads = 0;
    let workspaceRequests = 0;
    await page.route("**/api/account/data-consent", route => {
      if (route.request().method() === "POST") consentCurrent = true;
      else if (route.request().method() === "GET") consentReads++;
      else throw new Error("Choosing local-only must not revoke or delete cloud data");
      return route.fulfill({ json: { success: true, requestId, data: {
        current: consentCurrent, cloudSyncEnabled: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, acceptedAt: null, revokedAt: null,
      } } });
    });
    await page.route("**/api/account/saved-plans", route => route.fulfill({ json: { success: true, requestId, data: { plans: [] } } }));
    await page.route("**/api/workspace", route => {
      workspaceRequests++;
      const empty = { exists: false, revision: 0, state: null, operbox: null, result: null, updatedAt: null, syncedAt: null, revisions: [] };
      return route.fulfill({ json: { success: true, requestId, data: route.request().method() === "PUT"
        ? { ...empty, ...route.request().postDataJSON(), exists: true, revision: 1 }
        : empty,
      } });
    });
    await page.goto("/");
    const dialog = page.locator("[data-cloud-consent-dialog]");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "继续纯本地模式" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("[data-cloud-sync-error]")).toHaveCount(0);
    expect(workspaceRequests).toBe(0);
    const readsBeforeReload = consentReads;
    await page.reload();
    await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
    await page.waitForTimeout(1400);
    expect(consentReads).toBe(readsBeforeReload);
    expect(workspaceRequests).toBe(0);
    await expect(dialog).toHaveCount(0);

    await page.goto("/account");
    const panel = page.locator("[data-cloud-data-panel]");
    await expect(panel).toContainText("当前保持纯本地模式");
    await panel.getByRole("button", { name: "启用云同步", exact: true }).click();
    await expect(dialog).toBeVisible();
    expect(workspaceRequests).toBe(0);
    await dialog.getByRole("checkbox").nth(0).check();
    await dialog.getByRole("checkbox").nth(1).check();
    await dialog.getByRole("button", { name: "同意并开始同步" }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => workspaceRequests).toBe(2);
    await panel.getByRole("button", { name: "仅使用本地", exact: true }).click();
    await expect(panel).toContainText("当前保持纯本地模式");
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), cloudSyncPreferenceKey("test-user"))).toBe("local-only");
    await page.reload();
    await expect(panel).toContainText("当前保持纯本地模式");
    await page.waitForTimeout(1400);
    expect(workspaceRequests).toBe(2);
    await expect(page.locator("[data-cloud-sync-error], [data-cloud-consent-dialog]")).toHaveCount(0);
  });
}
