import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("riic.plush.performance.v1", "quality"));
});

test("orbital plush switching springs into place, queues clicks, and reuses WebGL", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 400, height: 420 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    const state = { directions: [] as { incoming: boolean; transforms: string[] }[], contexts: 0, inertia: [] as number[], hold: true };
    Object.assign(window, { plushTransitions: state });
    const observed = new WeakSet<HTMLElement>();
    document.addEventListener("fur-rendered", event => {
      const root = event.target;
      if (!(root instanceof HTMLElement) || observed.has(root)) return;
      observed.add(root);
      new MutationObserver(() => state.inertia.push(Number(root.dataset.furInertia ?? 0)))
        .observe(root, { attributes: true, attributeFilter: ["data-fur-inertia"] });
    });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (this instanceof HTMLElement && (this.dataset.switching || this.dataset.plushOutgoing)) {
        state.directions.push({ incoming: Boolean(this.dataset.switching), transforms: (frames as Keyframe[]).map(frame => String(frame.transform)) });
      }
      const animation = animate.call(this, frames, options);
      // Hold two physical instants so software WebGL can validate the fur
      // independently of how many wall-clock frames the test machine can draw.
      if (state.hold && this instanceof HTMLElement && this.dataset.switching) { animation.pause(); animation.currentTime = 180; }
      return animation;
    };
    const context = HTMLCanvasElement.prototype.getContext;
    const canvases = new WeakSet<HTMLCanvasElement>();
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof context>) {
      if (args[0] === "webgl2" && !canvases.has(this)) { canvases.add(this); state.contexts++; }
      return context.apply(this, args);
    } as typeof context;
  });
  await page.route("**/api/telemetry", route => route.fulfill({ json: { success: true } }));
  await page.goto("/plush?debug=1");
  await expect(page.locator('[data-fur-avatar="closure"]')).toHaveAttribute("data-fur-ready", "true", { timeout: 30_000 });
  await page.getByText("更多设置", { exact: true }).click();
  await page.getByLabel("持续动画", { exact: true }).uncheck();
  await page.getByText("更多设置", { exact: true }).click();
  let previousName = "可露希尔";
  const switchTo = async (name: string, id: string) => {
    await page.getByRole("toolbar").getByRole("button", { name, exact: true }).click();
    await expect(page.locator(`[data-plush-card="${id}"] [data-fur-avatar]`)).toHaveAttribute("data-fur-ready", "true", { timeout: 30_000 });
    const { direction, oldName, newName } = await page.evaluate(() => ({
      direction: document.querySelector<HTMLElement>("main")?.dataset.switchDirection,
      oldName: document.querySelector("[data-plush-outgoing] [data-plush-name] text")?.textContent,
      newName: document.querySelector("[data-plush-card] [data-plush-name] text")?.textContent,
    }));
    expect(newName).toBe(name);
    if (direction) {
      expect(oldName).toBe(previousName);
      const sign = direction === "forward" ? 1 : -1;
      const inertia = async () => Number(await page.locator(`[data-plush-card="${id}"] [data-fur-avatar]`).getAttribute("data-fur-inertia")) * sign;
      await expect.poll(inertia, { timeout: 20_000 }).toBeGreaterThan(0.02);
      await page.evaluate(id => { document.querySelector(`[data-plush-card="${id}"]`)!.getAnimations()[0].currentTime = 700; }, id);
      await expect.poll(inertia, { timeout: 20_000 }).toBeLessThan(-0.01);
      await page.evaluate(id => document.querySelector(`[data-plush-card="${id}"]`)!.getAnimations()[0].play(), id);
    }
    await expect(page.locator("main")).not.toHaveAttribute("data-switch-direction", /.+/, { timeout: 15_000 });
    expect(await page.evaluate(() => ({ canvases: document.querySelectorAll("main canvas").length, names: document.querySelectorAll("[data-plush-name]").length }))).toEqual({ canvases: 1, names: 1 });
    previousName = name;
  };
  await switchTo("银灰", "silverash");
  await expect.poll(async () => Math.abs(Number(await page.locator('[data-fur-avatar="silverash"]').getAttribute("data-fur-inertia")))).toBeLessThan(0.001);
  await switchTo("可露希尔", "closure");
  const beforeRapid = await page.evaluate(() => {
    const state = (window as unknown as { plushTransitions: { directions: { incoming: boolean; transforms: string[] }[]; contexts: number } }).plushTransitions;
    return { contexts: state.contexts, directions: state.directions.map(item => ({ incoming: item.incoming, poses: item.transforms.map(transform => {
      const matrix = new DOMMatrixReadOnly(transform);
      return { x: matrix.m41, y: matrix.m42, scale: matrix.m11 };
    }) })) };
  });
  expect(beforeRapid.contexts).toBe(1);
  const incoming = beforeRapid.directions.filter(item => item.incoming);
  const outgoing = beforeRapid.directions.filter(item => !item.incoming);
  expect(incoming[0].poses[0].x).toBeCloseTo(400);
  expect(incoming[0].poses[0].y).toBeLessThan(0);
  expect(incoming[0].poses[0].scale).toBeLessThan(0.85);
  expect(incoming[0].poses.some(pose => pose.x < -20)).toBe(true);
  expect(incoming[0].poses.at(-1)).toEqual({ x: 0, y: 0, scale: 1 });
  expect(outgoing[0].poses.at(-1)!.x).toBeCloseTo(-400);
  expect(outgoing[0].poses.at(-1)!.y).toBeLessThan(0);
  expect(incoming[1].poses[0].x).toBeCloseTo(-400);
  expect(outgoing[1].poses.at(-1)!.x).toBeCloseTo(400);
  const inertia = await page.evaluate(() => (window as unknown as { plushTransitions: { inertia: number[] } }).plushTransitions.inertia);
  expect(Math.max(...inertia)).toBeGreaterThan(0.02);
  expect(Math.min(...inertia)).toBeLessThan(-0.02);
  await expect(page.locator('[data-fur-avatar="closure"]')).toHaveAttribute("data-fur-shells", "64");
  await page.evaluate(() => { (window as unknown as { plushTransitions: { hold: boolean } }).plushTransitions.hold = false; });
  await page.getByRole("toolbar").evaluate(toolbar => {
    const buttons = toolbar.querySelectorAll("button");
    buttons[1].click(); buttons[2].click(); buttons[4].click();
  });
  await expect(page.locator('[data-plush-card="mountain"] [data-fur-avatar]')).toHaveAttribute("data-fur-ready", "true", { timeout: 30_000 });
  await expect(page.locator("main")).not.toHaveAttribute("data-switch-direction", /.+/, { timeout: 15_000 });
  await expect(page.locator("[data-plush-outgoing]")).toHaveCount(0);
  await expect(page.locator("main canvas")).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const previous = await page.evaluate(() => (window as unknown as { plushTransitions: { directions: unknown[] } }).plushTransitions.directions.length);
  await switchTo("可露希尔", "closure");
  expect(await page.evaluate(() => (window as unknown as { plushTransitions: { directions: unknown[]; contexts: number } }).plushTransitions)).toMatchObject({ contexts: 1 });
  expect(await page.evaluate(() => (window as unknown as { plushTransitions: { directions: unknown[] } }).plushTransitions.directions.length)).toBe(previous);
  // Reduced automatic motion must still allow an intentional press-and-drag.
  const avatar = page.locator('[data-fur-avatar="closure"]');
  const box = await avatar.boundingBox();
  const x = box!.x + box!.width / 2, y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 100, y + 30, { steps: 3 });
  await expect.poll(async () => Number(await avatar.getAttribute("data-fur-yaw")), { timeout: 20_000 }).toBeGreaterThan(1);
  await expect.poll(async () => Number(await avatar.getAttribute("data-fur-pitch"))).toBeGreaterThan(0.1);
  await page.mouse.up();
});

