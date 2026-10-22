import { expect, test } from "@playwright/test";
import { mockApis, seedV4Session } from "./production-readiness.fixture";

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test(`the page frame stays fixed while content scrolls and history restores position at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockApis(page);
    await seedV4Session(page);
    await page.goto("/settings");
    await expect(page.locator("[data-user-settings-page]")).toBeVisible();

    const frame = page.locator('[data-slot="sidebar-inset"]');
    const scroll = page.locator("[data-app-scroll-area]");
    const gap = viewport.width < 768 ? 4 : 8;
    const initialFrame = await frame.boundingBox();
    expect(initialFrame).not.toBeNull();
    expect(initialFrame!.y).toBe(gap);
    const dockHeight = viewport.width < 768 ? 44 : 34;
    expect(initialFrame!.height).toBe(viewport.height - gap - dockHeight);
    const dock = await page.locator("[data-workbench-dock]").boundingBox();
    expect(dock).not.toBeNull();
    expect(initialFrame!.y + initialFrame!.height).toBe(dock!.y);
    expect(dock!.y + dock!.height).toBe(viewport.height);

    const distance = await scroll.evaluate(element => Math.min(500, element.scrollHeight - element.clientHeight));
    expect(distance).toBeGreaterThan(100);
    await scroll.hover({ position: { x: 100, y: 150 } });
    await page.mouse.wheel(0, distance);
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeCloseTo(distance, 0);
    expect(await frame.boundingBox()).toEqual(initialFrame);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(1);

    if (viewport.width >= 768) {
      const handle = page.locator("[data-app-page-scrollbar] .os-scrollbar-vertical .os-scrollbar-handle");
      await scroll.evaluate(element => element.scrollTo(0, 0));
      await scroll.hover({ position: { x: 100, y: 150 } });
      await expect(handle).toBeVisible();
      const bounds = (await handle.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(initialFrame!.x + initialFrame!.width);
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 + 60, { steps: 8 });
      await page.mouse.up();
      await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      expect(await frame.boundingBox()).toEqual(initialFrame);
      await scroll.evaluate((element, top) => element.scrollTo(0, top), distance);
    }

    if (viewport.width < 768) {
      await page.locator('[data-slot="sidebar-trigger"]:visible').first().click();
    }
    await page.locator('[data-primary-navigation-page="training"]:visible').click();
    await expect(page).toHaveURL(/\/training$/);
    await expect(page.locator("[data-training-page]")).toBeVisible();
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(0);
    expect(await frame.boundingBox()).toEqual(initialFrame);

    await page.goBack();
    await expect(page.locator("[data-user-settings-page]")).toBeVisible();
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeCloseTo(distance, 0);
    expect(await frame.boundingBox()).toEqual(initialFrame);
  });
}
