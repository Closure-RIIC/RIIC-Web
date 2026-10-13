import { expect, test, type Page } from "@playwright/test";
import { mockApis } from "./production-readiness.fixture";
import { accountOrbColor } from "../src/account-orb";

const ready = { success: true, data: { enabled: true, provider: "deepseek", model: "test-model", baseURL: "https://example.test/v1" } };
const reply = [
  { type: "start", messageId: "assistant-1" },
  { type: "start-step" },
  { type: "reasoning-start", id: "reasoning-1" },
  { type: "reasoning-delta", id: "reasoning-1", delta: "先检查账号的数据来源。" },
  { type: "reasoning-end", id: "reasoning-1" },
  { type: "tool-input-available", toolCallId: "tool-1", toolName: "diagnose_account", input: {} },
  { type: "tool-output-available", toolCallId: "tool-1", output: { skland: { connected: false, reason: "尚未绑定" }, operatorPool: { sourceName: "MAA", owned: 98, elite2: 32 } } },
  { type: "text-start", id: "text-1" },
  { type: "text-delta", id: "text-1", delta: "## 账号诊断\n\n你的干员池已读取，可以继续安排基建。" },
  { type: "text-end", id: "text-1" },
  { type: "finish-step" },
  { type: "finish", finishReason: "stop" },
].map((part) => `data: ${JSON.stringify(part)}\n\n`).join("") + "data: [DONE]\n\n";

async function mockWorkbench(page: Page, performanceMode: "quality" | "static" = "quality") {
  // Keep existing material/animation assertions on their authored budget;
  // performance-specific coverage opts into its own initial mode explicitly.
  await page.addInitScript(mode => localStorage.setItem("riic.plush.performance.v1", mode), performanceMode);
  await mockApis(page);
  await page.route("**/api/account/data-consent", route => route.fulfill({ json: { success: true, data: { current: false, cloudSyncEnabled: false } } }));
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: {
    user: { id: "agent-test-user", name: "测试博士", email: "agent@example.test" },
    session: { expiresAt: "2099-01-01T00:00:00Z" },
  } }));
}

