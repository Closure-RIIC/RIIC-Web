import { expect, test, type Page } from "@playwright/test";
import { mockApis } from "./production-readiness.fixture";
import { openAgentHistory } from "./agent-history";

async function personaControl(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "附件与人格卡", exact: true });
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await expect(menu).toBeVisible({ timeout: 30_000 });
    if (await menu.getAttribute("aria-expanded") !== "true") await menu.click();
  }
  return page.getByRole("button", { name, exact: true });
}

const savedUpload = { version: 1, id: "upload-existing", name: "原有人格", content: "原来的自定义人格内容", description: "保留上传内容" };

for (const unavailable of ["unconfigured", "payment_required"] as const) {
  test(`cloud appearance remains available while chat is ${unavailable}`, async ({ page }) => {
    await prepare(page);
    await page.addInitScript(() => localStorage.setItem("riic.plush.performance.v1", "static"));
    await page.route("**/api/agent/chat", route => route.fulfill({
      status: unavailable === "payment_required" ? 402 : 200,
      json: { success: true, data: { enabled: false } },
    }));
    await page.goto("/agent");
    await page.getByRole("button", { name: "人格卡：可露希尔", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "人格卡", exact: true });
    await expect(dialog.getByRole("tablist")).toHaveCount(0);
    await expect(dialog.locator("[data-cloud-card]")).toHaveCount(2);
    await expect(dialog.locator("[data-cloud-card]").first()).toHaveAttribute("data-cloud-card", "frost-cloud");
    await expect(dialog.locator("[data-cloud-card]").nth(1)).toHaveAttribute("data-cloud-card", "glow-cloud");
    await expect(dialog.locator('[data-persona-card="default"]')).toBeVisible();
    await dialog.getByRole("button", { name: "使用 纯净模式", exact: true }).click();
    await expect(dialog.locator('[data-cloud-card="glow-cloud"]')).toHaveAttribute("data-selected", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-agent-composer] textarea")).toHaveCount(0);
  });
}

for (const mobile of [false, true]) {
  test(`cloud selection clears the prior persona and preserves pure replies across reload (${mobile ? "mobile" : "desktop"})`, async ({ page }) => {
    test.setTimeout(120_000);
    await prepare(page);
    await page.addInitScript(() => localStorage.setItem("riic.plush.performance.v1", "static"));
    await page.setViewportSize(mobile ? { width: 375, height: 812 } : { width: 1280, height: 900 });
    await page.goto("/agent");
    await (await personaControl(page, "人格卡：可露希尔")).click();
    const dialog = page.getByRole("dialog", { name: "人格卡", exact: true });
    await expect(dialog.getByRole("tablist")).toHaveCount(0);
    const cloudBounds = await dialog.locator('[data-cloud-card="frost-cloud"]').boundingBox();
    const plushBounds = await dialog.locator('[data-persona-card="default"]').boundingBox();
    expect(cloudBounds!.y + cloudBounds!.height).toBeLessThan(plushBounds!.y);
    await dialog.getByRole("button", { name: "使用银灰", exact: true }).click();
    expect(await page.evaluate(() => localStorage.getItem("riic.agent.persona.selection.v1"))).toBe("silverash");
    const glow = dialog.locator('[data-cloud-card="glow-cloud"]');
    await glow.getByRole("button").click();
    await expect(glow.getByRole("button")).toHaveAttribute("aria-pressed", "true");
    await expect(glow).toHaveAttribute("data-persona-theme", "blue");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("riic.agent.persona.selection.v1"))).toBe("default");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(glow.locator("[data-motion]")).toHaveAttribute("data-motion", "paused");
    await page.keyboard.press("Escape");
    const composer = page.locator("[data-agent-composer] textarea");
    await composer.fill("云朵形象测试");
    const requestPromise = page.waitForRequest(request => request.url().includes("/api/agent/chat") && request.method() === "POST");
    await composer.press("Enter");
    expect((await requestPromise).postDataJSON().persona).toEqual({ kind: "none" });
    const reply = page.locator('[data-speaker="assistant"]').first();
    await expect(reply.locator('[data-cloud-avatar="glow-cloud"]')).toBeVisible();
    await expect(reply.locator("[data-agent-speaker-name]")).toHaveText("纯净模式");
    await page.reload();
    await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible({ timeout: 30_000 });
    await openAgentHistory(page, "云朵形象测试");
    await expect(reply.locator('[data-cloud-avatar="glow-cloud"]')).toBeVisible();
    await (await personaControl(page, "人格卡：纯净模式")).click();
    await expect(glow.getByRole("button")).toHaveAttribute("aria-pressed", "true");
    await dialog.getByRole("button", { name: "使用银灰", exact: true }).click();
    await expect(dialog.locator('[data-persona-card="silverash"]')).toHaveAttribute("data-selected", "true");
    await page.keyboard.press("Escape");
    await expect(reply.locator('[data-cloud-avatar="glow-cloud"]')).toBeVisible();
    await expect(reply.locator("[data-agent-speaker-name]")).toHaveText("纯净模式");
  });
}

