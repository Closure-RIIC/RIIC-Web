import { expect, test } from "@playwright/test";

test("about uses the public help shell and keeps its links usable on small screens", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/about");
  await expect(page.getByRole("heading", { level: 1, name: "关于我们" })).toBeVisible();
  await expect(page.getByText("ABOUT US", { exact: true })).toHaveCount(0);
  await expect(page.locator("#about-content article a[target='_blank']")).toHaveCount(5);
  for (const link of await page.locator("#about-content article a[target='_blank']").all()) {
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { name: "开发资料和数据来源" })).toBeVisible();
    await expect(page.locator("footer [data-filing-links] a")).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "About", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Development resources and data sources" })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "About", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to Calculator", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(errors).toEqual([]);
});