test("Persona portraits keep Closure fixed and persist uploaded persona avatars", async ({ page }) => {
  await mockWorkbench(page);
  await page.addInitScript(() => localStorage.setItem("riic.agent.persona.closure.avatar.v1", "/images/operator-portraits/4195_radian.webp"));
  await page.route("**/api/agent/chat", (route) => route.request().method() === "GET"
    ? route.fulfill({ json: ready })
    : route.fulfill({ contentType: "text/event-stream", headers: { "x-vercel-ai-ui-message-stream": "v1" }, body: reply }));
  await page.goto("/agent");
  const input = page.getByRole("textbox", { name: "发给可露希尔的消息" });
  await input.fill("你好");
  await input.press("Enter");
  const assistantAvatar = page.locator('[data-speaker="assistant"] [data-agent-avatar]');
  await expect(assistantAvatar.locator("[data-closure-fur-avatar]")).toHaveAttribute("data-fur-ready", "true");
  await expect(assistantAvatar.locator("img:visible")).toHaveCount(0);
  await page.getByRole("button", { name: /人格卡：/ }).click();
  const avatarInput = page.getByLabel("上传人格卡头像", { exact: true });
  const preview = page.locator("[data-persona-avatar-settings]");
  await expect(avatarInput).toHaveCount(0);
  await expect(page.getByRole("button", { name: "上传头像", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重置头像", exact: true })).toHaveCount(0);
  await expect(preview.locator("[data-closure-fur-avatar]")).toHaveAttribute("data-fur-ready", "true");
  await page.getByLabel("上传人格卡文件", { exact: true }).setInputFiles({ name: "测试人格.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ name: "测试人格", content: "简洁回答。", avatarUrl: "/images/operator-portraits/4228_closur.webp" })) });
  await expect(page.getByRole("button", { name: "人格卡：测试人格" })).toBeVisible();
  await expect(assistantAvatar.locator("img")).toHaveAttribute("src", "/images/operator-portraits/4228_closur.webp");
  await page.getByRole("button", { name: /人格卡：/ }).click();
  await avatarInput.setInputFiles("public/images/operator-portraits/4228_closur.webp");
  await expect(preview.locator("img")).toHaveAttribute("src", /^data:image\/webp;base64,/);
  const customAvatar = await preview.locator("img").getAttribute("src");
  await avatarInput.setInputFiles({ name: "invalid.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("PNG、JPEG 或 WebP");
  await expect(preview.locator("img")).toHaveAttribute("src", customAvatar!);
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await expect(assistantAvatar.locator("img")).toHaveAttribute("src", customAvatar!);
  await page.getByRole("button", { name: /人格卡：/ }).click();
  await expect(preview.locator("img")).toHaveAttribute("src", customAvatar!);
  await page.getByRole("button", { name: "重置头像", exact: true }).click();
  await expect(preview.locator("img")).toHaveCount(0);
  await expect(preview.locator("[data-remote-avatar-state]")).toHaveText("测");
  await page.getByRole("button", { name: /可露希尔.*使用网站服务端/ }).click();
  await expect(assistantAvatar.locator("[data-closure-fur-avatar]")).toHaveAttribute("data-fur-ready", "true");
  await expect(assistantAvatar.locator("img:visible")).toHaveCount(0);
  await expect(avatarInput).toHaveCount(1);
  await expect(page.locator('[data-persona-card="default"]')).toHaveAttribute("data-selected", "true");
  await expect(page.locator('[data-persona-card^="upload-"]')).toContainText("测试人格");
  await expect(preview.locator("[data-closure-fur-avatar]")).toHaveAttribute("data-fur-ready", "true");
});

for (const width of [1440, 375]) {
  test(`Closure fur wings extend beyond the yellow ring and respect reduced motion at ${width}px`, async ({ page }, testInfo) => {
    await mockWorkbench(page);
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/agent/chat", (route) => route.request().method() === "GET"
      ? route.fulfill({ json: ready })
      : route.fulfill({ contentType: "text/event-stream", headers: { "x-vercel-ai-ui-message-stream": "v1" }, body: reply }));
    await page.goto("/agent");
    const input = page.getByRole("textbox", { name: "发给可露希尔的消息" });
    await input.fill("你好");
    await input.press("Enter");
    const ring = page.locator('[data-speaker="assistant"] [data-agent-avatar]');
    const mascot = ring.locator("[data-closure-fur-avatar]");
    await expect(mascot).toHaveAttribute("data-fur-ready", "true");
    await expect(ring).toHaveCSS("border-top-color", "rgb(189, 53, 75)");
    await expect(ring).toHaveCSS("width", width === 375 ? "32px" : "44px");
    await expect(mascot).toHaveAttribute("data-fur-motion", "idle");
    await expect(ring).toHaveCSS("overflow", "visible");
    const painted = await mascot.locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext("2d")!;
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const canvasBounds = canvas.getBoundingClientRect();
      const ringBounds = canvas.closest("[data-agent-avatar]")!.getBoundingClientRect();
      const ringLeft = (ringBounds.left - canvasBounds.left) / canvasBounds.width * canvas.width;
      const ringRight = (ringBounds.right - canvasBounds.left) / canvasBounds.width * canvas.width;
      let red = 0, leftWing = 0, rightWing = 0;
      let minX = canvas.width, maxX = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 180) continue;
        const x = (i / 4) % canvas.width;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x + 1);
        if (data[i] > 100 && data[i + 1] < 100 && data[i + 2] < 130) red++;
        if (x < ringLeft) leftWing++;
        if (x > ringRight) rightWing++;
      }
      return { red, leftWing, rightWing, leftOverflow: (ringLeft - minX) * canvasBounds.width / canvas.width, rightOverflow: (maxX - ringRight) * canvasBounds.width / canvas.width };
    });
    expect(painted.red).toBeGreaterThan(2);
    expect(painted.leftWing).toBeGreaterThan(2);
    expect(painted.rightWing).toBeGreaterThan(2);
    expect(painted.leftOverflow).toBeLessThanOrEqual(width === 375 ? 4 : 5);
    expect(painted.rightOverflow).toBeLessThanOrEqual(width === 375 ? 4 : 5);
    await testInfo.attach(`closure-avatar-${width}`, { body: await page.screenshot(), contentType: "image/png" });
    const resting = await mascot.locator("canvas").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
    await mascot.hover({ position: { x: 10, y: 14 } });
    await expect.poll(() => mascot.locator("canvas").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(resting);
    await page.mouse.down();
    await expect(mascot).toHaveAttribute("data-fur-motion", "animated");
    await page.mouse.move(200, 250, { steps: 8 });
    await page.mouse.up();
    await input.hover();
    await expect(mascot).toHaveAttribute("data-fur-motion", "idle");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(mascot).toHaveAttribute("data-fur-motion", "still");
    const still = await mascot.locator("canvas").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
    await mascot.hover();
    await mascot.click();
    expect(await mascot.locator("canvas").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(still);
    await page.reload();
    await expect(mascot).toHaveAttribute("data-fur-ready", "true");
    await expect(mascot).toHaveAttribute("data-fur-motion", "still");
  });
}

for (const unavailable of ["2d", "webgl2"]) {
test(`Closure keeps its two-color fallback when ${unavailable} is unavailable`, async ({ page }) => {
  await mockWorkbench(page);
  await page.route("**/images/plush/*.webp", route => route.abort());
  await page.addInitScript((unavailable) => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if ((unavailable === "2d" && this.closest("[data-closure-fur-avatar]")) || (unavailable === "webgl2" && args[0] === "webgl2")) return null;
      return original.apply(this, args);
    } as typeof original;
  }, unavailable);
  await page.route("**/api/agent/chat", (route) => route.request().method() === "GET"
    ? route.fulfill({ json: ready })
    : route.fulfill({ contentType: "text/event-stream", headers: { "x-vercel-ai-ui-message-stream": "v1" }, body: reply }));
  await page.goto("/agent");
  const input = page.getByRole("textbox", { name: "发给可露希尔的消息" });
  await input.fill("你好");
  await input.press("Enter");
  const mascot = page.locator('[data-speaker="assistant"] [data-closure-fur-avatar]');
  await expect(mascot).toHaveAttribute("data-fur-performance", "static");
  await expect(mascot.locator("[data-fur-fallback]")).toBeVisible();
  await expect(mascot).toHaveAttribute("data-fur-ready", "false");
  await expect(input).toBeEnabled();
});
}

test("Agent starts without WebGL in static mode and follows gallery performance changes", async ({ page, context }) => {
  test.setTimeout(90_000);
  await mockWorkbench(page, "static");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.assign(window, { staticWebglContexts: 0 });
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      // Fur uses WebGL2. The account FluidOrb independently uses WebGL1 and
      // is outside this portrait preference's scope.
      if (args[0] === "webgl2") {
        (window as typeof window & { staticWebglContexts: number }).staticWebglContexts++;
      }
      return original.apply(this, args);
    } as typeof original;
  });
  await page.route("**/api/agent/chat", route => route.request().method() === "GET"
    ? route.fulfill({ json: ready })
    : route.fulfill({ contentType: "text/event-stream", headers: { "x-vercel-ai-ui-message-stream": "v1" }, body: reply }));
  await page.goto("/agent");
  const input = page.getByRole("textbox", { name: "发给可露希尔的消息" });
  await input.fill("检查静态头像");
  await input.press("Enter");
  const avatar = page.locator('[data-speaker="assistant"] [data-closure-fur-avatar]');
  await expect(avatar).toHaveAttribute("data-fur-performance", "static");
  await expect(avatar.locator("img")).toBeVisible();
  await expect.poll(() => avatar.locator("img").evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(avatar.locator("canvas")).toHaveCount(0);
  expect(await page.evaluate(() => (window as typeof window & { staticWebglContexts: number }).staticWebglContexts)).toBe(0);

  // Change the public selector in a second tab to exercise the real cross-tab
  // storage subscription, rather than dispatching a private store event.
  const gallery = await context.newPage();
  await gallery.setViewportSize({ width: 256, height: 384 });
  await gallery.emulateMedia({ reducedMotion: "reduce" });
  await gallery.route("**/api/telemetry", route => route.fulfill({ json: { success: true } }));
  await gallery.goto("/plush");
  const mode = gallery.getByLabel("画质与耗电", { exact: true });
  await expect(mode).toHaveValue("static");
  await mode.selectOption("saver");
  await page.bringToFront();
  await expect(avatar).toHaveAttribute("data-fur-performance", "saver");
  await expect(avatar).toHaveAttribute("data-fur-ready", "true", { timeout: 30_000 });
  await expect(avatar).toHaveAttribute("data-fur-shells", "12");
  await expect(avatar.locator("canvas")).toHaveCount(1);
  await expect(avatar.locator("img:visible")).toHaveCount(0);
  await gallery.bringToFront();
  await mode.selectOption("static");
  await page.bringToFront();
  await expect(avatar).toHaveAttribute("data-fur-performance", "static");
  await expect(avatar.locator("canvas")).toHaveCount(0);
  await expect(avatar.locator("img")).toBeVisible();
  await expect(input).toBeEnabled();
  await gallery.close();
});

