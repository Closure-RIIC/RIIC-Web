import { expect, test, type Page } from "@playwright/test";

const performanceKey = "riic.plush.performance.v1";
const appearanceKey = "riic.plush.lab.v2";

async function selectInitialMode(page: Page, mode: string) {
  // Reloads must retain changes made through the actual selector.
  await page.addInitScript(({ key, initial }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, initial);
  }, { key: performanceKey, initial: mode });
}

test.beforeEach(async ({ page }) => {
  // Keep software WebGL affordable without removing the real renderer.
  await page.setViewportSize({ width: 400, height: 540 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("**/api/telemetry", route => route.fulfill({ json: { success: true } }));
});

test("persisted static mode displays each character without initializing WebGL", async ({ page }) => {
  await selectInitialMode(page, "static");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const state = { contexts: 0 };
    Object.assign(window, { plushPerformance: state });
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (/^webgl|^experimental-webgl/.test(String(args[0]))) state.contexts++;
      return original.apply(this, args);
    } as typeof original;
  });
  await page.goto("/plush");
  await expect(page.getByLabel("画质与耗电", { exact: true })).toHaveValue("static");
  for (const [name, variant] of [["可露希尔", "closure"], ["银灰", "silverash"], ["能天使", "exusiai"], ["琴柳", "saileach"], ["山", "mountain"]]) {
    await page.getByRole("toolbar").getByRole("button", { name, exact: true }).click();
    const avatar = page.locator(`[data-fur-avatar="${variant}"]`);
    await expect(avatar).toHaveAttribute("data-fur-performance", "static");
    const image = avatar.locator("img");
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute("src", `/images/plush/${variant}.webp`);
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  // Include passive effects/prewarming in the no-initialization assertion.
  await page.waitForTimeout(1800);
  expect(await page.evaluate(() => (window as unknown as { plushPerformance: { contexts: number } }).plushPerformance.contexts)).toBe(0);
  await expect(page.locator("main canvas")).toHaveCount(0);
});

test("performance preferences persist independently from authored appearance", async ({ page }) => {
  test.setTimeout(120_000);
  await selectInitialMode(page, "balanced");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/plush?debug=1");
  await page.getByText("画质与耗电设置", { exact: true }).click();
  const mode = page.getByLabel("画质与耗电", { exact: true });
  const avatar = page.locator('[data-fur-avatar="closure"]');
  await expect(mode).toHaveValue("balanced");
  await expect(avatar).toHaveAttribute("data-fur-ready", "true", { timeout: 30_000 });
  await page.getByLabel("毛长", { exact: true }).fill("1.6");
  await expect(avatar).toHaveAttribute("data-fur-length", "1.6", { timeout: 30_000 });
  const authored = await page.evaluate(key => localStorage.getItem(key), appearanceKey);
  expect(JSON.parse(authored!).personas.closure.length).toBe(1.6);
  await mode.selectOption("saver");
  await expect(avatar).toHaveAttribute("data-fur-performance", "saver");
  expect(await page.evaluate(key => localStorage.getItem(key), appearanceKey)).toBe(authored);
  expect(await page.evaluate(key => localStorage.getItem(key), performanceKey)).toBe("saver");
  await page.reload();
  await page.getByText("画质与耗电设置", { exact: true }).click();
  await expect(mode).toHaveValue("saver");
  await expect(page.getByLabel("毛长", { exact: true })).toHaveValue("1.6");
  await expect(avatar).toHaveAttribute("data-fur-length", "1.6", { timeout: 30_000 });
  await mode.selectOption("quality");
  await expect(avatar).toHaveAttribute("data-fur-shells", "64", { timeout: 30_000 });
  await expect(avatar).toHaveAttribute("data-fur-fps", "60");
  await expect(avatar).toHaveAttribute("data-fur-length", "1.6");
  expect(await page.evaluate(key => localStorage.getItem(key), appearanceKey)).toBe(authored);
  await mode.selectOption("static");
  await expect(avatar).toHaveAttribute("data-fur-performance", "static");
  await expect(page.locator("main canvas")).toHaveCount(0);
  await mode.selectOption("balanced");
  await expect(avatar).toHaveAttribute("data-fur-ready", "true", { timeout: 30_000 });
  await expect(avatar).toHaveAttribute("data-fur-shells", "36");
  await expect(avatar).toHaveAttribute("data-fur-length", "1.6");
  expect(await page.evaluate(key => localStorage.getItem(key), appearanceKey)).toBe(authored);
});

for (const mode of ["balanced", "saver"]) {
  test(`${mode} stops drawing at rest and wakes for intentional press and drag`, async ({ page }) => {
    test.setTimeout(120_000);
    await selectInitialMode(page, mode);
    await page.goto("/plush");
    const avatar = page.locator('[data-fur-avatar="closure"]');
    await expect(avatar).toHaveAttribute("data-fur-ready", "true", { timeout: 30_000 });
    await expect(avatar).toHaveAttribute("data-fur-performance", mode);
    await expect(avatar).toHaveAttribute("data-fur-shells", mode === "balanced" ? "36" : "20");
    await expect(avatar).toHaveAttribute("data-fur-fps", mode === "balanced" ? "30" : "24");
    const frames = async () => Number(await avatar.getAttribute("data-fur-frames"));
    await page.mouse.move(0, 0);
    await expect(avatar).toHaveAttribute("data-fur-motion", "idle", { timeout: 30_000 });
    const before = await frames();
    await page.waitForTimeout(1200);
    expect(await frames()).toBe(before);
    const box = (await avatar.boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await expect.poll(async () => Number(await avatar.getAttribute("data-fur-press")), { timeout: 20_000 }).toBeGreaterThan(0.7);
    await page.mouse.move(x + 65, y + 20, { steps: 3 });
    await expect.poll(async () => Number(await avatar.getAttribute("data-fur-yaw")), { timeout: 20_000 }).toBeGreaterThan(0.7);
    await page.mouse.up();
    await page.mouse.move(0, 0);
    await expect.poll(async () => Math.abs(Number(await avatar.getAttribute("data-fur-press"))), { timeout: 20_000 }).toBeLessThan(0.01);
    await expect(avatar).toHaveAttribute("data-fur-motion", "idle", { timeout: 30_000 });
    const after = await frames();
    expect(after).toBeGreaterThan(before);
    await page.waitForTimeout(1200);
    expect(await frames()).toBe(after);
  });
}
