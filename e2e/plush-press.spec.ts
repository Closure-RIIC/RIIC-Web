import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("riic.plush.performance.v1", "quality"));
});

for (const [name, variant, scale] of [["可露希尔", "closure", 1], ["能天使", "exusiai", 1.05], ["琴柳", "saileach", 1.16], ["山", "mountain", 1.10]] as const) {
test(`${variant} eyes press into ovals and recover without a static backing`, async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 400, height: 540 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && /THREE|Shader|WebGL/.test(message.text())) errors.push(message.text());
  });
  await page.route("**/api/telemetry", route => route.fulfill({ json: { success: true } }));
  await page.goto("/plush?debug=1");
  await page.getByText("更多设置", { exact: true }).click();
  await page.getByLabel("持续动画", { exact: true }).uncheck();
  await page.getByText("更多设置", { exact: true }).click();
  {
    await page.getByRole("toolbar").getByRole("button", { name, exact: true }).click();
    const avatar = page.locator(`[data-fur-avatar="${variant}"]`);
    await expect(avatar).toHaveAttribute("data-fur-ready", "true", { timeout: 30_000 });
    // The first rendered frame starts the incoming animation; its initial
    // bounding box can still be outside the viewport. Press the settled model.
    await expect(page.locator(`[data-plush-card="${variant}"]`)).not.toHaveAttribute("data-switching", /.+/);
    await page.bringToFront();
    await expect(avatar).toBeInViewport();
    await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe("visible");
    const bounds = await avatar.boundingBox();
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await expect.poll(() => avatar.evaluate(element => {
      const box = element.getBoundingClientRect();
      return { motion: (element as HTMLElement).dataset.furMotion, visibility: document.visibilityState,
        bounds: { x: box.x, y: box.y, width: box.width, height: box.height },
        viewport: { width: innerWidth, height: innerHeight }, scrollY };
    }), { timeout: 15_000 }).toMatchObject({ motion: "idle", visibility: "visible" });
    const eyePixels = () => page.locator("main canvas").evaluate((element, { character, scale }) => {
      const canvas = element as HTMLCanvasElement;
      const copy = document.createElement("canvas");
      copy.width = canvas.width; copy.height = canvas.height;
      const context = copy.getContext("2d", { willReadFrequently: true })!;
      canvas.closest("[data-fur-avatar]")!.dispatchEvent(new CustomEvent("fur-snapshot", { detail: context }));
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      let pixels = 0;
      for (let y = 0; y < image.height; y += 2) for (let x = 0; x < image.width; x += 2) {
        if (character !== "closure") {
          const worldX = (x - image.width * 0.5) * 2.7 / image.height / scale;
          const worldY = (image.height * 0.5 - y) * 2.7 / image.height / scale;
          if (worldX < -0.4 || worldX > -0.08 || worldY < -0.27 || worldY > (character === "exusiai" ? 0.15 : 0.05)) continue;
        }
        const i = (y * image.width + x) * 4;
        const r = image.data[i], g = image.data[i + 1], b = image.data[i + 2], a = image.data[i + 3];
        if (a < 200) continue;
        if (character === "closure" ? r > 80 && r > g * 1.4 && r > b * 1.2
          : character === "exusiai" ? r > 120 && g > 100 && b < g * 0.6
          : g > 95 && b > r * 1.15 && g > r * 1.1) pixels++;
      }
      return pixels;
    }, { character: variant, scale });
    const open = await eyePixels();
    expect(open).toBeGreaterThan(30);
    await page.bringToFront();
    // Coordinate input does not perform Playwright's usual hit-target checks.
    expect(await avatar.evaluate(element => {
      const box = element.getBoundingClientRect();
      return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest("[data-fur-avatar]") === element;
    })).toBe(true);
    await page.mouse.down();
    await expect.poll(eyePixels, { timeout: 20_000 }).toBeLessThan(open * 0.75);
    await expect(avatar).toHaveAttribute("data-fur-motion", "idle", { timeout: 15_000 });
    const pressed = await eyePixels();
    await expect(avatar).toHaveAttribute("data-fur-resolution-scale", "1.00");
    expect(pressed).toBeLessThan(open * 0.75);
    expect(pressed).toBeGreaterThan(open * 0.3);
    await page.mouse.up();
    await expect.poll(eyePixels, { timeout: 20_000 }).toBeGreaterThan(open * 0.85);
    await expect(avatar).toHaveAttribute("data-fur-motion", "idle", { timeout: 15_000 });
    console.log({ variant, openPixels: open, pressedPixels: pressed, restoredPixels: await eyePixels() });
  }
  expect(errors).toEqual([]);
});
}
