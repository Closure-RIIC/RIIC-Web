import { expect, test } from "@playwright/test";
import { mockApis, seedV4Session } from "./production-readiness.fixture";

test.beforeEach(async ({ page }) => {
  await mockApis(page);
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      session: { id: "test-session", token: "test-token", userId: "test-user", expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
      user: { id: "test-user", name: "测试用户", email: "test@example.com", emailVerified: true },
    }),
  }));
  await seedV4Session(page);
  await page.goto("/");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  await page.getByRole("button", { name: "配置Box与布局" }).first().click();
  await expect(page.locator("[data-setup-dialog]")).toBeVisible();
});

test("closing an unchanged setup session does not require confirmation", async ({ page }) => {
  const dialog = page.locator("[data-setup-dialog]");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "关闭排班设置？", exact: true })).toHaveCount(0);
});

for (const change of ["layout", "rotation"] as const) {
  test(`changing setup ${change} requires confirmation`, async ({ page }) => {
    const dialog = page.locator("[data-setup-dialog]");
    await dialog.getByRole("button", { name: "继续", exact: true }).click();
    if (change === "layout") {
      await dialog.getByRole("button", { name: /^252/ }).click();
    } else {
      await dialog.getByRole("combobox", { name: "换班方式" }).click();
      await page.getByRole("option", { name: /一天两换/ }).click();
    }
    await expect(dialog.getByText("配置已修改", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "关闭排班设置？", exact: true });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "继续编辑", exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await confirmation.getByRole("button", { name: "关闭设置", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });
}
