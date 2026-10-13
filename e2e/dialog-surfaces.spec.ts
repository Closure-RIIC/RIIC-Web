import { expect, test } from "@playwright/test";
import { gotoStable, mockAnonymousWebsiteSession, mockApis, seedV4Session, waitForOwnAnimations } from "./production-readiness.fixture";

test.beforeEach(async ({ page }) => {
  await mockApis(page);
  await mockAnonymousWebsiteSession(page);
  await seedV4Session(page);
});

for (const [path, accent] of [["/", "#FFD800"], ["/mastery", "#B8F03A"], ["/skills", "#22BBFF"], ["/billing", "#C084FC"]]) {
  test(`portalled dialogs use the ${path} page accent and an opaque card surface`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoStable(page, path!);
    await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible({ timeout: 30_000 });
    const trigger = page.getByRole("button", { name: "账号管理", exact: true });
    await trigger.click();
    const dialog = page.locator('[data-website-account-dialog]:not([data-website-account-dialog-loading])');
    await expect(dialog).toBeVisible();
    await waitForOwnAnimations(dialog);
    for (const dark of [false, true]) {
      await page.evaluate((enabled) => document.documentElement.classList.toggle("dark", enabled), dark);
      const surface = await dialog.evaluate((element) => {
        const style = getComputedStyle(element);
        const probe = document.createElement("span");
        probe.style.backgroundColor = "var(--muted)";
        element.append(probe);
        const expectedBackground = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return {
          accent: style.getPropertyValue("--dialog-accent").trim(),
          background: style.backgroundColor,
          expectedBackground,
          backdrop: style.backdropFilter,
          filter: style.filter,
          corner: getComputedStyle(element, "::before").backgroundImage,
        };
      });
      expect(surface.accent).toBe(accent);
      expect(surface.background).toBe(surface.expectedBackground);
      expect(surface.background).not.toMatch(/transparent|\/\s*0[.\s)]/);
      expect(surface.backdrop).toBe("none");
      expect(surface.filter).toBe("none");
      expect(surface.corner).toContain("repeating-linear-gradient");
    }
    await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCSS("backdrop-filter", "none");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
  });
}

test("mobile reduced-motion dialogs do not scale and restore page interaction", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoStable(page, "/mastery");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible({ timeout: 30_000 });
  const trigger = page.getByRole("button", { name: "选择干员", exact: true });
  await trigger.click();
  const dialog = page.locator("[data-mastery-target-picker]");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("transform", "none");
  await expect(dialog).toHaveCSS("filter", "none");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await trigger.click();
  await expect(dialog).toBeVisible();
});

test("resizing during dialog exit removes the popup and restores page interaction", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoStable(page, "/");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible({ timeout: 30_000 });
  const trigger = page.getByRole("button", { name: "账号管理", exact: true });
  await trigger.click();
  const dialog = page.locator('[data-website-account-dialog]:not([data-website-account-dialog-loading])');
  await expect(dialog).toBeVisible();
  await waitForOwnAnimations(dialog);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  // Crossing the scrollbar breakpoint while the exit is running must not
  // detach/reinsert the animated shell or leave an invisible click blocker.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await trigger.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("cancelled exit animations still release the modal and its backdrop", async ({ page }) => {
  await gotoStable(page, "/");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible({ timeout: 30_000 });
  const trigger = page.getByRole("button", { name: "账号管理", exact: true });
  await trigger.click();
  const dialog = page.locator('[data-website-account-dialog]:not([data-website-account-dialog-loading])');
  await expect(dialog).toBeVisible();
  await waitForOwnAnimations(dialog);
  await dialog.evaluate((element) => {
    const observer = new MutationObserver(() => {
      if (!element.hasAttribute("data-ending-style")) return;
      observer.disconnect();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const animations = element.getAnimations();
        document.documentElement.dataset.cancelledDialogAnimations = String(animations.length);
        for (const animation of animations) animation.cancel();
      }));
    });
    observer.observe(element, { attributes: true, attributeFilter: ["data-ending-style"] });
  });
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("data-cancelled-dialog-animations", /^[1-9]\d*$/);
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
  await trigger.click();
  await expect(dialog).toBeVisible();
});
