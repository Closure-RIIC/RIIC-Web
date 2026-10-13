import { expect, test } from "@playwright/test";

test("auto falls back on a completed slow GPU sample and retries without changing preference", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 256, height: 384 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("riic.plush.performance.v1", "auto");
    const state = { milliseconds: 1600, completedSamples: 0 };
    Object.assign(window, { plushAutoGpu: state });
    const prototype = WebGL2RenderingContext.prototype;
    const getExtension = prototype.getExtension;
    const getParameter = prototype.getParameter;
    const beginQuery = prototype.beginQuery;
    const endQuery = prototype.endQuery;
    const getQueryParameter = prototype.getQueryParameter;
    const active = new WeakMap<WebGL2RenderingContext, WebGLQuery>();
    const samples = new WeakMap<WebGLQuery, number>();
    const elapsed = 0x88bf, disjoint = 0x8fbb, renderer = 0x9246;
    // Keep real rendering, fences, and context disposal. Only replace the timer
    // extension's measurements so software/hardware CI drivers take one path.
    prototype.getExtension = function (this: WebGL2RenderingContext, name: string) {
      if (name === "EXT_disjoint_timer_query_webgl2") return { TIME_ELAPSED_EXT: elapsed, GPU_DISJOINT_EXT: disjoint };
      if (name === "WEBGL_debug_renderer_info") return { UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: renderer };
      return Reflect.apply(getExtension, this, [name]);
    } as typeof getExtension;
    prototype.getParameter = function (parameter) {
      if (parameter === disjoint) return false;
      if (parameter === renderer) return "Deterministic hardware GPU";
      if (parameter === 0x9245) return "Plush test driver";
      return getParameter.call(this, parameter);
    };
    prototype.beginQuery = function (target, query) {
      if (target === elapsed) { active.set(this, query); return; }
      return beginQuery.call(this, target, query);
    };
    prototype.endQuery = function (target) {
      if (target === elapsed) {
        const query = active.get(this);
        if (query) {
          samples.set(query, state.milliseconds * 1e6);
          active.delete(this);
          state.completedSamples++;
        }
        return;
      }
      return endQuery.call(this, target);
    };
    prototype.getQueryParameter = function (query, parameter) {
      if (samples.has(query)) {
        if (parameter === this.QUERY_RESULT_AVAILABLE) return true;
        if (parameter === this.QUERY_RESULT) return samples.get(query)!;
      }
      return getQueryParameter.call(this, query, parameter);
    };
  });
  await page.route("**/api/telemetry", route => route.fulfill({ json: { success: true } }));
  await page.goto("/plush");
  const avatar = page.locator('[data-fur-avatar="closure"]');
  const mode = page.getByLabel("画质与耗电", { exact: true });
  await expect(mode).toHaveValue("auto");
  await expect(avatar).toHaveAttribute("data-fur-performance", "static", { timeout: 30_000 });
  expect(await page.evaluate(() => (window as unknown as { plushAutoGpu: { completedSamples: number } }).plushAutoGpu.completedSamples)).toBeGreaterThan(0);
  await expect(page.locator("main canvas")).toHaveCount(0);
  await expect(avatar.locator("img")).toBeVisible();
  await expect.poll(() => avatar.locator("img").evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const stopped = await avatar.getAttribute("data-fur-frames");
  await page.waitForTimeout(500);
  expect(await avatar.getAttribute("data-fur-frames")).toBe(stopped);
  await expect(mode).toHaveValue("auto");
  expect(await page.evaluate(() => localStorage.getItem("riic.plush.performance.v1"))).toBe("auto");

  // Retrying samples the new conditions instead of permanently persisting a
  // downgrade. It must recreate a real renderer and resume actual frames.
  await page.evaluate(() => { (window as unknown as { plushAutoGpu: { milliseconds: number } }).plushAutoGpu.milliseconds = 8; });
  await page.getByRole("button", { name: "重新检测性能", exact: true }).click();
  await expect(avatar).toHaveAttribute("data-fur-ready", "true", { timeout: 30_000 });
  await expect(avatar).toHaveAttribute("data-fur-performance", "quality");
  await expect(avatar).toHaveAttribute("data-fur-shells", "64");
  await expect(avatar).toHaveAttribute("data-fur-gpu-ms", "8.0");
  await expect(page.locator("main canvas")).toHaveCount(1);
  const resumed = Number(await avatar.getAttribute("data-fur-frames"));
  await expect.poll(async () => Number(await avatar.getAttribute("data-fur-frames")), { timeout: 20_000 }).toBeGreaterThan(resumed + 2);
  await expect(avatar).toHaveAttribute("data-fur-performance", "quality");
  await expect(mode).toHaveValue("auto");
  expect(errors).toEqual([]);
});

test("missing static previews retain the SVG and keyboard character selection", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 540 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("riic.plush.performance.v1", "static"));
  await page.route("**/images/plush/*.webp", route => route.fulfill({ status: 404, body: "missing" }));
  await page.route("**/api/telemetry", route => route.fulfill({ json: { success: true } }));
  await page.goto("/plush");
  const closure = page.locator('[data-fur-avatar="closure"]');
  await expect(closure).toHaveAttribute("data-fur-performance", "static");
  await expect(closure.locator("[data-fur-fallback]")).toBeVisible();
  const selected = page.getByRole("toolbar").getByRole("button", { name: "可露希尔", exact: true });
  await selected.focus();
  await page.keyboard.press("ArrowRight");
  const silverash = page.locator('[data-fur-avatar="silverash"]');
  await expect(silverash).toHaveAttribute("data-fur-performance", "static");
  await expect(silverash.locator("[data-fur-fallback]")).toBeVisible();
  await expect(page.getByRole("toolbar").getByRole("button", { name: "银灰", exact: true })).toBeFocused();
  await expect(page.locator("main canvas")).toHaveCount(0);
});
