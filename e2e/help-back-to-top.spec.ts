import { expect, test } from "@playwright/test";

test("documentation filing links remain reachable inside the page frame", async ({ page }) => {
  await page.goto("/help");
  const filing = page.getByRole("link", { name: "沪公网安备31011502407364号" });
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 812 });
    await filing.scrollIntoViewIfNeeded();
    const bounds = (await filing.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 4);
    await filing.click({ trial: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("article back-to-top works in the inner viewport and language persists", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/docs/first-import");
  const scroll = page.locator('[data-app-scroll-area="docs"]');
  const top = page.locator("#docs-content [data-docs-back-to-top]");
  await top.scrollIntoViewIfNeeded();
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(500);
  await top.click();
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(0);
  await expect(page.locator("#docs-content")).toBeFocused();
  await page.getByRole("button", { name: "展开或收起目录" }).click();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your first import", exact: true })).toBeVisible();
  await expect(top).toHaveText("Back to top");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
