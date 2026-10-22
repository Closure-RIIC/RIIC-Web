import { expect, test } from "@playwright/test";
import { adjacentPortraitPlanData, mockApis, seedV4Session } from "./production-readiness.fixture";

for (const width of [1440, 390]) {
  test(`shift portraits show a skeleton while loading at ${width}px`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: width === 390 ? "reduce" : "no-preference" });
    await mockApis(page);
    await seedV4Session(page, adjacentPortraitPlanData);
    await page.addInitScript(() => {
      localStorage.setItem("riic-web-user-settings", JSON.stringify({ showFloatingAgent: false }));
      Object.defineProperty(navigator, "connection", { configurable: true, value: { saveData: true } });
    });
    let releasePortrait!: () => void;
    const portraitGate = new Promise<void>(resolve => { releasePortrait = resolve; });
    let releasePresentations!: () => void;
    const presentationGate = new Promise<void>(resolve => { releasePresentations = resolve; });
    await page.route("**/src/schedule-presentation.ts*", async route => {
      await presentationGate;
      await route.continue();
    });
    await page.route("**/images/operator-portraits/003_kalts.webp*", async route => {
      await portraitGate;
      await route.continue();
    });
    await page.route("**/images/operator-portraits/4037_demetr.webp*", route => route.fulfill({ status: 404, body: "" }));
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible({ timeout: 45_000 });
      const view = page.locator(`[data-schedule-view="${width === 390 ? "list" : "compact"}"]`);
      const frame = (name: string) => view.locator(`[data-operator-identity="${name}"]`).first();
      const portrait = (name: string) => view.locator(`[data-operator-identity="${name}"] [data-operator-portrait-state]`).first();
      const shifts = page.locator('[data-shift-tabs] [role="tab"]');
      // Shift rows arrive before their asynchronously loaded portrait metadata.
      await expect(frame("阿米娅")).toHaveText("");
      await expect(frame("阿米娅").locator("[data-operator-portrait-skeleton]")).toBeVisible();
      await expect(frame("阿米娅").locator("[data-operator-portrait]")).toHaveCount(0);
      await shifts.nth(1).click();
      await expect(frame("凯尔希")).toHaveText("");
      await expect(frame("凯尔希").locator("[data-operator-portrait-skeleton]")).toBeVisible();
      await expect(frame("凯尔希").locator("[data-operator-portrait]")).toHaveCount(0);
      await shifts.nth(0).click();
      releasePresentations();
      await expect(async () => {
        await portrait("阿米娅").scrollIntoViewIfNeeded();
        await expect(portrait("阿米娅")).toHaveAttribute("data-operator-portrait-state", "loaded");
      }).toPass({ timeout: 15_000 });
      await shifts.nth(1).click();
      const pending = portrait("凯尔希");
      await frame("凯尔希").scrollIntoViewIfNeeded();
      await expect(pending).toHaveAttribute("data-operator-portrait-state", "loading");
      await expect(pending.locator("[data-operator-portrait-skeleton]")).toBeVisible();
      await expect(pending.locator("[data-operator-portrait]")).toHaveCSS("visibility", "hidden");
      await expect(pending).toHaveText("");
      if (width === 390) await expect(pending.locator("[data-operator-portrait-skeleton]")).toHaveCSS("animation-name", "none");

      await shifts.nth(0).click();
      await expect(portrait("阿米娅")).toHaveAttribute("data-operator-portrait-state", "loaded");
      releasePortrait();
      await shifts.nth(1).click();
      await frame("凯尔希").scrollIntoViewIfNeeded();
      await expect(pending).toHaveAttribute("data-operator-portrait-state", "loaded");
      await expect(pending.locator("[data-operator-portrait-skeleton]")).toHaveCount(0);
      await expect(pending.getByRole("img", { name: "凯尔希", exact: true })).toBeVisible();

      await shifts.nth(2).click();
      const failed = portrait("贝洛内");
      await frame("贝洛内").scrollIntoViewIfNeeded();
      await expect(failed).toHaveAttribute("data-operator-portrait-state", "error");
      await expect(failed.locator("[data-operator-portrait-skeleton]")).toBeVisible();
      await expect(failed.locator("[data-operator-portrait-skeleton]")).toHaveCSS("animation-name", "none");
      await expect(failed.locator("[data-operator-portrait]")).toHaveCount(0);
      await expect(failed).toHaveText("");
    } finally {
      releasePresentations();
      releasePortrait();
    }
  });
}
