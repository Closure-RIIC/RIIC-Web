import { expect, test } from "@playwright/test";

test("help filing links stay clear of floating controls", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/help");
  const filing = page.getByRole("link", { name: "沪公网安备31011502407364号" });
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 812 });
    await filing.scrollIntoViewIfNeeded();
    const filingBox = await filing.boundingBox();
    const menuBox = await page.getByRole("button", { name: "帮助目录", exact: true }).boundingBox();
    expect(filingBox).not.toBeNull();
    expect(menuBox).not.toBeNull();
    expect(filingBox!.x + filingBox!.width).toBeLessThanOrEqual(menuBox!.x - 8);
    await filing.click({ trial: true, position: { x: filingBox!.width - 2, y: filingBox!.height / 2 } });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("help pages provide an accessible back-to-top control", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 375, height: 320 });
  await page.goto("/help/import-operators");
  await expect(page.locator('body[data-app-hydrated="true"]')).toBeVisible();

  const backToTop = page.locator("[data-help-back-to-top]");
  const helpMenu = page.getByRole("button", { name: "帮助目录", exact: true });

  await expect(backToTop).toHaveAttribute("aria-hidden", "true");
  await expect(backToTop).toHaveAttribute("tabindex", "-1");

  await expect.poll(() => page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    return window.scrollY;
  })).toBeGreaterThanOrEqual(320);
  await expect(backToTop).toHaveAttribute("aria-hidden", "false");
  await expect(backToTop).toBeVisible();
  await expect(backToTop).toHaveAccessibleName("回到顶部");

  const backToTopBox = await backToTop.boundingBox();
  const helpMenuBox = await helpMenu.boundingBox();
  expect(backToTopBox).not.toBeNull();
  expect(helpMenuBox).not.toBeNull();
  expect(backToTopBox!.width).toBeGreaterThanOrEqual(44);
  expect(backToTopBox!.height).toBeGreaterThanOrEqual(44);
  expect(backToTopBox!.y + backToTopBox!.height).toBeLessThanOrEqual(helpMenuBox!.y - 8);

  await backToTop.click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator("#help-content")).toBeFocused();
  await expect(backToTop).toHaveAttribute("aria-hidden", "true");

  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(backToTop).toHaveAttribute("aria-label", "Back to top");

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
});
