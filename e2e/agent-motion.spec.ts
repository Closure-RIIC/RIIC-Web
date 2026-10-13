import { expect, test, type Page } from "@playwright/test";
import { mockApis } from "./production-readiness.fixture";

async function prepare(page: Page) {
  // These existing motion regressions exercise continuous high-quality avatars.
  await page.addInitScript(() => localStorage.setItem("riic.plush.performance.v1", "quality"));
  await mockApis(page);
  await page.route("**/api/account/data-consent", route => route.fulfill({ json: { success: true, data: { current: false, cloudSyncEnabled: false } } }));
  await page.route("**/api/billing", route => route.fulfill({ json: { data: { wallet: { totalPoints: 100 } } } }));
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: {
    user: { id: "motion-user", name: "博士", email: "motion@example.test" }, session: { expiresAt: "2099-01-01T00:00:00Z" },
  } }));
  await page.route("**/api/agent/chat", (route) => route.fulfill({ json: { success: true, data: { enabled: true, provider: "deepseek", model: "test" } } }));
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const streamWindow = window as typeof window & { agentTestStream?: (parts: unknown[], done: boolean) => void; agentTestRequests: number; agentTestBodies: unknown[]; agentTestAborts: number };
    streamWindow.agentTestRequests = 0;
    streamWindow.agentTestBodies = [];
    streamWindow.agentTestAborts = 0;
    window.fetch = async (input, init) => {
      if (!String(input).includes("/api/agent/chat") || init?.method !== "POST") return originalFetch(input, init);
      streamWindow.agentTestRequests++;
      streamWindow.agentTestBodies.push(JSON.parse(String(init.body)));
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        streamWindow.agentTestStream = (parts, done) => {
          for (const part of parts) controller.enqueue(encoder.encode(`data: ${JSON.stringify(part)}\n\n`));
          if (done) { controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close(); }
        };
        init.signal?.addEventListener("abort", () => { streamWindow.agentTestAborts++; controller.error(new DOMException("Aborted", "AbortError")); }, { once: true });
      } });
      return new Response(body, { headers: { "Content-Type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" } });
    };
  });
}

async function emit(page: Page, parts: unknown[], done = false) {
  await page.evaluate(({ parts, done }) => {
    (window as typeof window & { agentTestStream: (parts: unknown[], done: boolean) => void }).agentTestStream(parts, done);
  }, { parts, done });
}

test("revoking feature access removes navigation and stops the active conversation", async ({ page }) => {
  await prepare(page);
  let allowed = true;
  await page.route("**/api/account/feature-access", (route) => route.fulfill({ json: { agent: allowed, billing: allowed } }));
  await page.goto("/agent");
  const input = page.getByRole("textbox", { name: "发给可露希尔的消息" });
  await input.fill("等待权限检查");
  await input.press("Enter");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { agentTestRequests: number }).agentTestRequests)).toBe(1);
  allowed = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("[data-agent-chat]")).toHaveCount(0);
  await expect(page.locator('[data-primary-navigation-page="agent"], [data-primary-navigation-page="billing"], [data-agent-history]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { agentTestAborts: number }).agentTestAborts)).toBe(1);
});