test("pressing during an orbit hands control to dragging immediately", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 400, height: 420 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      if (this instanceof HTMLElement && this.dataset.switching) { animation.pause(); animation.currentTime = 700; }
      return animation;
    };
  });
  await page.route("**/api/telemetry", route => route.fulfill({ json: { success: true } }));
  await page.goto("/plush?debug=1");
  await expect(page.locator('[data-fur-avatar="closure"]')).toHaveAttribute("data-fur-ready", "true", { timeout: 30_000 });
  await page.getByRole("toolbar").getByRole("button", { name: "银灰", exact: true }).click();
  const avatar = page.locator('[data-fur-avatar="silverash"]');
  await expect(avatar).toHaveAttribute("data-fur-ready", "true", { timeout: 30_000 });
  await expect(page.locator('[data-plush-card="silverash"]')).toHaveAttribute("data-switching", "moving");
  await page.mouse.move(200, 145);
  await page.mouse.down();
  await expect(page.locator("main")).not.toHaveAttribute("data-switch-direction", /.+/);
  await expect(page.locator("[data-plush-outgoing]")).toHaveCount(0);
  await page.mouse.move(300, 170, { steps: 3 });
  await expect.poll(async () => Number(await avatar.getAttribute("data-fur-yaw")), { timeout: 20_000 }).toBeGreaterThan(1);
  await page.mouse.up();
});
