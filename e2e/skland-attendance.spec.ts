import { expect, test, type Page } from "@playwright/test";
import { authenticatedSklandSnapshot, mockApis, primarySklandAccount } from "./production-readiness.fixture";

async function prepare(page: Page) {
  await mockApis(page, { sklandConfigured: true, sklandSnapshot: authenticatedSklandSnapshot });
  await page.route("**/api/auth/get-session", route => route.fulfill({ json: { user: { id: "attendance-user", name: "博士", email: "demo@example.test" }, session: { expiresAt: "2099-01-01T00:00:00Z" } } }));
  await page.route("**/api/account/data-consent", route => route.fulfill({ json: { success: true, data: { current: false, cloudSyncEnabled: false } } }));
  let signed = false, writes = 0;
  await page.route("**/api/skland/attendance?*", route => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("accountId")).toBe(primarySklandAccount.accountId);
    expect(url.searchParams.get("uid")).toBe(authenticatedSklandSnapshot.player.uid);
    if (route.request().method() === "POST") { writes++; signed = true; }
    return route.fulfill({ json: { success: true, data: { uid: authenticatedSklandSnapshot.player.uid, date: "2026-10-16", hasToday: signed, signedNow: route.request().method() === "POST", awards: signed ? [{ name: "龙门币", count: 500 }] : [] } } });
  });
  return { writes: () => writes, nextDay: () => { signed = false; } };
}
for (const width of [390, 1440]) test(`manual check-in is explicit and displays rewards at ${width}px`, async ({ page }) => {
  const calls = await prepare(page);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/skland");
  const panel = page.locator("[data-skland-attendance]");
  await expect(panel).toContainText("今日未签到");
  expect(calls.writes()).toBe(0);
  await expect(panel.getByRole("switch")).not.toBeChecked();
  await panel.getByRole("button", { name: "一键签到", exact: true }).click();
  await expect(panel).toContainText("龙门币 × 500");
  await expect(panel.getByRole("button", { name: "今日已签到", exact: true })).toBeDisabled();
  expect(calls.writes()).toBe(1);
});
test("automatic check-in is opt-in, survives reload and does not re-sign today", async ({ page }) => {
  const calls = await prepare(page);
  await page.goto("/skland");
  const panel = page.locator("[data-skland-attendance]");
  await expect(panel).toContainText("今日未签到");
  await panel.getByRole("switch").check();
  await expect(panel).toContainText("龙门币 × 500");
  expect(calls.writes()).toBe(1);
  await page.reload();
  await expect(panel.getByRole("switch")).toBeChecked();
  await expect(panel).toContainText("今日已签到");
  expect(calls.writes()).toBe(1);
  calls.nextDay(); await page.reload();
  await expect.poll(calls.writes).toBe(2);
});