for (const variant of ["closure", "silverash"]) {
test(`${variant} animates only the latest reply avatar and settles when stopped`, async ({ page }) => {
  // Software WebGL must present two separate reply avatars and their final
  // settled frames. Retain normal per-assertion limits within this flow budget.
  test.setTimeout(60_000);
  await prepare(page);
  if (variant === "silverash") {
    await page.route("**/api/agent/chat", route => route.fulfill({ json: { success: true, data: { enabled: true, personas: [{ id: "silverash" }] } } }));
    await page.addInitScript(() => localStorage.setItem("riic.agent.persona.selection.v1", "silverash"));
  }
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    const allocated = new WeakSet<HTMLCanvasElement>();
    (window as typeof window & { furContexts: number }).furContexts = 0;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (args[0] === "webgl2" && !allocated.has(this)) {
        allocated.add(this);
        (window as typeof window & { furContexts: number }).furContexts++;
      }
      return original.apply(this, args);
    } as typeof original;
  });
  await page.goto("/agent");
  const input = page.getByRole("textbox", { name: variant === "silverash" ? "发给银灰的消息" : "发给可露希尔的消息" });
  await input.fill("帮我排班");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "停止", exact: true })).toBeVisible();
  await emit(page, [
    { type: "start", messageId: "fur-answer" }, { type: "start-step" },
    { type: "text-start", id: "fur-first" }, { type: "text-delta", id: "fur-first", delta: "先确认你的干员池。" },
  ]);
  const avatars = page.locator(`[data-speaker="assistant"] [data-fur-avatar="${variant}"]`);
  await expect(avatars).toHaveCount(1);
  await expect(avatars.first()).toHaveAttribute("data-fur-motion", "animated");
  await emit(page, [
    { type: "text-end", id: "fur-first" },
    { type: "text-start", id: "fur-second" }, { type: "text-delta", id: "fur-second", delta: "接下来检查布局。" },
  ]);
  await expect(avatars).toHaveCount(2);
  await expect(avatars.first()).toHaveAttribute("data-fur-motion", "idle");
  await expect(avatars.last()).toHaveAttribute("data-fur-motion", "animated");
  expect(await page.evaluate(() => (window as typeof window & { furContexts: number }).furContexts)).toBe(1);
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect(avatars.last()).toHaveAttribute("data-fur-motion", "idle");
  const stopped = await avatars.last().locator("canvas").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await input.fill("停止后可以继续输入");
  expect(await avatars.last().locator("canvas").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(stopped);
  // Claiming and releasing one portrait must not queue unchanged historical
  // portraits ahead of the user's pointer response on the shared renderer.
  await expect(avatars.first()).toHaveAttribute("data-fur-motion", "idle");
  const historicalFrames = await avatars.first().getAttribute("data-fur-frames");
  await avatars.last().hover({ position: { x: 2, y: 2 } });
  await expect.poll(async () => Math.abs(Number(await avatars.last().getAttribute("data-fur-yaw")))).toBeGreaterThan(0.03);
  expect(await avatars.first().getAttribute("data-fur-frames")).toBe(historicalFrames);
  await input.hover();
  await expect(avatars.last()).toHaveAttribute("data-fur-motion", "idle");
  expect(await avatars.first().getAttribute("data-fur-frames")).toBe(historicalFrames);
});
}

test("Agent keeps streaming across routes and restores its live request", async ({ page }) => {
  await prepare(page);
  await page.goto("/agent");
  const input = page.getByRole("textbox", { name: "发给可露希尔的消息" });
  await input.fill("后台继续回答");
  await input.press("Enter");
  const spinner = page.locator('[data-agent-history] a[aria-label="后台继续回答"] [data-agent-history-loading]');
  await expect(spinner).toBeVisible();
  await emit(page, [{ type: "start", messageId: "background" }, { type: "text-start", id: "reply" }, { type: "text-delta", id: "reply", delta: "正在生成。" }]);
  await page.locator('[data-primary-navigation-page="mastery"]').click();
  await expect(page).toHaveURL(/\/mastery$/);
  await expect(page.locator("[data-agent-chat]")).toHaveCount(0);
  await expect(spinner).toBeVisible();
  await page.locator('[data-primary-navigation-page="agent"]').click();
  await expect(page.getByText("正在生成。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "停止", exact: true })).toBeVisible();
  await emit(page, [{ type: "text-delta", id: "reply", delta: "后台回答完成。" }, { type: "text-end", id: "reply" }, { type: "finish", finishReason: "stop" }], true);
  await expect(spinner).toHaveCount(0);
  await expect(page.getByText("正在生成。后台回答完成。", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & { agentTestAborts: number }).agentTestAborts)).toBe(0);
  expect(await page.evaluate(() => (window as typeof window & { agentTestRequests: number }).agentTestRequests)).toBe(1);
});

test("Agent saves a reply completed while away and restores it after reload", async ({ page }) => {
  await prepare(page);
  await page.goto("/agent");
  const input = page.getByRole("textbox", { name: "发给可露希尔的消息" });
  await input.fill("后台继续回答");
  await input.press("Enter");
  const spinner = page.locator('[data-agent-history] a[aria-label="后台继续回答"] [data-agent-history-loading]');
  await expect(spinner).toBeVisible();
  await emit(page, [{ type: "start", messageId: "background" }, { type: "text-start", id: "reply" }, { type: "text-delta", id: "reply", delta: "正在生成。" }]);
  await page.locator('[data-primary-navigation-page="recruitment"]').click();
  await expect(page).toHaveURL(/\/recruitment$/);
  await expect(page.locator("[data-agent-chat]")).toHaveCount(0);
  await expect(spinner).toBeVisible();
  await emit(page, [{ type: "text-delta", id: "reply", delta: "后台回答完成。" }, { type: "text-end", id: "reply" }, { type: "finish", finishReason: "stop" }], true);
  await expect(spinner).toHaveCount(0);
  await page.locator('[data-primary-navigation-page="agent"]').click();
  await expect(page.getByText("正在生成。后台回答完成。", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & { agentTestAborts: number }).agentTestAborts)).toBe(0);
  expect(await page.evaluate(() => (window as typeof window & { agentTestRequests: number }).agentTestRequests)).toBe(1);
  await page.reload();
  await expect(page.getByText("正在生成。后台回答完成。", { exact: true })).toBeVisible();
});

