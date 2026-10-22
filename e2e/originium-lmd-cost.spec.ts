import { expect, test } from "@playwright/test";
import { mockApis, seedV4Session, twoShiftPlanData } from "./production-readiness.fixture";

for (const locale of ["zh", "en"] as const) {
  test(`shard recipe changes reconcile negative daily LMD in summary and details (${locale})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "riic-locale", value: locale, url: baseURL! }]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockApis(page);
    await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: {
      session: { id: "test-session", userId: "test-user", expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
      user: { id: "test-user", name: "Test user", email: "test@example.com", emailVerified: true, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() },
    } }));
    const result = structuredClone(twoShiftPlanData);
    result.rotation.daily.production = {
      lmd: 0, pure_gold: 0, battle_records: 0, originium_shards: 24, orundum: 0,
    };
    await seedV4Session(page, result, { rotationProfile: "main_backup_12_12" });
    // Wait for the session provider effects before replaying the browser-only mocked login.
    await page.goto("/");
    await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    const summary = page.locator('[data-daily-product="lmd-orders"]');
    await expect(summary).toBeVisible({ timeout: 15_000 });
    await expect(summary).toContainText(locale === "en" ? "Net LMD" : "净龙门币");
    await expect(summary).toContainText("-38,400");
    await page.locator("[data-plan-primary-details-trigger]").click();
    const detail = page.locator('[data-production-detail="lmd-orders"]');
    await expect(detail).toContainText("-38,400");
    const recipe = page.getByRole("combobox", { name: locale === "en" ? "Shard cost recipe" : "碎片成本配方" });
    await recipe.selectOption("device");
    await expect(detail).toContainText("-24,000");
    await expect(detail).not.toContainText("-38,400");
    await page.keyboard.press("Escape");
    await expect(summary).toContainText("-24,000");
    await page.locator("[data-plan-primary-details-trigger]").click();
    await expect(recipe).toHaveValue("device");
    await recipe.selectOption("orirock");
    await expect(detail).toContainText("-38,400");
    await page.setViewportSize({ width: 390, height: 844 });
    const drawer = page.locator('[data-slot="drawer-content"]');
    await expect(drawer).toBeVisible();
    const fit = await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
    expect(fit).toBe(true);
    await page.screenshot({ path: `output/playwright/issue-320-${locale}.png` });
  });
}