test("cloud appearance still switches when browser storage rejects saving", async ({ page }) => {
  test.setTimeout(90_000);
  await prepare(page);
  await page.addInitScript(() => {
    localStorage.setItem("riic.plush.performance.v1", "static");
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === "riic.agent.appearance.v1") throw new DOMException("Quota exceeded", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  });
  await page.goto("/agent");
  await (await personaControl(page, "人格卡：可露希尔")).click();
  const dialog = page.getByRole("dialog", { name: "人格卡", exact: true });
  await dialog.getByRole("button", { name: "使用 纯净模式", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("浏览器未能保存");
  await page.keyboard.press("Escape");
  await (await personaControl(page, "人格卡：纯净模式")).click();
  await expect(dialog.locator('[data-cloud-card="glow-cloud"] button')).toHaveAttribute("aria-pressed", "true");
});

test("cloud appearance persists across locales with a compact header", async ({ page }) => {
  test.setTimeout(120_000);
  await prepare(page);
  await page.addInitScript(() => localStorage.setItem("riic.plush.performance.v1", "static"));
  await page.route("**/api/agent/chat", route => route.fulfill({ json: { success: true, data: { enabled: false } } }));
  await page.goto("/agent?ui_locale=zh-TW");
  await page.getByRole("button", { name: "人格卡：可露希爾", exact: true }).click();
  await page.getByRole("button", { name: "使用 純淨模式", exact: true }).click();
  await page.goto("/agent?ui_locale=en");
  await page.getByRole("button", { name: /^Persona[:：] ?Pure mode$/, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Persona", exact: true });
  await expect(dialog.getByRole("button", { name: "Use Pure mode", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(dialog.getByRole("tablist")).toHaveCount(0);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(dialog.locator('[data-persona-card="default"] [data-fur-avatar="closure"]')).toHaveCount(1);
});

test("legacy vinyl preference opens Closure and keyboard selection restores plush", async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => {
    localStorage.setItem("riic.plush.performance.v1", "static");
    localStorage.setItem("riic.agent.closure-appearance.v1", "vinyl");
  });
  await page.goto("/agent");
  await (await personaControl(page, "人格卡：可露希尔")).click();
  const dialog = page.getByRole("dialog", { name: "人格卡", exact: true });
  await expect(dialog.locator('[data-cloud-card="frost-cloud"] button')).toHaveAttribute("aria-pressed", "true");
  const plush = dialog.locator('[data-persona-card="default"] button');
  await plush.focus();
  await page.keyboard.press("Enter");
  await expect(plush).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.locator('[data-cloud-card="frost-cloud"] button')).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => localStorage.getItem("riic.agent.appearance.v1"))).toBe("plush");
});

test("cloud illustrations animate and honor a live reduced-motion change", async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => localStorage.setItem("riic.plush.performance.v1", "static"));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/agent");
  await (await personaControl(page, "人格卡：可露希尔")).click();
  const cloud = page.locator('[data-cloud-card="frost-cloud"] [role="img"]');
  const floating = cloud.locator("svg > g");
  await expect(cloud).toHaveAttribute("data-motion", "running");
  await expect(floating).toHaveAttribute("transform", /translate/);
  const initial = await floating.getAttribute("transform");
  await cloud.hover();
  await cloud.click();
  await expect.poll(() => floating.getAttribute("transform")).not.toBe(initial);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(cloud).toHaveAttribute("data-motion", "paused");
  const transforms = await floating.evaluate(element => new Promise<(string | null)[]>(resolve => {
    const values: (string | null)[] = [];
    const sample = () => {
      values.push(element.getAttribute("transform"));
      if (values.length === 8) resolve(values);
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
  expect(new Set(transforms).size).toBe(1);
});

test("switching personas preserves reply avatars in old and restored conversations", async ({ page }) => {
  test.setTimeout(120_000);
  await prepare(page);
  await page.goto("/agent");
  const oldReply = page.locator('[data-speaker="assistant"]').first();
  const composer = page.locator("[data-agent-composer] textarea");
  await composer.fill("旧对话问题");
  await composer.press("Enter");
  await expect(oldReply.locator("[data-agent-speaker-name]")).toHaveText("可露希尔");
  await (await personaControl(page, "人格卡：可露希尔")).click();
  await page.getByRole("button", { name: "使用银灰", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(oldReply.locator('[data-fur-avatar="closure"]')).toHaveCount(1);
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await composer.fill("新对话问题");
  await composer.press("Enter");
  await expect(oldReply.locator("[data-agent-speaker-name]")).toHaveText("银灰");
  await expect(oldReply.locator('[data-fur-avatar="silverash"]')).toHaveCount(1);
  await page.reload();
  await openAgentHistory(page, "新对话问题");
  await expect(oldReply.locator("[data-agent-speaker-name]")).toHaveText("银灰");
  await page.locator("[data-agent-history]").getByRole("link", { name: "旧对话问题", exact: true }).click();
  await expect(oldReply.locator("[data-agent-speaker-name]")).toHaveText("可露希尔");
  await expect(oldReply.locator('[data-fur-avatar="closure"]')).toHaveCount(1);
  await page.reload();
  await openAgentHistory(page, "旧对话问题");
  await expect(oldReply.locator("[data-agent-speaker-name]")).toHaveText("可露希尔");
});

async function prepare(page: Page, available = true) {
  // Preserve the authored rendering budget for the existing pixel assertions.
  await page.addInitScript(() => localStorage.setItem("riic.plush.performance.v1", "quality"));
  await mockApis(page);
  await page.route("**/api/account/data-consent", route => route.fulfill({ json: { success: true, data: { current: false, cloudSyncEnabled: false } } }));
  await page.route("**/api/billing", route => route.fulfill({ json: { data: { wallet: { totalPoints: 100 } } } }));
  await page.route("**/api/auth/get-session", route => route.fulfill({ json: {
    user: { id: "persona-user", name: "博士", email: "persona@example.test" },
    session: { expiresAt: "2099-01-01T00:00:00Z" },
  } }));
  await page.route("**/api/agent/chat", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: {
      success: true, data: { enabled: true, personas: available ? [{ id: "silverash" }, { id: "exusiai" }, { id: "saileach" }, { id: "mountain" }] : [] },
    } });
    const parts = [
      { type: "start", messageId: "silverash-reply" },
      { type: "text-start", id: "reply" },
      { type: "text-delta", id: "reply", delta: route.request().postDataJSON()?.persona?.id === "mountain" ? "我在，博士。先把条件核实清楚，再做决定。" : route.request().postDataJSON()?.persona?.id === "saileach" ? "博士，我们先整理条件，再一起看。" : route.request().postDataJSON()?.persona?.id === "exusiai" ? "老板，收到！我们先把最要紧的事情处理好。" : "盟友，我们先明确目标，再权衡取舍。" },
      { type: "text-end", id: "reply" },
      { type: "finish", finishReason: "stop" },
    ];
    return route.fulfill({ contentType: "text/event-stream", headers: { "x-vercel-ai-ui-message-stream": "v1" },
      body: parts.map(part => `data: ${JSON.stringify(part)}\n\n`).join("") + "data: [DONE]\n\n" });
  });
}

for (const mobile of [false, true]) {
test(`SilverAsh portrait keeps its scale and center when hovered (${mobile ? "mobile" : "desktop"})`, async ({ page }) => {
  test.setTimeout(90_000);
  await prepare(page);
  await page.setViewportSize(mobile ? { width: 375, height: 812 } : { width: 1280, height: 900 });
  await page.goto("/agent");
  await (await personaControl(page, "人格卡：可露希尔")).click();
  const avatar = page.locator('[data-persona-card="silverash"] [data-fur-avatar="silverash"]');
  await avatar.scrollIntoViewIfNeeded();
  await expect(avatar).toHaveAttribute("data-fur-ready", "true", { timeout: 30_000 });
  await page.mouse.move(0, 0);
  await expect(avatar).toHaveAttribute("data-fur-motion", "idle");
  const silhouette = () => avatar.locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
    const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    let left = canvas.width, right = 0, top = canvas.height, bottom = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 100) continue;
      const x = i / 4 % canvas.width, y = Math.floor(i / 4 / canvas.width);
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    return { width: (right - left) / canvas.width, height: (bottom - top) / canvas.height, center: (right + left) / 2 / canvas.width };
  });
  const before = await silhouette();
  expect(before.width).toBeGreaterThan(0.6);
  expect(before.height).toBeGreaterThan(0.4);
  const bounds = (await avatar.boundingBox())!;
  const samples = [];
  for (const [x, y] of [[0.9, 0.5], [0.1, 0.5], [0.5, 0.1], [0.5, 0.9]]) {
    const frames = Number(await avatar.getAttribute("data-fur-frames"));
    await avatar.hover({ position: { x: bounds.width * x, y: bounds.height * y } });
    await expect.poll(async () => Number(await avatar.getAttribute("data-fur-frames"))).toBeGreaterThan(frames);
    await expect(avatar).toHaveAttribute("data-fur-motion", "idle");
    const after = await silhouette();
    samples.push({ x, y, ...after });
    expect(Math.abs(after.width - before.width)).toBeLessThan(0.04);
    expect(Math.abs(after.height - before.height)).toBeLessThan(0.04);
    expect(Math.abs(after.center - before.center)).toBeLessThan(0.025);
  }
  let completedFps: number | undefined;
  // Opt-in same-device benchmark; driver input round trips are not a portable
  // FPS gate. The four silhouette regressions above always run on every engine.
  if (process.env.PLUSH_BENCHMARK === "1") {
    const startFrames = Number(await avatar.getAttribute("data-fur-frames"));
    const started = Date.now();
    for (let step = 0; step < 60; step++) {
      await page.mouse.move(bounds.x + bounds.width * (0.5 + Math.sin(step * 0.3) * 0.4), bounds.y + bounds.height * 0.5);
      await page.waitForTimeout(50);
    }
    completedFps = (Number(await avatar.getAttribute("data-fur-frames")) - startFrames) * 1000 / (Date.now() - started);
  }
  const metrics = await avatar.evaluate(root => ({ ...((root as HTMLElement).dataset) }));
  await test.info().attach("portrait-render-metrics", { body: JSON.stringify({ before, samples, ...metrics, completedFps }, null, 2), contentType: "application/json" });
});
}

