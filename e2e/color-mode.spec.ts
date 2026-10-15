import { expect, test } from "@playwright/test";
import { mockAnonymousWebsiteSession, mockApis } from "./production-readiness.fixture";

for (const width of [390, 768, 1440]) {
  test(`day and night mode persist across reload and navigation at ${width}px`, async ({ page }) => {
    await mockAnonymousWebsiteSession(page);
    await mockApis(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/settings");
    await page.getByRole("combobox", { name: "外观模式", exact: true }).click();
    await page.getByRole("option", { name: "夜间模式", exact: true }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
    await page.reload();
    await expect(page.getByRole("combobox", { name: "外观模式", exact: true })).toHaveValue("夜间模式");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.goto("/skills");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.goto("/settings");
    await page.getByRole("combobox", { name: "外观模式", exact: true }).click();
    await page.getByRole("option", { name: "日间模式", exact: true }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