test("Mobile history shows loading only on the running conversation while another history is open", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await prepare(page);
  await page.goto("/agent");
  const input = page.getByRole("textbox", { name: "发给可露希尔的消息" });
  await input.fill("已完成的对话");
  await input.press("Enter");
  await emit(page, [{ type: "start", messageId: "previous" }, { type: "text-start", id: "old" }, { type: "text-delta", id: "old", delta: "已完成" }, { type: "text-end", id: "old" }, { type: "finish", finishReason: "stop" }], true);
  await expect(page.getByText("已完成", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await input.fill("仍在运行的对话");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "停止", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  const old = page.locator('[data-agent-history] a[aria-label="已完成的对话"]');
  const running = page.locator('[data-agent-history] a[aria-label="仍在运行的对话"]');
  await expect(running.locator("[data-agent-history-loading]")).toBeVisible();
  await expect(old.locator("[data-agent-history-loading]")).toHaveCount(0);
  await expect(page.locator('[data-primary-navigation-page="agent"] [role="status"]')).toHaveCount(0);
  const title = (await running.locator("span").first().boundingBox())!;
  const indicator = (await running.locator("[data-agent-history-loading]").boundingBox())!;
  expect(indicator.x).toBeGreaterThanOrEqual(title.x + title.width);
  await old.click();
  await expect(page.getByText("已完成", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await expect(running.locator("[data-agent-history-loading]")).toBeVisible();
  await emit(page, [{ type: "start", messageId: "background-history" }, { type: "text-start", id: "new" }, { type: "text-delta", id: "new", delta: "另一段对话完成" }, { type: "text-end", id: "new" }, { type: "finish", finishReason: "stop" }], true);
  await expect(running.locator("[data-agent-history-loading]")).toHaveCount(0);
  await running.click();
  await expect(page.getByText("另一段对话完成", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & { agentTestAborts: number }).agentTestAborts)).toBe(0);
});

test("A timeout in the background clears loading and retries the same question, attachment and persona", async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => localStorage.setItem("riic.agent.persona.v1", JSON.stringify({ version: 1, id: "retry-persona", name: "重试人格", content: "保持简洁" })));
  await page.goto("/agent");
  await expect(page.getByRole("button", { name: "人格卡：重试人格" })).toBeVisible();
  await page.locator('input[aria-label="上传附件"]').setInputFiles({ name: "问题.txt", mimeType: "text/plain", buffer: Buffer.from("附件内容") });
  const input = page.getByRole("textbox", { name: "发给重试人格的消息" });
  await input.fill("超时测试问题");
  await input.press("Enter");
  await expect(page.locator('[data-agent-history] a[aria-label="超时测试问题"] [data-agent-history-loading]')).toBeVisible();
  await emit(page, [{ type: "start", messageId: "timeout" }, { type: "text-start", id: "partial" }, { type: "text-delta", id: "partial", delta: "尚未完成" }]);
  await page.locator('[data-primary-navigation-page="mastery"]').click();
  await expect(page).toHaveURL(/\/mastery$/);
  await emit(page, [{ type: "error", errorText: "AGENT_RESPONSE_TIMEOUT" }], true);
  await expect(page.locator("[data-agent-history-loading]")).toHaveCount(0);
  await page.locator('[data-primary-navigation-page="agent"]').click();
  await expect(page.locator("[data-agent-chat]").getByRole("alert")).toContainText("模型响应超时");
  await expect(page.locator("[data-agent-loading]")).toHaveCount(0);
  await expect(page.getByText("尚未完成", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重试回答" }).click();
  await expect(page.locator('[data-agent-history] a[aria-label="超时测试问题"] [data-agent-history-loading]')).toBeVisible();
  const bodies = await page.evaluate(() => (window as typeof window & { agentTestBodies: unknown[] }).agentTestBodies);
  expect(bodies).toHaveLength(2);
  const first = bodies[0] as { messages: unknown[]; persona: unknown };
  const retry = bodies[1] as { messages: unknown[]; persona: unknown };
  expect(retry.messages).toEqual(first.messages);
  expect(retry.persona).toEqual(first.persona);
  await emit(page, [{ type: "start", messageId: "retried" }, { type: "text-start", id: "success" }, { type: "text-delta", id: "success", delta: "重试成功" }, { type: "text-end", id: "success" }, { type: "finish", finishReason: "stop" }], true);
  await expect(page.getByText("重试成功", { exact: true })).toBeVisible();
  await expect(page.locator('[data-speaker="user"]')).toHaveCount(1);
  await expect(page.locator("[data-agent-history-loading]")).toHaveCount(0);
});

for (const scenario of [{ width: 1440, reducedMotion: "no-preference" }, { width: 375, reducedMotion: "reduce" }] as const) {
  test(`Operator portraits follow completed text and survive history (${scenario.width}px)`, async ({ page }) => {
    // Two page loads plus streamed tool steps and persistence assertions share
    // this budget. Keep each assertion's normal timeout on software-GPU CI.
    test.setTimeout(60_000);
    await page.setViewportSize({ width: scenario.width, height: 900 });
    await page.emulateMedia({ reducedMotion: scenario.reducedMotion });
    await prepare(page);
    await page.goto("/agent");
    const input = page.getByRole("textbox", { name: "发给可露希尔的消息" });
    await input.fill("比较能天使和银灰");
    await input.press("Enter");
    await expect(page.locator("[data-agent-loading]")).toBeVisible();
    await emit(page, [{ type: "start", messageId: "portraits" }, { type: "start-step" }, { type: "reasoning-start", id: "reason" }, { type: "reasoning-delta", id: "reason", delta: "能天使和阿米娅。" }, { type: "reasoning-end", id: "reason" }, { type: "text-start", id: "first" }, { type: "text-delta", id: "first", delta: "能天" }]);
    const mentions = page.locator("[data-agent-operator]");
    const text = page.locator("[data-agent-streaming-text]");
    await expect(text).toHaveText("能天");
    await expect(mentions).toHaveCount(0);
    await emit(page, [{ type: "text-delta", id: "first", delta: "使、银灰。\n" }]);
    await expect(text).toHaveText("能天使、银灰。");
    await expect(mentions).toHaveCount(0);
    await emit(page, [{ type: "text-delta", id: "first", delta: "\n继续说明。" }]);
    await expect(mentions).toHaveCount(2);
    await expect(mentions).toHaveText(["能天使", "银灰"]);
    await expect(mentions.first().locator("[data-agent-operator-portrait]")).toHaveCSS("opacity", "1");
    const portraitAnimation = await mentions.first().locator("[data-agent-operator-portrait]").evaluate((el) => getComputedStyle(el).animationName);
    const portraitStartedAt = await mentions.first().locator("[data-agent-operator-portrait]").evaluate((el) => el.getAnimations()[0]?.startTime ?? null);
    if (scenario.reducedMotion === "reduce") expect(portraitAnimation).toBe("none");
    else expect(portraitAnimation).toContain("portraitReveal");
    await expect(mentions.first()).toHaveCSS("filter", "none");
    for (const image of await mentions.locator("img").all()) {
      await expect(image).toHaveAttribute("loading", "lazy");
      await expect(image).toHaveAttribute("decoding", "async");
      await expect(image).toHaveAttribute("src", /^\/images\/operator-portraits\/[^?]+\.webp\?v=/);
      await expect(image).toHaveAttribute("alt", "");
      await expect(image).toHaveCSS("width", "18px");
    }
    const secondText = "能天使、红云、**红**。今年空闲时看夕阳。\n\n`阿米娅` [可露希尔](https://example.test/)\n\n```text\n银灰\n```\n\n| 干员 | 建议 |\n| --- | --- |\n| 阿米娅 | 稍后培养 |\n\n- 可露希尔\n\n让[干员:山]先守住，[干员:山]的身后是[干员:能天使]。";
    await emit(page, [{ type: "text-end", id: "first" }, { type: "tool-input-available", toolCallId: "account", toolName: "diagnose_account", input: {} }, { type: "tool-output-available", toolCallId: "account", output: {} }, { type: "finish-step" }, { type: "start-step" }, { type: "text-start", id: "second" }, { type: "text-delta", id: "second", delta: secondText }, { type: "text-end", id: "second" }, { type: "finish-step" }, { type: "finish", finishReason: "stop" }], true);
    await expect(text.last()).toHaveAttribute("data-streaming", "false");
    await expect(mentions).toHaveText(["能天使", "银灰", "能天使", "红云", "红", "阿米娅", "可露希尔", "山", "山", "能天使"]);
    await expect(mentions.last()).toHaveCSS("margin-left", "4px");
    await expect(mentions.last()).toHaveCSS("margin-right", "4px");
    await expect(text.last()).not.toContainText("[干员:");
    expect(await mentions.first().locator("[data-agent-operator-portrait]").evaluate((el) => el.getAnimations()[0]?.startTime ?? null)).toBe(portraitStartedAt);
    await expect(page.locator("code [data-agent-operator], a [data-agent-operator], [data-agent-thinking] [data-agent-operator], [data-speaker=user] [data-agent-operator]")).toHaveCount(0);
    expect(await text.last().locator("p").first().textContent()).toBe("能天使、红云、红。今年空闲时看夕阳。");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // Persisted messages remain unmodified Markdown, including cross-tool text parts.
    await expect.poll(() => page.evaluate(() => new Promise<string[]>((resolve) => {
      const request = indexedDB.open("riic-agent-history-v1", 1);
      request.onsuccess = () => {
        const database = request.result;
        const read = database.transaction("accounts").objectStore("accounts").get("motion-user");
        read.onsuccess = () => { resolve(read.result?.conversations[0]?.messages.at(-1)?.parts.filter((part: { type: string; state?: string }) => part.type === "text" && part.state === "done").map((part: { text: string }) => part.text) ?? []); database.close(); };
      };
    }))).toEqual(["能天使、银灰。\n\n继续说明。", secondText]);
    await page.reload();
    await expect(mentions).toHaveText(["能天使", "银灰", "能天使", "红云", "红", "阿米娅", "可露希尔", "山", "山", "能天使"]);
    await expect(text.locator("[data-stream-chunk]")).toHaveCount(0);
    await expect(mentions.first().locator("[data-agent-operator-portrait]")).toHaveCSS("animation-name", "none");
    const firstName = mentions.first();
    const before = await firstName.boundingBox();
    await firstName.locator("img").dispatchEvent("error");
    await expect(firstName.locator("img")).toHaveCount(0);
    await expect(firstName).toHaveText("能天使");
    expect((await firstName.boundingBox())!.width).toBe(before!.width);
  });
}

test("Long reasoning collapses without a gap and streamed text stays readable across tool steps", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepare(page);
  await page.goto("/agent");
  const input = page.getByRole("textbox", { name: "发给可露希尔的消息" });
  await input.fill("帮我分析练卡取舍");
  await input.press("Enter");
  await expect(page.locator("[data-agent-loading]")).toBeVisible();
  await emit(page, [{ type: "start", messageId: "long-reply" }, { type: "start-step" }, { type: "reasoning-start", id: "first" }, { type: "reasoning-delta", id: "first", delta: "先分析已有干员和资源。\n".repeat(80) }]);
  const first = page.locator("[data-agent-thinking]").first();
  await expect(first).toHaveAttribute("data-running", "true");
  await emit(page, [{ type: "reasoning-end", id: "first" }, { type: "text-start", id: "intro" }, { type: "text-delta", id: "intro", delta: "我来查一下练卡资料。" }, { type: "text-end", id: "intro" }, { type: "tool-input-available", toolCallId: "guide", toolName: "diagnose_account", input: {} }, { type: "tool-output-available", toolCallId: "guide", output: {} }, { type: "finish-step" }, { type: "start-step" }, { type: "reasoning-start", id: "second" }, { type: "reasoning-delta", id: "second", delta: "根据资料继续分析。" }]);
  await expect(first.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => first.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(45);
  const intro = page.locator("[data-agent-streaming-text]").first();
  await expect(intro).toHaveText("我来查一下练卡资料。");
  await expect(intro.locator("[data-stream-chunk]")).toHaveCount(0);
  await expect(intro.locator('xpath=ancestor::article').locator("[data-closure-fur-avatar]")).toHaveAttribute("data-fur-motion", "idle");
  // Reasoning is outside the bubble; measure the gap to its row, excluding
  // the speaker name and the bubble's own padding.
  await expect.poll(async () => (await intro.locator('xpath=ancestor::article').boundingBox())!.y - ((await first.boundingBox())!.y + (await first.boundingBox())!.height)).toBeLessThan(16);
  await expect(page.locator("[data-agent-bubble] [data-agent-thinking]")).toHaveCount(0);
  expect(await first.evaluate((el) => Boolean(el.compareDocumentPosition(document.querySelector("[data-agent-streaming-text]")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  expect(await intro.evaluate((el) => Boolean(el.compareDocumentPosition(document.querySelectorAll("[data-agent-thinking]")[1]) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  // A stalled/throttled animation must not hide text or accumulate one DOM node
  // per token. Keep the stream open through many independently rendered deltas.
  await page.addStyleTag({ content: "[data-stream-chunk] { animation-play-state: paused !important; }" });
  const second = page.locator("[data-agent-thinking]").last();
  for (let index = 0; index < 80; index++) {
    await emit(page, [{ type: "reasoning-delta", id: "second", delta: `第${index}项分析，` }]);
    await expect(second).toContainText(`第${index}项分析，`);
  }
  await expect(second.locator("[data-stream-chunk]")).toHaveCount(1);
  expect(await second.locator("[data-stream-chunk]").evaluate((el) => getComputedStyle(el).filter)).toBe("none");
  expect(await second.locator("[data-stream-chunk]").evaluate((el) => Number(getComputedStyle(el).opacity))).toBeGreaterThanOrEqual(0.6);
  await emit(page, [{ type: "reasoning-end", id: "second" }, { type: "text-start", id: "final" }, { type: "text-delta", id: "final", delta: "优先培养常用干员。" }, { type: "text-end", id: "final" }, { type: "finish-step" }, { type: "finish", finishReason: "stop" }], true);
  const finalText = page.locator('[data-speaker="assistant"]').last().locator("[data-agent-streaming-text]");
  await expect(finalText).toHaveAttribute("data-streaming", "false");
  await expect(finalText).toHaveText("优先培养常用干员。");
  await expect(page.getByRole("button", { name: "复制回答" })).toHaveCount(0);
  await expect(page.locator('[data-running="true"]')).toHaveCount(0);
  await expect(second.locator("[data-stream-chunk]")).toHaveCount(0);
  await expect.poll(() => second.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(45);
  await first.getByRole("button").click();
  await expect(first.getByText("先分析已有干员和资源。\n".repeat(80), { exact: true })).toBeVisible();
  await expect.poll(() => first.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(105);
});

for (const width of [1440, 375]) {
  test(`Response container keeps loading aligned across empty chunks and tool gaps at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await prepare(page);
    await page.goto("/agent");
    const input = page.getByRole("textbox", { name: "发给可露希尔的消息" });
    await input.fill("检查账号");
    await input.press("Enter");
    const response = page.locator("[data-agent-assistant-turn]");
    const loader = page.locator("[data-agent-loading]");
    await expect(response).toHaveCount(1);
    await expect(response.locator("[data-agent-loading]")).toHaveCount(1);
    const initial = (await loader.boundingBox())!;
    const initialResponse = (await response.boundingBox())!;
    await response.evaluate((el) => { el.setAttribute("data-test-original", "true"); });
    const userBounds = (await page.locator('[data-speaker="user"]').boundingBox())!;
    expect(initial.x - userBounds.x).toBe(width < 640 ? 44 : 68);
    await emit(page, [{ type: "start", messageId: "alignment" }, { type: "start-step" }]);
    await expect(response).toHaveAttribute("data-test-original", "true");
    await expect(loader).toBeVisible();
    await emit(page, [{ type: "text-start", id: "empty" }, { type: "text-delta", id: "empty", delta: " \n" }]);
    await expect(loader).toBeVisible();
    expect((await loader.boundingBox())!.y).toBe(initial.y);
    expect((await response.boundingBox())!.height).toBe(initialResponse.height);
    await emit(page, [{ type: "text-end", id: "empty" }, { type: "reasoning-start", id: "reason" }]);
    const thinking = response.locator("[data-agent-thinking]");
    await expect(thinking).toBeVisible();
    await expect(loader).toHaveCount(0);
    expect((await thinking.boundingBox())!.x).toBe(initial.x);
    expect((await thinking.getByRole("button").boundingBox())!.y).toBe(initial.y);
    await emit(page, [{ type: "reasoning-delta", id: "reason", delta: "检查账号资料。" }, { type: "reasoning-end", id: "reason" }, { type: "tool-input-available", toolCallId: "check", toolName: "diagnose_account", input: {} }]);
    const tool = response.locator("[data-agent-tool]");
    await expect(tool).toBeVisible();
    expect((await tool.boundingBox())!.x).toBe(initial.x);
    await emit(page, [{ type: "tool-output-available", toolCallId: "check", output: {} }]);
    await expect(response.locator("[data-agent-loading]")).toHaveCount(1);
    expect((await loader.boundingBox())!.x).toBe(initial.x);
    const toolBounds = (await tool.boundingBox())!;
    expect((await loader.boundingBox())!.y - toolBounds.y - toolBounds.height).toBeLessThanOrEqual(8);
    await emit(page, [{ type: "text-start", id: "answer" }]);
    await expect(loader).toBeVisible();
    await emit(page, [{ type: "text-delta", id: "answer", delta: "已检查。" }]);
    await expect(loader).toHaveCount(0);
    await expect(response.locator("[data-agent-bubble]")).toContainText("已检查。");
    expect((await response.locator("[data-agent-bubble]").boundingBox())!.x).toBe(initial.x);
    await emit(page, [{ type: "text-end", id: "answer" }, { type: "finish-step" }, { type: "finish", finishReason: "stop" }], true);
    await expect(response).toHaveAttribute("data-pending", "false");
    await expect(response).toHaveAttribute("data-test-original", "true");
    await expect(loader).toHaveCount(0);
    await input.fill("第二个问题");
    await input.press("Enter");
    await expect(page.locator("[data-agent-assistant-turn]")).toHaveCount(2);
    await expect(loader).toHaveCount(1);
    expect((await loader.boundingBox())!.x).toBe(initial.x);
    await page.getByRole("button", { name: "停止", exact: true }).click();
    await expect(loader).toHaveCount(0);
    await expect(page.locator("[data-agent-assistant-turn]")).toHaveCount(1);
  });
}

for (const scenario of [{ width: 1440, reducedMotion: "no-preference" }, { width: 375, reducedMotion: "reduce" }] as const) {
  test(`Reasoning follows three visual lines and allows review (${scenario.width}px, ${scenario.reducedMotion})`, async ({ page }) => {
    await page.setViewportSize({ width: scenario.width, height: 900 });
    await page.emulateMedia({ reducedMotion: scenario.reducedMotion });
    await prepare(page);
    await page.goto("/agent");
    const input = page.getByRole("textbox", { name: "发给可露希尔的消息" });
    await input.fill("分析我的干员培养顺序");
    await input.press("Enter");
    await expect(page.locator("[data-agent-loading]")).toBeVisible();
    const original = "先核实已有干员，再结合当前资源安排升级与专精。".repeat(50);
    await emit(page, [{ type: "start", messageId: "three-lines" }, { type: "start-step" }, { type: "reasoning-start", id: "reason" }, { type: "reasoning-delta", id: "reason", delta: original }]);
    const preview = page.locator("[data-agent-reasoning-preview]");
    const viewport = preview.locator('[data-slot="scroll-area-viewport"]');
    const distance = () => viewport.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
    await expect.poll(() => viewport.evaluate((el) => el.clientHeight)).toBe(54);
    await expect.poll(distance).toBeLessThan(2);
    await expect(preview).toHaveAttribute("data-fading", "true");
    const mask = await viewport.evaluate((el) => getComputedStyle(el).maskImage);
    if (scenario.reducedMotion === "reduce") expect(mask).toBe("none");
    else expect(mask).toContain("linear-gradient");
    await emit(page, [{ type: "reasoning-delta", id: "reason", delta: "\n这是最新一行。" }]);
    await expect(preview).toContainText("这是最新一行。");
    await expect.poll(distance).toBeLessThan(2);
    // The full content is retained; the mask is restricted to the exit edge.
    await expect(preview).toContainText(original);
    expect(await viewport.evaluate((el) => getComputedStyle(el).filter)).toBe("none");
    await viewport.focus();
    await viewport.press("Home");
    await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBe(0);
    await expect(preview).toHaveAttribute("data-fading", "false");
    await emit(page, [{ type: "reasoning-delta", id: "reason", delta: "\n回看时新增的内容不抢滚动位置。" }]);
    await expect(preview).toContainText("回看时新增的内容不抢滚动位置。");
    expect(await viewport.evaluate((el) => el.scrollTop)).toBe(0);
    await viewport.press("End");
    await expect.poll(distance).toBeLessThan(2);
    await emit(page, [{ type: "reasoning-delta", id: "reason", delta: "\n恢复跟随后显示这一行。" }]);
    await expect(preview).toContainText("恢复跟随后显示这一行。");
    await expect.poll(distance).toBeLessThan(2);
    await page.getByRole("button", { name: "停止", exact: true }).click();
    const thinking = page.locator("[data-agent-thinking]");
    await expect(thinking.getByRole("button")).toHaveAttribute("aria-expanded", "false");
    await expect(preview).toHaveCount(0);
    await thinking.getByRole("button").click();
    await expect(preview).toContainText(original);
    await expect.poll(distance).toBeLessThan(2);
    await expect(preview).toHaveAttribute("data-fading", "false");
  });
}

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`Agent animates actual loading, reasoning, tools and streaming text (${reducedMotion})`, async ({ page }) => {
    // Includes a real IndexedDB checkpoint and a reload with fresh WebGL state.
    // Keep individual assertions bounded while allowing the full software-GPU flow.
    test.setTimeout(60_000);
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width: 1440, height: 900 });
    await prepare(page);
    await page.goto("/agent");
    const input = page.getByRole("textbox", { name: "发给可露希尔的消息" });
    await input.fill("检查我的账号");
    await input.press("Enter");
    const loader = page.locator("[data-agent-loading]");
    await expect(loader).toContainText("正在处理你的请求");
    await expect.poll(async () => Number.parseFloat(await loader.locator("[data-agent-elapsed]").innerText())).toBeGreaterThan(0);
    const pixel = loader.locator('span[aria-hidden="true"] > span').first();
    const animationName = await pixel.evaluate((el) => getComputedStyle(el).animationName);
    if (reducedMotion === "reduce") expect(animationName).toBe("none");
    else expect(animationName).not.toBe("none");

    await emit(page, [{ type: "start", messageId: "motion-reply" }, { type: "start-step" }, { type: "reasoning-start", id: "reason" }, { type: "reasoning-delta", id: "reason", delta: "先检查账号资料。" }]);
    const thinking = page.locator("[data-agent-thinking]");
    await expect(thinking).toHaveAttribute("data-running", "true");
    await expect(thinking.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    await expect(thinking.getByText("先检查账号资料。", { exact: true })).toBeVisible();
    await expect(loader).toHaveCount(0);

    await emit(page, [{ type: "reasoning-end", id: "reason" }, { type: "tool-input-available", toolCallId: "check", toolName: "diagnose_account", input: {} }]);
    await expect(thinking).toHaveAttribute("data-running", "false");
    await expect(thinking.getByRole("button")).toHaveAttribute("aria-expanded", "false");
    const tool = page.locator('[data-agent-tool="diagnose_account"]');
    await expect(tool).toHaveAttribute("data-running", "true");
    await expect(tool).toContainText("正在调用");
    await thinking.getByRole("button").click();
    await expect(thinking.getByText("先检查账号资料。", { exact: true })).toBeVisible();

    // Inspect the transient animation before letting it finish and remove its
    // wrapper; do not rely on catching a 180 ms frame with locator polling.
    const pausedText = await page.addStyleTag({ content: "[data-stream-chunk] { animation-play-state: paused !important; }" });
    await emit(page, [{ type: "tool-output-available", toolCallId: "check", output: { skland: { connected: false, reason: "尚未绑定" }, operatorPool: { sourceName: "MAA", owned: 98, elite2: 32 } } }, { type: "text-start", id: "answer" }, { type: "text-delta", id: "answer", delta: "你好，**博士**。" }]);
    await expect(tool).toHaveAttribute("data-running", "false");
    await tool.getByRole("button", { name: "账号数据诊断 完成" }).click();
    await expect(tool.getByText("干员池：MAA · 干员 98 / 精二 32")).toBeVisible();
    const text = page.locator("[data-agent-streaming-text]");
    await expect(text).toHaveAttribute("data-streaming", "true");
    await expect(text.locator("strong")).toHaveText("博士");
    await expect(text.locator("[data-stream-chunk]").first()).toBeVisible();
    const textAnimation = await text.locator("[data-stream-chunk]").first().evaluate((el) => getComputedStyle(el).animationName);
    if (reducedMotion === "reduce") expect(textAnimation).toBe("none");
    else expect(textAnimation).not.toBe("none");
    await pausedText.evaluate((el) => el.parentNode?.removeChild(el));
    if (reducedMotion === "no-preference") await expect(text.locator("[data-stream-chunk]")).toHaveCount(0);
    await emit(page, [{ type: "text-delta", id: "answer", delta: " 可以继续安排基建。" }]);
    await expect(text).toHaveText("你好，博士。 可以继续安排基建。");
    await emit(page, [{ type: "text-end", id: "answer" }, { type: "finish-step" }, { type: "finish", finishReason: "stop" }], true);
    await expect(text).toHaveAttribute("data-streaming", "false");
    await expect(page.getByRole("button", { name: "复制回答" })).toHaveCount(0);
    await expect(page.locator('[data-running="true"]')).toHaveCount(0);
    await expect(loader).toHaveCount(0);
    // Wait for the real IndexedDB checkpoint, then verify restored history is static.
    await expect.poll(() => page.evaluate(() => new Promise<number>((resolve) => {
      const request = indexedDB.open("riic-agent-history-v1", 1);
      request.onsuccess = () => {
        const database = request.result;
        const read = database.transaction("accounts").objectStore("accounts").get("motion-user");
        read.onsuccess = () => { resolve(read.result?.conversations[0]?.messages.at(-1)?.parts.filter((part: { type: string; state?: string }) => part.type === "text" && part.state === "done").length ?? 0); database.close(); };
      };
    }))).toBe(1);
    await page.reload();
    await expect(text).toHaveText("你好，博士。 可以继续安排基建。");
    await expect(text.locator("[data-stream-chunk]")).toHaveCount(0);
    await expect(thinking.getByRole("button")).toHaveAttribute("aria-expanded", "false");
    expect(await tool.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  });
}

test("Stopping a real pending tool settles its animation", async ({ page }) => {
  await prepare(page);
  await page.goto("/agent");
  const input = page.getByRole("textbox", { name: "发给可露希尔的消息" });
  await input.fill("检查账号");
  await input.press("Enter");
  await expect(page.locator("[data-agent-loading]")).toBeVisible();
  await emit(page, [{ type: "start", messageId: "stopped-reply" }, { type: "start-step" }, { type: "tool-input-available", toolCallId: "pending", toolName: "diagnose_account", input: {} }]);
  const tool = page.locator('[data-agent-tool="diagnose_account"]');
  await expect(tool).toHaveAttribute("data-running", "true");
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect(tool).toHaveAttribute("data-running", "false");
  await expect(tool).toContainText("已停止");
  await expect(page.locator("[data-agent-loading]")).toHaveCount(0);
  await expect(input).toBeEditable();
});