for (const mobile of [false, true]) {
  test(`SilverAsh selection, private prompt request and persistence (${mobile ? "mobile" : "desktop"})`, async ({ page }) => {
    // This flow reloads three times and opens four real WebGL persona pickers.
    // Include cold shader compilation on software GPUs, while retaining every assertion.
    test.setTimeout(60_000);
    await page.setViewportSize(mobile ? { width: 375, height: 812 } : { width: 1280, height: 900 });
    await prepare(page);
    await page.addInitScript(upload => localStorage.setItem("riic.agent.persona.v1", JSON.stringify(upload)), savedUpload);
    await page.goto("/agent");
    const selector = (await personaControl(page, "人格卡：原有人格"));
    await expect(selector).toBeVisible({ timeout: 30_000 });
    await selector.click();
    const card = page.locator('[data-persona-card="silverash"]');
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveCSS("--dialogue-accent", "#84bfff");
    await expect(card.locator("[data-silverash-fur-avatar]")).toHaveAttribute("data-fur-ready", "true");
    await expect(card.locator("img:visible")).toHaveCount(0);
    await card.getByRole("button", { name: "使用银灰" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^(关闭|關閉|Close)$/, exact: true }).click();
    await expect(page.locator("[data-agent-chat]")).toHaveCSS("--dialogue-accent", "#84bfff");
    await expect(page.getByText("盟友，从哪件事开始？")).toBeVisible();
    const input = page.getByRole("textbox", { name: "发给银灰的消息" });
    await input.fill("你好");
    const request = page.waitForRequest(request => request.url().endsWith("/api/agent/chat") && request.method() === "POST");
    await input.press("Enter");
    expect((await request).postDataJSON().persona).toEqual({ id: "silverash", kind: "builtin" });
    const reply = page.locator('[data-speaker="assistant"]');
    await expect(reply.locator("[data-agent-speaker-name]")).toHaveText("银灰");
    await expect(reply.locator("[data-silverash-fur-avatar]")).toHaveAttribute("data-fur-ready", "true");
    const pixels = await reply.locator("[data-silverash-fur-avatar] canvas").evaluate((canvas: HTMLCanvasElement) => {
      const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
      let light = 0, dark = 0, tinted = 0, tail = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index + 3] < 200) continue;
        const [r, g, b] = data.slice(index, index + 3);
        if (Math.min(r, g, b) > 160) light++;
        if (Math.max(r, g, b) < 110) dark++;
        if (Math.max(r, g, b) - Math.min(r, g, b) > 25) tinted++;
        if ((index / 4) % canvas.width > canvas.width * 0.79) tail++;
      }
      return { light, dark, tinted, tail };
    });
    expect(pixels.light).toBeGreaterThan(40);
    expect(pixels.dark).toBeGreaterThan(2);
    expect(pixels.tinted).toBe(0);
    expect(pixels.tail).toBeGreaterThan(2);
    await expect((await personaControl(page, "人格卡：银灰"))).toBeEnabled();
    await page.reload();
    await expect((await personaControl(page, "人格卡：银灰"))).toBeVisible({ timeout: 30_000 });
    await (await personaControl(page, "人格卡：银灰")).click();
    await expect(page.locator('[data-persona-card="upload-existing"]')).toContainText("原有人格");
    await page.getByRole("button", { name: "使用可露希尔", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^(关闭|關閉|Close)$/, exact: true }).click();
    await expect(page.locator("[data-agent-chat]")).toHaveCSS("--dialogue-accent", "#bd354b");
    await expect(page.locator('[data-agent-chat] h1 > span[aria-hidden="true"]')).toHaveCSS("background-color", "rgb(189, 53, 75)");
    await page.reload();
    await expect((await personaControl(page, "人格卡：可露希尔"))).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("riic.agent.persona.v1")!))).toEqual(savedUpload);
    await (await personaControl(page, "人格卡：可露希尔")).click();
    await page.getByRole("button", { name: "使用原有人格" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^(关闭|關閉|Close)$/, exact: true }).click();
    await expect((await personaControl(page, "人格卡：原有人格"))).toBeVisible();
  });
}

