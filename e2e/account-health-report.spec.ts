import { expect, test } from "@playwright/test";
import path from "node:path";

import { mockApis, requestId } from "./production-readiness.fixture";

const fixture = (name: string) => path.resolve("apps/arknights/src/report-recognition/fixtures", name);

test("screenshot recognition, correction and three-day average stay on account health", async ({ page }) => {
  await mockApis(page);
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: {
    session: { id: "health-session", token: "health-token", userId: "health-user", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    user: { id: "health-user", name: "报表测试", email: "health@example.com", emailVerified: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  } }));
  let stored: Record<string, unknown> | null = null;
  await page.route("**/api/account/game-report", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { days: unknown; sourceType: string };
      stored = { id: "report-1", days: body.days, sourceType: body.sourceType, createdAt: "2026-09-24T00:00:00.000Z" };
    }
    await route.fulfill({ json: { success: true, data: stored, requestId } });
  });
  await page.goto("/account-health");
  await expect(page.locator("[data-game-report-section]")).toBeVisible();

  await page.getByRole("button", { name: "选择截图" }).click();
  await page.locator('[data-file-upload-dialog] input[type="file"]').setInputFiles(fixture("single-day.png"));
  await expect(page.getByText("请提交三日报表。")).toBeVisible();
  await expect(page.getByRole("button", { name: "确认并保存" })).toBeDisabled();

  await page.getByRole("button", { name: "选择截图" }).click();
  await page.locator('[data-file-upload-dialog] input[type="file"]').setInputFiles(fixture("compressed-three-day.jpg"));
  await expect(page.getByLabel("贵金属价值 第 1 天")).toHaveValue("");

  await page.getByRole("button", { name: "选择截图" }).click();
  await page.locator('[data-file-upload-dialog] input[type="file"]').setInputFiles(fixture("pc-three-day-orders.png"));
  await expect(page.getByLabel("龙门币贸易 第 1 天")).toHaveValue("79500");
  await expect(page.getByLabel("龙门币订单数量 第 1 天")).toHaveValue("39");
  await expect(page.getByLabel("龙门币订单数量 第 2 天")).toHaveValue("39");
  await expect(page.getByLabel("龙门币订单数量 第 3 天")).toHaveValue("40");

  await page.getByRole("button", { name: "选择截图" }).click();
  await page.locator('[data-file-upload-dialog] input[type="file"]').setInputFiles(fixture("three-day.png"));
  await expect(page.getByLabel("贵金属价值 第 1 天")).toHaveValue("54000");
  await expect(page.getByLabel("合成玉 第 1 天")).toHaveValue("20");
  await expect(page.getByRole("button", { name: "确认并保存" })).toBeEnabled();
  await page.getByRole("button", { name: "选择截图" }).click();
  await page.locator('[data-file-upload-dialog] input[type="file"]').setInputFiles(fixture("single-day.png"));
  await expect(page.getByLabel("贵金属价值 第 1 天")).toHaveValue("");
  await expect(page.getByRole("button", { name: "确认并保存" })).toBeDisabled();
  await page.getByRole("button", { name: "选择截图" }).click();
  await page.locator('[data-file-upload-dialog] input[type="file"]').setInputFiles(fixture("three-day.png"));
  await page.getByLabel("贵金属价值 第 2 天").fill("46000");
  await page.getByLabel("龙门币贸易 第 2 天").fill("63800");
  await page.getByLabel("合成玉 第 2 天").fill("480");
  await page.getByLabel("龙门币订单数量 第 3 天").fill("24");
  await page.getByRole("button", { name: "确认并保存" }).click();
  await expect(page.locator("[data-game-report-average]")).toBeVisible();
  expect((stored as { sourceType: string } | null)?.sourceType).toBe("screenshot");
  await page.reload();
  await expect(page.locator("[data-game-report-average]")).toBeVisible();
  await expect(page.locator("[data-account-health-page]")).toContainText("基建日产钱书比");
  await expect(page.getByLabel("龙门币贸易 第 1 天")).toHaveValue("85500");
  await page.getByRole("tab", { name: "手动填写" }).click();
  await page.getByLabel("龙门币贸易 第 1 天").fill("90000");
  await page.getByRole("button", { name: "确认并保存" }).click();
  await expect(page.locator("[data-game-report-average]")).toContainText("69933");
  expect((stored as { sourceType: string } | null)?.sourceType).toBe("manual");

  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