for (const width of [1440, 375]) {
  test(`Agent uses its sidebar group and real chat state at ${width}px`, async ({ page }) => {
    await mockWorkbench(page);
    let sent: { messages: Array<{ parts: Array<{ type: string; text?: string; filename?: string }> }>; persona?: { name: string } } | undefined;
    let remainingPoints = 1250;
    await page.route("**/api/billing", (route) => route.fulfill({ json: { success: true, data: { wallet: { totalPoints: remainingPoints } } } }));
    await page.route("**/api/agent/chat", (route) => {
      if (route.request().method() === "GET") return route.fulfill({ json: ready });
      sent = route.request().postDataJSON();
      remainingPoints = 1248;
      return route.fulfill({ contentType: "text/event-stream", headers: { "x-vercel-ai-ui-message-stream": "v1" }, body: reply });
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/account-health");
    await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
    const workbenchBounds = await page.locator("[data-account-health-page]").boundingBox();
    if (width < 768) await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    const group = page.locator('[data-slot="sidebar-group"]').filter({ hasText: "智能助理" });
    await group.getByRole("button", { name: "可露希尔助理", exact: true }).click();
    await expect(page).toHaveURL(/\/agent$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "博士，今天从哪里开始？" })).toBeVisible();
    for (const name of ["发送", "新对话"]) {
      const button = page.getByRole("button", { name, exact: true });
      await expect(button).toBeDisabled();
      await expect(button).toHaveCSS("opacity", "1");
      await expect(button).toHaveCSS("filter", "saturate(0.12)");
    }
    const balance = page.locator("[data-agent-credit-balance]");
    await expect(balance).toHaveText("剩余积分1,250");
    await expect(balance).toHaveAttribute("href", "/billing");
    await expect(page.getByText("当前对话", { exact: true })).toHaveCount(0);
    await expect(page.getByText("就绪", { exact: true })).toHaveCount(0);
    await expect(page.locator("[data-agent-runtime-info]")).toHaveCount(0);
    const balanceBounds = (await balance.boundingBox())!;
    const newChatBounds = (await page.getByRole("button", { name: "新对话", exact: true }).boundingBox())!;
    expect(balanceBounds.x + balanceBounds.width).toBeLessThan(newChatBounds.x);
    expect(Math.abs(balanceBounds.y - newChatBounds.y)).toBeLessThan(6);
    const newChatRadius = await page.getByRole("button", { name: "新对话", exact: true }).evaluate((el) => Number.parseFloat(getComputedStyle(el).borderTopLeftRadius));
    expect(newChatRadius).toBeGreaterThanOrEqual(newChatBounds.height / 2);
    const agentBounds = await page.locator("[data-agent-chat]").boundingBox();
    expect(Math.abs(agentBounds!.x - workbenchBounds!.x)).toBeLessThan(2);
    expect(Math.abs(agentBounds!.width - workbenchBounds!.width)).toBeLessThan(2);
    if (width >= 768) await expect(group.getByRole("button", { name: "可露希尔助理", exact: true })).toHaveAttribute("aria-current", "page");
    if (width < 768) await page.getByRole("button", { name: "附件与人格卡", exact: true }).click();
    await page.getByRole("button", { name: /人格卡：/ }).click();
    await page.getByLabel("上传人格卡文件", { exact: true }).setInputFiles({ name: "测试人格.md", mimeType: "text/markdown", buffer: Buffer.from("回答请使用简洁中文。") });
    if (width < 768) await page.getByRole("button", { name: "附件与人格卡", exact: true }).click();
    await expect(page.getByRole("button", { name: "人格卡：测试人格" })).toBeVisible();
    if (width < 768) await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /账号体检.*帮我看看/ }).click();
    const input = page.getByRole("textbox", { name: "发给测试人格的消息" });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("帮我看看账号现在什么水平");
    await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "发送", exact: true })).toHaveCSS("background-color", "rgb(255, 216, 0)");
    await page.locator('input[aria-label="上传附件"]').setInputFiles({ name: "说明.txt", mimeType: "text/plain", buffer: Buffer.from("测试附件") });
    if (width < 768) await page.getByRole("button", { name: "附件与人格卡，1 个附件", exact: true }).click();
    await expect(page.getByRole("button", { name: "移除 说明.txt" })).toBeVisible();
    if (width < 768) await page.keyboard.press("Escape");
    await input.press("Shift+Enter");
    await expect(input).toHaveValue(/\n/);
    await input.press("Enter");
    await expect(page.getByRole("heading", { name: "账号诊断", exact: true })).toBeVisible();
    await expect(balance).toHaveText("剩余积分1,248");
    const userMessage = page.locator('[data-speaker="user"]');
    const assistantMessage = page.locator('[data-speaker="assistant"]');
    await expect(userMessage.locator("[data-agent-speaker-name]")).toHaveText("测试博士");
    await expect(assistantMessage.locator("[data-agent-speaker-name]")).toHaveText("测试人格");
    await expect(page.locator("[data-agent-avatar]")).toHaveCount(2);
    await expect(page.locator("[data-agent-avatar]").first()).toHaveCSS("border-top-color", "rgb(255, 216, 0)");
    await expect(page.locator("[data-agent-avatar] img, [data-agent-avatar] svg")).toHaveCount(0);
    await expect(userMessage.locator('[data-slot="fluid-orb"]')).toHaveAttribute("data-account-orb-color", accountOrbColor("agent-test-user"));
    await expect(assistantMessage.locator('[data-slot="fluid-orb"]')).toHaveCount(0);
    const headingBounds = (await page.getByRole("heading", { name: width < 768 ? "可露希尔" : "可露希尔助理", exact: true }).boundingBox())!;
    const leftAvatar = (await assistantMessage.locator("[data-agent-avatar]").boundingBox())!;
    const rightAvatar = (await userMessage.locator("[data-agent-avatar]").boundingBox())!;
    expect(leftAvatar.width).toBe(width < 640 ? 32 : 44);
    expect(rightAvatar.width).toBe(leftAvatar.width);
    expect(Math.abs(leftAvatar.x - (width < 768 ? agentBounds!.x : headingBounds.x))).toBeLessThan(2);
    expect(Math.abs(rightAvatar.x + rightAvatar.width - newChatBounds.x - newChatBounds.width)).toBeLessThan(2);
    for (const [message, user] of [[userMessage, true], [assistantMessage, false]] as const) {
      const avatarElement = message.locator("[data-agent-avatar]");
      const avatar = (await avatarElement.boundingBox())!;
      await expect(avatarElement).toHaveCSS("padding", "0px");
      await expect(avatarElement).toHaveCSS("box-shadow", "none");
      const portrait = (await avatarElement.locator(":scope > :first-child").boundingBox())!;
      const ring = width < 640 ? 2 : 3;
      expect(portrait.width).toBe(avatar.width - ring * 2);
      expect(portrait.height).toBe(avatar.height - ring * 2);
      const bubble = (await message.locator("[data-agent-bubble]").boundingBox())!;
      if (user) expect(avatar.x).toBeGreaterThan(bubble.x + bubble.width);
      else expect(bubble.x).toBeGreaterThan(avatar.x + avatar.width);
    }
    expect(sent?.persona?.name).toBe("测试人格");
    expect(sent?.messages.at(-1)?.parts.some((part) => part.type === "file" && part.filename === "说明.txt")).toBe(true);
    await expect(page.getByRole("button", { name: "移除 说明.txt" })).toHaveCount(0);
    await page.getByText("思考过程", { exact: true }).click();
    await expect(page.getByText("先检查账号的数据来源。", { exact: true })).toBeVisible();
    await expect(page.locator("[data-agent-bubble] [data-agent-thinking], [data-agent-bubble] [data-agent-tool]")).toHaveCount(0);
    const tool = page.locator('[data-agent-tool="diagnose_account"]');
    await expect(tool.getByRole("button", { name: "账号数据诊断 完成" })).toHaveCSS("font-size", "11px");
    await expect(page.locator("[data-agent-thinking]").getByRole("button")).toHaveCSS("min-height", "28px");
    await tool.getByRole("button", { name: "账号数据诊断 完成" }).click();
    await expect(tool.getByText("干员池：MAA · 干员 98 / 精二 32")).toBeVisible();
    await expect(page.getByRole("button", { name: "复制回答" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const composer = await page.locator("[data-agent-prompt-bar]").boundingBox();
    const panel = await page.locator("[data-agent-panel]").boundingBox();
    expect(composer!.x).toBeGreaterThanOrEqual(panel!.x);
    expect(composer!.x + composer!.width).toBeLessThanOrEqual(panel!.x + panel!.width + 1);
    for (const selector of ["[data-agent-panel]", "[data-agent-composer]"]) {
      expect(await page.locator(selector).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    }
    const conversation = page.getByRole("region", { name: "对话记录", exact: true });
    expect(await conversation.evaluate((el) => getComputedStyle(el.parentElement!).backgroundImage)).toBe("none");
    expect(await conversation.evaluate((el) => getComputedStyle(el.parentElement!).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    for (const edge of ["::before", "::after"]) {
      const edgeStyle = await conversation.evaluate((el, pseudo) => {
        const style = getComputedStyle(el.parentElement!, pseudo);
        return { blur: style.backdropFilter, mask: style.maskImage, pointerEvents: style.pointerEvents, height: style.height };
      }, edge);
      expect(edgeStyle.blur).toBe("blur(3px)");
      expect(edgeStyle.mask).toContain("linear-gradient");
      expect(edgeStyle.pointerEvents).toBe("none");
      expect(edgeStyle.height).toBe(width < 640 ? "16px" : "24px");
    }
    await expect(page.locator("[data-agent-prompt-bar]")).toHaveCSS("filter", "none");
    await expect(assistantMessage.locator("[data-agent-bubble]")).toHaveCSS("border-top-width", "0px");
    const glassStyle = (element: Element) => { const style = getComputedStyle(element); return { background: style.backgroundImage, mask: style.maskImage }; };
    const composerGlass = await page.locator("[data-agent-prompt-bar] [data-agent-glass]").evaluate(glassStyle);
    expect(await assistantMessage.locator("[data-agent-glass]").evaluate(glassStyle)).toEqual(composerGlass);
    expect(await userMessage.locator("[data-agent-glass]").evaluate(glassStyle)).toEqual(composerGlass);
    expect(await page.locator("[data-agent-prompt-bar]").evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");
    expect(await page.locator("[data-agent-prompt-bar]").evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
    const conversationBounds = (await conversation.boundingBox())!;
    expect(conversationBounds.y + conversationBounds.height).toBeLessThanOrEqual(composer!.y);
    expect(composer!.y + composer!.height).toBeLessThanOrEqual(900);
    await page.getByRole("button", { name: "新对话", exact: true }).click();
    await expect(page.getByRole("heading", { name: "博士，今天从哪里开始？" })).toBeVisible();
    await expect(tool).toHaveCount(0);
    await page.reload();
    if (width < 768) await page.getByRole("button", { name: "附件与人格卡", exact: true }).click();
    await expect(page.getByRole("button", { name: "人格卡：测试人格" })).toBeVisible();
  });
}

for (const width of [1440, 375]) {
  test(`Agent bubbles fit short replies and wrap long replies at ${width}px`, async ({ page }) => {
    await mockWorkbench(page);
    await page.setViewportSize({ width, height: 900 });
    let replyIndex = 0;
    const answers = ["收到。", "先根据已有干员和资源安排培养顺序，再逐步补齐队伍。".repeat(12)];
    await page.route("**/api/agent/chat", (route) => {
      if (route.request().method() === "GET") return route.fulfill({ json: ready });
      const index = replyIndex++;
      const chunks = [{ type: "start", messageId: `sizing-${index}` }, { type: "start-step" }, { type: "text-start", id: "text" }, { type: "text-delta", id: "text", delta: answers[index] }, { type: "text-end", id: "text" }, { type: "finish-step" }, { type: "finish", finishReason: "stop" }];
      return route.fulfill({ contentType: "text/event-stream", headers: { "x-vercel-ai-ui-message-stream": "v1" }, body: chunks.map((part) => `data: ${JSON.stringify(part)}\n\n`).join("") + "data: [DONE]\n\n" });
    });
    await page.goto("/agent");
    const input = page.getByRole("textbox", { name: "发给可露希尔的消息" });
    const bubbles = page.locator('[data-speaker="assistant"] [data-agent-bubble]');
    await input.fill("简短回答");
    await input.press("Enter");
    await expect(bubbles).toHaveCount(1);
    await expect(bubbles.first().locator("[data-agent-streaming-text]")).toHaveAttribute("data-streaming", "false");
    const shortBounds = (await bubbles.first().boundingBox())!;
    expect(shortBounds.width).toBeLessThan(250);
    await input.fill("详细回答");
    await input.press("Enter");
    await expect(bubbles).toHaveCount(2);
    await expect(bubbles.last().locator("[data-agent-streaming-text]")).toHaveAttribute("data-streaming", "false");
    const longBounds = (await bubbles.last().boundingBox())!;
    expect(longBounds.width).toBeGreaterThan(shortBounds.width + 40);
    expect(longBounds.height).toBeGreaterThan(shortBounds.height);
    expect(await bubbles.last().evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

for (const [status, message] of [[401, "登录后，与可露希尔开始对话"], [402, "补充积分，开始对话"], [503, "暂时无法连接助理"]] as const) {
  test(`Agent handles access status ${status}`, async ({ page }) => {
    await mockWorkbench(page);
    await page.route("**/api/agent/chat", (route) => route.fulfill({ status, json: { success: false } }));
    await page.goto("/agent");
    await expect(page.getByRole("heading", { name: message })).toBeVisible();
    await expect(page.locator("[data-agent-prompt-bar]")).toHaveCount(0);
  });
}

test("Agent can retry a failed answer and stop a pending request", async ({ page }) => {
  await mockWorkbench(page);
  let requests = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/agent/chat", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: ready });
    requests += 1;
    if (requests === 1) return route.fulfill({ status: 500, body: "测试：服务暂不可用" });
    if (requests === 3) await gate;
    await route.fulfill({ contentType: "text/event-stream", headers: { "x-vercel-ai-ui-message-stream": "v1" }, body: reply });
  });
  try {
    await page.goto("/agent");
    const input = page.getByRole("textbox", { name: "发给可露希尔的消息" });
    await input.fill("检查账号");
    await input.press("Enter");
    await expect(page.locator("[data-agent-chat]").getByRole("alert")).toContainText("测试：服务暂不可用");
    await page.getByRole("button", { name: "重试回答" }).click();
    await expect(page.getByRole("heading", { name: "账号诊断", exact: true })).toBeVisible();
    await input.fill("继续");
    await input.press("Enter");
    await page.getByRole("button", { name: "停止", exact: true }).click();
    await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0);
    await expect(input).toBeEditable();
  } finally { release(); }
});

async function verifyConversationScrolling(page: Page, width: number) {
  await mockWorkbench(page);
  await page.setViewportSize({ width, height: 900 });
  const longAnswer = Array.from({ length: 45 }, (_, i) => `第 ${i + 1} 段：这是用于检查对话滚动区域的长回复。`).join("\n\n");
  await page.route("**/api/agent/chat", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: ready });
    const chunks = [
      { type: "start", messageId: "long-answer" }, { type: "start-step" },
      { type: "text-start", id: "long-text" }, { type: "text-delta", id: "long-text", delta: longAnswer },
      { type: "text-end", id: "long-text" }, { type: "finish-step" }, { type: "finish", finishReason: "stop" },
    ];
    return route.fulfill({ contentType: "text/event-stream", headers: { "x-vercel-ai-ui-message-stream": "v1" }, body: chunks.map((part) => `data: ${JSON.stringify(part)}\n\n`).join("") + "data: [DONE]\n\n" });
  });
  await page.goto("/agent");
  const input = page.getByRole("textbox", { name: "发给可露希尔的消息" });
  await input.fill("给我一段长回复");
  await input.press("Enter");
  const conversation = page.getByRole("region", { name: "对话记录", exact: true });
  await expect(conversation).toHaveAttribute("data-yeye-scroll", "y");
  await expect(conversation.locator(".os-scrollbar-vertical")).toHaveCount(0);
  const pageScrollbar = page.locator("[data-agent-page-scrollbar] .os-scrollbar-vertical");
  await expect(pageScrollbar).toHaveCount(1);
  const scrollbarBounds = (await pageScrollbar.boundingBox())!;
  expect(Math.abs(scrollbarBounds.x + scrollbarBounds.width - width)).toBeLessThanOrEqual(1);
  expect(scrollbarBounds.y).toBe(0);
  expect(scrollbarBounds.height).toBe(900);
  await expect(page.locator("[data-agent-streaming-text]")).toHaveAttribute("data-streaming", "false");
  await expect(page.locator("[data-agent-streaming-text]")).toContainText("第 45 段");
  await expect.poll(() => conversation.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(80);
  const composer = await page.locator("[data-agent-prompt-bar]").boundingBox();
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(900);
  await page.reload();
  await expect(input).toBeVisible();
  await expect(page.locator("[data-agent-streaming-text]")).toContainText("第 45 段");
  await expect.poll(() => conversation.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(80);
  await conversation.hover();
  await page.mouse.wheel(0, -700);
  await expect.poll(() => conversation.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeGreaterThan(300);
  await expect(input).toBeVisible();
  // The relocated track still drives the original viewport and supports dragging.
  await conversation.hover();
  const handle = pageScrollbar.locator(".os-scrollbar-handle");
  await expect(handle).toBeVisible();
  const handleBounds = (await handle.boundingBox())!;
  await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(width - 3, 10, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => conversation.evaluate((el) => el.scrollTop)).toBeLessThan(80);
  await page.goto("/mastery");
  await expect(page.locator("[data-agent-page-scrollbar]")).toHaveCount(0);
}

test("Agent uses the shared scrollbar and keeps its composer visible with long answers", async ({ page }) => {
  await verifyConversationScrolling(page, 1440);
});

test.describe("Agent on a touch screen", () => {
  test.use({ hasTouch: true, isMobile: true });
  test("Agent keeps the shared scrollbar at the phone edge", async ({ page }) => {
    await verifyConversationScrolling(page, 375);
  });
});