test("a missing private card explains why sending is blocked and permits switching back", async ({ page }) => {
  await prepare(page, false);
  await page.addInitScript(() => localStorage.setItem("riic.agent.persona.selection.v1", "silverash"));
  await page.goto("/agent");
  await expect(page.locator("[data-agent-chat]").getByRole("alert")).toContainText("所选人格卡暂不可用", { timeout: 30_000 });
  await page.getByRole("textbox", { name: "发给银灰的消息" }).fill("你好");
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
  await (await personaControl(page, "人格卡：银灰")).click();
  await page.getByRole("button", { name: "使用可露希尔", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^(关闭|關閉|Close)$/, exact: true }).click();
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
});

test("five plush characters share a single WebGL renderer", async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    const allocated = new WeakSet<HTMLCanvasElement>();
    Object.assign(window, { personaWebglContexts: 0 });
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (args[0] === "webgl2" && !allocated.has(this)) {
        allocated.add(this);
        (window as typeof window & { personaWebglContexts: number }).personaWebglContexts++;
      }
      return original.apply(this, args);
    } as typeof original;
  });
  await page.goto("/agent");
  await (await personaControl(page, "人格卡：可露希尔")).click();
  const silverash = page.locator('[data-persona-card="silverash"] [data-silverash-fur-avatar]');
  await expect(silverash).toHaveAttribute("data-fur-ready", "true");
  await expect(page.locator('[data-persona-card="default"] [data-closure-fur-avatar]')).toHaveAttribute("data-fur-ready", "true");
  const angel = page.locator('[data-persona-card="exusiai"] [data-fur-avatar="exusiai"]');
  await angel.scrollIntoViewIfNeeded();
  await expect(angel).toHaveAttribute("data-fur-ready", "true");
  const willow = page.locator('[data-persona-card="saileach"] [data-fur-avatar="saileach"]');
  await willow.scrollIntoViewIfNeeded();
  await expect(willow).toHaveAttribute("data-fur-ready", "true");
  const tiger = page.locator('[data-persona-card="mountain"] [data-fur-avatar="mountain"]');
  await tiger.scrollIntoViewIfNeeded();
  await expect(tiger).toHaveAttribute("data-fur-ready", "true");
  expect(await page.evaluate(() => (window as typeof window & { personaWebglContexts: number }).personaWebglContexts)).toBe(1);
});

