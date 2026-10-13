import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("riic.plush.performance.v1", "quality"));
});

test("painted face, woven headband, badge and embroidery render at gallery quality", async ({ page }) => {
  test.setTimeout(120_000);
  // Keep all 64 shells and actual material sampling, with a bounded software-GPU
  // pixel workload. Full desktop/mobile canvas bounds are checked separately below.
  await page.setViewportSize({ width: 800, height: 400 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Check actual short-fiber draw calls, not just the underlying painted mask.
  await page.addInitScript(() => {
    const counts: number[] = [];
    Object.assign(window, { plushFiberDraws: counts });
    const original = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function (mode, first, count) {
      if (mode === this.LINES) counts.push(count);
      return original.call(this, mode, first, count);
    };
  });
  await page.route("**/api/telemetry", route => route.fulfill({ json: { success: true } }));
  await page.goto("/plush?debug=1");
  await page.getByText("更多设置", { exact: true }).click();

  for (const character of [
    { name: "能天使", id: "exusiai", scale: 1.05, points: [[-0.3, -0.2], [0.025, -0.23]] },
    { name: "琴柳", id: "saileach", scale: 1.16, points: [[-0.1, 0.39], [0, 0.4]] },
  ]) {
    await page.getByRole("toolbar").getByRole("button", { name: character.name, exact: true }).click();
    const avatar = page.locator(`[data-fur-avatar="${character.id}"]`);
    await expect(avatar).toHaveAttribute("data-fur-ready", "true", { timeout: 30_000 });
    {
      await expect(avatar).toHaveAttribute("data-fur-shells", "64");
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const pixels = await page.locator("main canvas").evaluate((element, { points, scale }) => {
        const canvas = element as HTMLCanvasElement;
        const copy = document.createElement("canvas");
        copy.width = canvas.width; copy.height = canvas.height;
        const ctx = copy.getContext("2d", { willReadFrequently: true })!;
        canvas.closest("[data-fur-avatar]")!.dispatchEvent(new CustomEvent("fur-snapshot", { detail: ctx }));
        return points.map(([x, y]) => Array.from(ctx.getImageData(
          Math.round(canvas.width * 0.5 + x * scale / 2.7 * canvas.height),
          Math.round((0.5 - y * scale / 2.7) * canvas.height), 1, 1,
        ).data));
      }, character);
      if (character.id === "exusiai") {
        const fibers = await page.evaluate(() => (window as unknown as { plushFiberDraws: number[] }).plushFiberDraws);
        expect(new Set(fibers.filter(count => count > 100)).size).toBe(2);
        const [skin, mouth] = pixels;
        expect(skin[0]).toBeGreaterThan(200);
        expect(skin[1]).toBeGreaterThan(170);
        expect(skin[2]).toBeGreaterThan(120);
        expect(skin[3]).toBe(255);
        expect(mouth[0] - mouth[1]).toBeGreaterThan(30);
        expect(mouth[1]).toBeGreaterThan(60);
        expect(mouth[3]).toBe(255);
      } else {
        const [badge, headband] = pixels;
        expect(badge[0]).toBeGreaterThan(180);
        expect(badge[1]).toBeGreaterThan(150);
        expect(badge[0] - badge[2]).toBeGreaterThan(20);
        expect(headband[2] - headband[0]).toBeGreaterThan(15);
        expect(headband[0]).toBeLessThan(150);
        expect(headband[3]).toBe(255);
      }
    }
  }
});

test("silverash inset ears render while rotating", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 800, height: 400 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && /THREE|Shader|WebGL/.test(message.text())) errors.push(message.text());
  });
  await page.route("**/api/telemetry", route => route.fulfill({ json: { success: true } }));
  await page.goto("/plush?debug=1");
  await page.getByRole("toolbar").getByRole("button", { name: "银灰", exact: true }).click();
  await expect(page.locator('[data-fur-avatar="silverash"]')).toHaveAttribute("data-fur-ready", "true", { timeout: 30_000 });
  const sample = () => page.locator("main canvas").evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const copy = document.createElement("canvas");
    copy.width = canvas.width; copy.height = canvas.height;
    const context = copy.getContext("2d", { willReadFrequently: true })!;
    canvas.closest("[data-fur-avatar]")!.dispatchEvent(new CustomEvent("fur-snapshot", { detail: context }));
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261, visible = 0;
    for (let i = 0; i < pixels.length; i++) hash = Math.imul(hash ^ pixels[i], 16777619);
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 100) visible++;
    return { hash: hash >>> 0, visible };
  });
  const front = await sample();
  expect(front.visible).toBeGreaterThan(10_000);
  await page.getByText("更多设置", { exact: true }).click();
  await page.getByLabel("水平角度", { exact: true }).fill("55");
  await expect.poll(async () => (await sample()).hash, { timeout: 30_000 }).not.toBe(front.hash);
  expect((await sample()).visible).toBeGreaterThan(10_000);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.locator("main canvas").evaluate(element => {
      const canvas = element as HTMLCanvasElement;
      const bounds = canvas.getBoundingClientRect();
      return Math.abs(bounds.width - innerWidth) < 1 && Math.abs(bounds.left) < 1
        && Math.abs(canvas.width / canvas.height - bounds.width / bounds.height) < 0.005
        && document.documentElement.scrollWidth === innerWidth;
    })).toBe(true);
  }
  expect(errors).toEqual([]);
});
