import { expect, test } from "@playwright/test";
import { mockApis, seedPreferences } from "./production-readiness.fixture";

test.beforeEach(async ({ page }) => {
  await mockApis(page);
  await seedPreferences(page);
  await page.route("**/api/skill-annotations", route => route.fulfill({
    json: { success: true, data: { annotations: [] }, requestId: "navigation-test" },
  }));
  await page.route("**/api/auth/get-session", route => route.fulfill({ json: {
    session: { expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
    user: { id: "navigation-test", name: "Navigation", email: "navigation@example.test", emailVerified: true },
  } }));
});

test("idle and navigation intent warm code without speculative server functions", async ({ page }) => {
  const serverFunctions: string[] = [];
  const manualModules: string[] = [];
  page.on("request", request => {
    const url = request.url();
    if (url.includes("/_serverFn/")) serverFunctions.push(url);
    if (/\/assets\/_workbench\.manual-[^/]+\.js|\/src\/routes\/_workbench\.manual\.tsx\?tsr-split/.test(url)) manualModules.push(url);
  });
  await page.goto("/");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  await page.waitForTimeout(500);
  expect(serverFunctions).toHaveLength(0);
  const manual = page.locator('[data-primary-navigation-page="manual"]');
  await manual.hover();
  await expect.poll(() => manualModules.length).toBeGreaterThan(0);
  await page.mouse.move(1000, 200);
  const warmed = manualModules.length;
  await manual.hover();
  await page.waitForTimeout(400);
  expect(manualModules).toHaveLength(warmed);
  expect(serverFunctions).toHaveLength(0);
  await manual.click();
  await expect(page.locator("[data-manual-schedule-empty]")).toBeVisible();
  await expect(page.locator("[data-infra-canvas]")).toHaveCount(0);
  expect(serverFunctions.length).toBeGreaterThan(0);
  expect(serverFunctions.length).toBeLessThanOrEqual(2);
});

test("slow navigation keeps the current mode until the new page commits, then refresh and back work", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/_serverFn/**", async route => { await gate; await route.continue(); });
  try {
    await page.locator('[data-primary-navigation-page="manual"]').click();
    await expect(page).toHaveURL(/\/manual$/);
    await expect(page.locator('[data-primary-page="calculator"]')).toBeVisible();
    await expect(page.locator('[data-primary-navigation-page="calculator"]')).toHaveAttribute("aria-current", "page");
    await expect(page.locator("[data-infra-canvas]")).toBeVisible();
  } finally { release(); }
  await expect(page.locator("[data-manual-schedule-empty]")).toBeVisible();
  await expect(page.locator("[data-infra-canvas]")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("[data-manual-schedule-empty]")).toBeVisible();
  for (const [name, selector] of [
    ["calculator", "[data-infra-canvas]"],
    ["training", "[data-training-page]"],
    ["skill-query", "[data-skill-query-page]"],
  ]) {
    await page.locator(`[data-primary-navigation-page="${name}"]`).click();
    await expect(page.locator(selector)).toBeVisible();
    await expect(page.locator("[data-manual-schedule-empty]")).toHaveCount(0);
  }
  await page.goBack();
  await expect(page.locator("[data-training-page]")).toBeVisible();
  await page.goForward();
  await expect(page.locator("[data-skill-query-page]")).toBeVisible();
});