test("SilverAsh reacts to pointer input, settles, and respects reduced motion", async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => localStorage.setItem("riic.agent.persona.selection.v1", "silverash"));
  await page.goto("/agent");
  const input = page.getByRole("textbox", { name: "发给银灰的消息" });
  await input.fill("你好");
  await input.press("Enter");
  const silverash = page.locator('[data-speaker="assistant"] [data-silverash-fur-avatar]');
  await expect(silverash).toHaveAttribute("data-fur-ready", "true");
  const canvas = silverash.locator("canvas");
  const resting = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await silverash.hover({ position: { x: 8, y: 20 } });
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).not.toBe(resting);
  await page.mouse.down();
  await page.mouse.move(400, 280, { steps: 8 });
  await page.mouse.up();
  await input.hover();
  await expect(silverash).toHaveAttribute("data-fur-motion", "idle");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(silverash).toHaveAttribute("data-fur-motion", "still");
  const still = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await silverash.hover();
  await silverash.click();
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(still);
});

for (const mobile of [false, true]) {
  test(`Exusiai selection, shared red theme and plush rendering (${mobile ? "mobile" : "desktop"})`, async ({ page }) => {
    test.setTimeout(60_000); // Real shader compilation plus a full-page persistence reload.
    await page.setViewportSize(mobile ? { width: 375, height: 812 } : { width: 1280, height: 900 });
    const shaderErrors: string[] = [];
    page.on("console", message => {
      if (message.type() === "error" && /THREE|shader/i.test(message.text())) shaderErrors.push(message.text());
    });
    await prepare(page);
    await page.goto("/agent");
    await (await personaControl(page, "人格卡：可露希尔")).click();
    const card = page.locator('[data-persona-card="exusiai"]');
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveCSS("--dialogue-accent", "#bd354b");
    await expect(card.locator('[data-fur-avatar="exusiai"]')).toHaveAttribute("data-fur-ready", "true");
    await card.getByRole("button", { name: "使用能天使" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^(关闭|關閉|Close)$/, exact: true }).click();
    await expect(page.locator("[data-agent-chat]")).toHaveCSS("--dialogue-accent", "#bd354b");
    await expect(page.getByText("老板，今天有什么差事？")).toBeVisible();
    const input = page.getByRole("textbox", { name: "发给能天使的消息" });
    await input.fill("帮我看看今天的待办");
    const request = page.waitForRequest(request => request.url().endsWith("/api/agent/chat") && request.method() === "POST");
    await input.press("Enter");
    expect((await request).postDataJSON().persona).toEqual({ id: "exusiai", kind: "builtin" });
    const reply = page.locator('[data-speaker="assistant"]');
    await expect(reply.locator("[data-agent-speaker-name]")).toHaveText("能天使");
    const avatar = reply.locator('[data-fur-avatar="exusiai"]');
    await expect(avatar).toHaveAttribute("data-fur-ready", "true");
    const pixels = await avatar.locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
      const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
      let red = 0, halo = 0, wings = 0, leftEye = 0, rightEye = 0, face = 0;
      let haloPaleYellow = 0, haloYellow = 0, wingBlueMin = 255, wingBlueMax = 0;
      let haloMinX = canvas.width, haloMaxX = 0, haloMinY = canvas.height, haloMaxY = 0;
      for (let i = 0; i < data.length; i += 4) {
        const x = (i / 4) % canvas.width, y = Math.floor(i / 4 / canvas.width);
        if (data[i + 3] < 180) continue;
        const [r, g, b] = data.slice(i, i + 3);
        if (r > g * 1.3 && r > b * 1.2 && r > 100) red++;
        if (r > 225 && g > 190 && g < 235 && b > 145 && b < 195) face++;
        const yellow = r > 225 && g > 180 && b < 90;
        const accessory = r > 240 && g > 195;
        if (y < canvas.height * 0.40 && accessory) {
          halo++;
          if (g > 230 && b > 145 && b < 190) haloPaleYellow++;
          if (b < 110) haloYellow++;
          haloMinX = Math.min(haloMinX, x); haloMaxX = Math.max(haloMaxX, x);
          haloMinY = Math.min(haloMinY, y); haloMaxY = Math.max(haloMaxY, y);
        }
        if (y > canvas.height * 0.46 && y < canvas.height * 0.62 && x > canvas.width * 0.25 && x < canvas.width * 0.75 && yellow) {
          if (x < canvas.width * 0.5) leftEye++; else rightEye++;
        }
        if ((x < canvas.width * 0.20 || x > canvas.width * 0.80) && accessory) {
          wings++;
          // PBR reflections and downsampling shift absolute color bins. Check
          // the visible yellow-to-pale-yellow range, not an obsolete white tip.
          wingBlueMin = Math.min(wingBlueMin, b);
          wingBlueMax = Math.max(wingBlueMax, b);
        }
      }
      // Sample the space between each gradient diamond and the red body, at any size.
      const middle = Math.floor(canvas.height * 0.53);
      const row = Array.from({ length: canvas.width }, (_, x) => {
        const i = (middle * canvas.width + x) * 4;
        return { x, r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
      });
      const accessories = row.filter(p => p.a > 180 && p.r > 240 && p.g > 195 && (p.x < canvas.width * 0.20 || p.x > canvas.width * 0.80));
      const body = row.filter(p => p.a > 180 && p.r > p.g * 1.3 && p.r > p.b * 1.2);
      const leftWing = Math.max(...accessories.filter(p => p.x < canvas.width / 2).map(p => p.x));
      const rightWing = Math.min(...accessories.filter(p => p.x > canvas.width / 2).map(p => p.x));
      const leftBody = Math.min(...body.map(p => p.x)), rightBody = Math.max(...body.map(p => p.x));
      const detachedLeft = row.some(p => p.x > leftWing && p.x < leftBody && p.a < 60);
      const detachedRight = row.some(p => p.x > rightBody && p.x < rightWing && p.a < 60);
      return { red, halo, wings, haloPaleYellow, haloYellow, wingBlueMin, wingBlueMax, leftEye, rightEye, eyeCoverage: leftEye / (canvas.width * canvas.height), face, detachedLeft, detachedRight, haloRatio: (haloMaxX - haloMinX) / Math.max(1, haloMaxY - haloMinY) };
    });
    expect(pixels.red).toBeGreaterThan(40);
    expect(pixels.halo).toBeGreaterThan(2);
    expect(pixels.wings).toBeGreaterThan(2);
    for (const key of ["haloPaleYellow", "haloYellow"] as const) expect(pixels[key], `${key}: ${JSON.stringify(pixels)}`).toBeGreaterThan(0);
    expect(pixels.wingBlueMin).toBeLessThan(165);
    expect(pixels.wingBlueMax - pixels.wingBlueMin).toBeGreaterThan(12);
    expect(pixels.wingBlueMax).toBeLessThan(225);
    expect(pixels.detachedLeft).toBe(true);
    expect(pixels.detachedRight).toBe(true);
    // Agent portraits have a smaller pixel budget than the full-quality gallery.
    expect(pixels.eyeCoverage).toBeGreaterThan(0.00075);
    expect(pixels.rightEye).toBe(0);
    expect(pixels.face).toBeGreaterThan(8);
    // The circular halo recedes behind the head; its horizontal axis stays level.
    expect(pixels.haloRatio).toBeGreaterThan(1.5);
    expect(pixels.haloRatio).toBeLessThan(4);
    expect(shaderErrors).toEqual([]);
    await page.reload();
    await expect((await personaControl(page, "人格卡：能天使"))).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-agent-chat]")).toHaveCSS("--dialogue-accent", "#bd354b");
  });
}

