import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { mockApis, seedV4Session, scheduleVisualPlanData } from "./production-readiness.fixture";

for (const { width, mode, dark } of [
  { width: 1440, mode: "compact", dark: false },
  { width: 390, mode: "list", dark: true },
]) {
  test(`schedule PNG preserves ${mode} backgrounds and excludes feedback at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockApis(page);
    await seedV4Session(page, scheduleVisualPlanData);
    await page.addInitScript(() => localStorage.setItem("riic-web-user-settings", JSON.stringify({ showFloatingAgent: false })));
    await page.goto("/");
    await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible({ timeout: 45_000 });
    const board = page.locator("[data-plan-board]");
    await expect(board.locator(`[data-schedule-view="${mode}"]`)).toBeVisible();
    // Mounted cards can still be covered by SkeletonSwap's minimum display time.
    await expect(board.locator('[data-skeleton-swap="loading"]')).toHaveCount(0);
    await expect(board.locator("[data-skeleton-swap-placeholder]")).toHaveCount(0);
    await page.evaluate((enabled) => document.documentElement.classList.toggle("dark", enabled), dark);
    await board.locator("img").evaluateAll(images => Promise.all(images.map(image => {
      image.loading = "eager";
      return image.decode().catch(() => {});
    })));
    const feedback = board.locator("[data-html2canvas-ignore]");
    await expect(feedback.first()).toBeVisible();
    const feedbackCount = await feedback.count();
    await feedback.evaluateAll(elements => elements.forEach(element => {
      (element as HTMLElement).style.setProperty("background", "rgb(255, 0, 255)", "important");
    }));
    await page.mouse.move(0, 0);
    const samples = [];
    // Scroll each card into view so the app's scroll container cannot clip the reference.
    for (const card of await board.locator(".infra-room-surface:visible").all()) {
      const reference = await card.screenshot({ animations: "disabled" });
      const bounds = await card.evaluate(element => {
        const origin = element.closest("[data-plan-board]")!.getBoundingClientRect();
        const bounds = element.getBoundingClientRect();
        return { x: bounds.x - origin.x, y: bounds.y - origin.y, width: bounds.width, height: bounds.height };
      });
      samples.push({ ...bounds, reference });
    }
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出图片", exact: true }).click();
    const download = await pending;
    const png = await readFile((await download.path())!);
    const exported = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [...exported.data.subarray((y * exported.info.width + x) * 3, (y * exported.info.width + x) * 3 + 3)];
    // Check all four edges, including points well inside the white frame.
    for (const inset of [0, 12, 24]) {
      for (let x = inset; x < exported.info.width - inset; x += 11) {
        expect(pixel(x, inset)).toEqual([255, 255, 255]);
        expect(pixel(x, exported.info.height - 1 - inset)).toEqual([255, 255, 255]);
      }
      for (let y = inset; y < exported.info.height - inset; y += 11) {
        expect(pixel(inset, y)).toEqual([255, 255, 255]);
        expect(pixel(exported.info.width - 1 - inset, y)).toEqual([255, 255, 255]);
      }
    }
    let feedbackPixels = 0;
    for (let index = 0; index < exported.data.length; index += 3) {
      if (exported.data[index] > 245 && exported.data[index + 1] < 10 && exported.data[index + 2] > 245) feedbackPixels++;
    }
    expect(feedbackPixels).toBe(0);
    await expect(feedback).toHaveCount(feedbackCount);
    await expect(feedback.first()).toBeVisible();

    const errors = [];
    for (const card of samples) {
      const native = await sharp(card.reference).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const rendered = await sharp(png).extract({ left: 48 + Math.round(card.x * 2), top: 48 + Math.round(card.y * 2), width: Math.round(card.width * 2), height: Math.round(card.height * 2) })
        .resize(native.info.width, native.info.height).removeAlpha().raw().toBuffer();
      let difference = 0, count = 0;
      const y = native.info.height - 5;
      for (let x = 6; x < native.info.width - 6; x += 3) {
        const index = (y * native.info.width + x) * 3;
        for (let channel = 0; channel < 3; channel++) {
          difference += Math.abs(native.data[index + channel] - rendered[index + channel]);
          count++;
        }
      }
      errors.push(difference / count);
    }
    await testInfo.attach("exported-schedule", { body: png, contentType: "image/png" });
    expect(samples.length).toBeGreaterThan(0);
    expect(Math.max(...errors), `Background channel errors: ${errors.join(", ")}`).toBeLessThan(2);
  });
}