for (const mobile of [false, true]) {
  test(`Saileach selection, yellow theme and persistence (${mobile ? "mobile" : "desktop"})`, async ({ page }) => {
    test.setTimeout(60_000); // Real shader compilation plus a full-page persistence reload.
    await page.setViewportSize(mobile ? { width: 375, height: 812 } : { width: 1280, height: 900 });
    const shaderErrors: string[] = [];
    page.on("console", message => {
      if (message.type() === "error" && /THREE|shader/i.test(message.text())) shaderErrors.push(message.text());
    });
    await prepare(page);
    await page.goto("/agent");
    await (await personaControl(page, "人格卡：可露希尔")).click();
    const card = page.locator('[data-persona-card="saileach"]');
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveCSS("--dialogue-accent", "#ffd800");
    // First frame includes cold shaders and the shared queue of 40-shell portraits.
    await expect(card.locator('[data-fur-avatar="saileach"]')).toHaveAttribute("data-fur-ready", "true", { timeout: 30_000 });
    await card.getByRole("button", { name: "使用琴柳" }).click();
    await expect(card).toHaveAttribute("data-selected", "true");
    await expect(card).toHaveCSS("outline-width", "2px");
    await expect(page.locator('[data-persona-card="default"]')).not.toHaveAttribute("data-selected", "true");
    await page.getByRole("dialog").getByRole("button", { name: /^(关闭|關閉|Close)$/, exact: true }).click();
    await expect(page.locator("[data-agent-chat]")).toHaveCSS("--dialogue-accent", "#ffd800");
    await expect(page.getByText("博士，今天需要我帮您做些什么？")).toBeVisible();
    const input = page.getByRole("textbox", { name: "发给琴柳的消息" });
    await input.fill("帮我整理一下待办");
    const request = page.waitForRequest(request => request.url().endsWith("/api/agent/chat") && request.method() === "POST");
    await input.press("Enter");
    expect((await request).postDataJSON().persona).toEqual({ id: "saileach", kind: "builtin" });
    const reply = page.locator('[data-speaker="assistant"]');
    await expect(reply.locator("[data-agent-speaker-name]")).toHaveText("琴柳");
    const avatar = reply.locator('[data-fur-avatar="saileach"]');
    await expect(avatar).toHaveAttribute("data-fur-ready", "true");
    const pixels = await avatar.locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
      const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
      let gold = 0, blue = 0, navy = 0, horns = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 180) continue;
        const [r, g, b] = data.slice(i, i + 3);
        if (r > 170 && g > 140 && r > b + 50) gold++;
        if (b > 180 && g > r + 15 && b > r + 40) blue++;
        if (r < 110 && b > r + 20 && g < 140) navy++;
        const x = (i / 4) % canvas.width, y = Math.floor(i / 4 / canvas.width);
        if ((x < canvas.width * 0.25 || x > canvas.width * 0.75) && y < canvas.height * 0.5) horns++;
      }
      return { gold, blue, navy, horns };
    });
    expect(pixels.gold).toBeGreaterThan(40);
    for (const key of ["blue", "navy", "horns"] as const) expect(pixels[key], JSON.stringify(pixels)).toBeGreaterThan(2);
    expect(shaderErrors).toEqual([]);
    await page.reload();
    await expect((await personaControl(page, "人格卡：琴柳"))).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-agent-chat]")).toHaveCSS("--dialogue-accent", "#ffd800");
    await (await personaControl(page, "人格卡：琴柳")).click();
    const selected = page.getByRole("button", { name: "使用琴柳" });
    await expect(selected).toHaveAttribute("aria-pressed", "true");
    await expect(selected).toHaveText("琴柳");
    await selected.focus();
    await page.keyboard.press("Space");
    await expect(selected).toHaveAttribute("aria-pressed", "true");
    const columns = await page.locator('[data-persona-card="saileach"]').evaluate(element => getComputedStyle(element.parentElement!).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(mobile ? 2 : 4);
    await expect(page.getByRole("dialog").locator('[data-slot="dialog-footer"]')).toHaveCount(0);
    await page.getByRole("dialog").getByRole("button", { name: /^(关闭|關閉|Close)$/, exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });
}

for (const mobile of [false, true]) {
  test(`Mountain selection, striped plush and persistence (${mobile ? "mobile" : "desktop"})`, async ({ page }) => {
    test.setTimeout(60_000); // Real shader compilation plus a full-page persistence reload.
    await page.setViewportSize(mobile ? { width: 375, height: 812 } : { width: 1280, height: 900 });
    const shaderErrors: string[] = [];
    page.on("console", message => {
      if (message.type() === "error" && /THREE|shader/i.test(message.text())) shaderErrors.push(message.text());
    });
    await prepare(page);
    await page.goto("/agent");
    await (await personaControl(page, "人格卡：可露希尔")).click();
    const card = page.locator('[data-persona-card="mountain"]');
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveCSS("--dialogue-accent", "#84bfff");
    // First frame includes cold shaders and the shared queue of 40-shell portraits.
    await expect(card.locator('[data-fur-avatar="mountain"]')).toHaveAttribute("data-fur-ready", "true", { timeout: 30_000 });
    await card.getByRole("button", { name: "使用山", exact: true }).click();
    await expect(card).toHaveAttribute("data-selected", "true");
    await page.getByRole("dialog").getByRole("button", { name: /^(关闭|關閉|Close)$/, exact: true }).click();
    await expect(page.getByText("我在，博士。今天有什么需要处理？")).toBeVisible();
    await expect(page.locator("[data-agent-chat]")).toHaveCSS("--dialogue-accent", "#84bfff");
    const input = page.getByRole("textbox", { name: "发给山的消息" });
    await input.fill("帮我比较两套排班");
    const request = page.waitForRequest(request => request.url().endsWith("/api/agent/chat") && request.method() === "POST");
    await input.press("Enter");
    expect((await request).postDataJSON().persona).toEqual({ id: "mountain", kind: "builtin" });
    const reply = page.locator('[data-speaker="assistant"]');
    await expect(reply.locator("[data-agent-speaker-name]")).toHaveText("山");
    const avatar = reply.locator('[data-fur-avatar="mountain"]');
    await expect(avatar).toHaveAttribute("data-fur-ready", "true");
    const pixels = await avatar.locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
      const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
      let white = 0, dark = 0, blue = 0, cropped = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 180) continue;
        const [r, g, b] = data.slice(i, i + 3);
        if (Math.min(r, g, b) > 170 && Math.max(r, g, b) - Math.min(r, g, b) < 25) white++;
        if (Math.max(r, g, b) < 115) dark++;
        if (b > 145 && b > r + 30 && g > r + 20) blue++;
        const x = (i / 4) % canvas.width, y = Math.floor(i / 4 / canvas.width);
        if (x === 0 || y === 0 || x === canvas.width - 1 || y === canvas.height - 1) cropped++;
      }
      return { white, dark, blue, cropped };
    });
    expect(pixels.white).toBeGreaterThan(40);
    expect(pixels.dark).toBeGreaterThan(10);
    expect(pixels.blue).toBeGreaterThan(2);
    expect(pixels.cropped).toBe(0);
    expect(shaderErrors).toEqual([]);
    await page.reload();
    await expect((await personaControl(page, "人格卡：山"))).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-agent-chat]")).toHaveCSS("--dialogue-accent", "#84bfff");
  });
}

test("Mountain keeps a usable SVG fallback without WebGL", async ({ page }) => {
  await prepare(page);
  await page.route("**/images/plush/*.webp", route => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem("riic.agent.persona.selection.v1", "mountain");
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (args[0] === "webgl2") return null;
      return original.apply(this, args);
    } as typeof original;
  });
  await page.goto("/agent");
  await (await personaControl(page, "人格卡：山")).click();
  const avatar = page.locator('[data-persona-card="mountain"] [data-fur-avatar="mountain"]');
  await avatar.scrollIntoViewIfNeeded();
  await expect(avatar).toHaveAttribute("data-fur-performance", "static");
  await expect(avatar).toHaveAttribute("data-fur-ready", "false");
  await expect(avatar.locator("[data-mountain-fallback]")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: /^(关闭|關閉|Close)$/, exact: true }).click();
  await expect(page.getByRole("textbox", { name: "发给山的消息" })).toBeEnabled();
});

test("Mountain missing private card blocks sending and allows another persona", async ({ page }) => {
  await prepare(page, false);
  await page.addInitScript(() => localStorage.setItem("riic.agent.persona.selection.v1", "mountain"));
  await page.goto("/agent");
  await expect(page.locator("[data-agent-chat]").getByRole("alert")).toContainText("所选人格卡暂不可用", { timeout: 30_000 });
  await page.getByRole("textbox", { name: "发给山的消息" }).fill("你好");
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
  await (await personaControl(page, "人格卡：山")).click();
  await page.getByRole("button", { name: "使用可露希尔", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^(关闭|關閉|Close)$/, exact: true }).click();
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
});

test("Saileach has a usable SVG fallback without WebGL", async ({ page }) => {
  await prepare(page);
  await page.route("**/images/plush/*.webp", route => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem("riic.agent.persona.selection.v1", "saileach");
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (args[0] === "webgl2") return null;
      return original.apply(this, args);
    } as typeof original;
  });
  await page.goto("/agent");
  await (await personaControl(page, "人格卡：琴柳")).click();
  const avatar = page.locator('[data-persona-card="saileach"] [data-fur-avatar="saileach"]');
  await avatar.scrollIntoViewIfNeeded();
  await expect(avatar).toHaveAttribute("data-fur-performance", "static");
  await expect(avatar).toHaveAttribute("data-fur-ready", "false");
  await expect(avatar.locator("[data-saileach-fallback]")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: /^(关闭|關閉|Close)$/, exact: true }).click();
  await expect(page.getByRole("textbox", { name: "发给琴柳的消息" })).toBeEnabled();
});

test("Exusiai retains a halo and usable chat without WebGL", async ({ page }) => {
  await prepare(page);
  await page.route("**/images/plush/*.webp", route => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem("riic.agent.persona.selection.v1", "exusiai");
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (args[0] === "webgl2") return null;
      return original.apply(this, args);
    } as typeof original;
  });
  await page.goto("/agent");
  await (await personaControl(page, "人格卡：能天使")).click();
  const avatar = page.locator('[data-persona-card="exusiai"] [data-fur-avatar="exusiai"]');
  await avatar.scrollIntoViewIfNeeded();
  await expect(avatar).toHaveAttribute("data-fur-performance", "static");
  await expect(avatar).toHaveAttribute("data-fur-ready", "false");
  await expect(avatar.locator("[data-fur-fallback]")).toBeVisible();
  await expect(avatar.locator('[data-plush-halo]')).toBeVisible();
  await expect(avatar.locator('[data-plush-wings] path')).toHaveCount(6);
  await expect(avatar.locator('path[fill="#f1d4ac"]')).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: /^(关闭|關閉|Close)$/, exact: true }).click();
  await expect(page.getByRole("textbox", { name: "发给能天使的消息" })).toBeEnabled();
});

test("SilverAsh keeps its gray and white silhouette when WebGL is unavailable", async ({ page }) => {
  await prepare(page);
  await page.route("**/images/plush/*.webp", route => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem("riic.agent.persona.selection.v1", "silverash");
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (args[0] === "webgl2") return null;
      return original.apply(this, args);
    } as typeof original;
  });
  await page.goto("/agent");
  await (await personaControl(page, "人格卡：银灰")).click();
  const silverash = page.locator('[data-persona-card="silverash"] [data-silverash-fur-avatar]');
  await expect(silverash).toHaveAttribute("data-fur-performance", "static");
  await expect(silverash.locator("[data-fur-fallback]")).toBeVisible();
  await expect(silverash).toHaveAttribute("data-fur-ready", "false");
  await page.getByRole("dialog").getByRole("button", { name: /^(关闭|關閉|Close)$/, exact: true }).click();
  await expect(page.getByRole("textbox", { name: "发给银灰的消息" })).toBeEnabled();
});
