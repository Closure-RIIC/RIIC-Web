import { expect, test, type Page } from "@playwright/test";
import { mockApis } from "./production-readiness.fixture";
import { openAgentHistory } from "./agent-history";

const choices = [
  { id: "deepseek", label: "DeepSeek Flash", vision: false, available: true },
  { id: "glm", label: "GLM-5.3 Flash", vision: false, available: true },
  { id: "gpt", label: "GPT-6.1 Sol", vision: true, available: true, rates: { inputPointsPerMillion: "100", cachedInputPointsPerMillion: "10", outputPointsPerMillion: "400" } },
];
type RequestBody = { model: string; images: string; messages: Array<{ parts: Array<{ type: string; mediaType?: string; url?: string }> }> };
async function setup(page: Page, unavailableGpt = false, imageLimits = { maxImages: 4, maxImageBytes: 8 * 1024 * 1024, maxImagePixels: 16_000_000 }) {
  await mockApis(page);
  await page.addInitScript(() => localStorage.setItem("riic.agent.appearance.v1", "glow-cloud"));
  await page.route("**/api/account/data-consent", route => route.fulfill({ json: { success: true, data: { current: false, cloudSyncEnabled: false } } }));
  await page.route("**/api/billing", route => route.fulfill({ json: { data: { wallet: { totalPoints: 1234 } } } }));
  await page.route("**/api/auth/get-session", route => route.fulfill({ json: {
    user: { id: "model-user", name: "博士", email: "models@example.test" }, session: { expiresAt: "2099-01-01T00:00:00Z" },
  } }));
  const requests: RequestBody[] = [];
  await page.route("**/api/agent/chat", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { success: true, data: {
      enabled: true, automatic: true, defaultModel: "deepseek", models: choices.map(choice => choice.id === "gpt" ? { ...choice, imageLimits, ...(unavailableGpt ? { available: false, reason: "image_budget_missing" } : {}) } : choice),
    } } });
    const body = route.request().postDataJSON() as RequestBody;
    requests.push(body);
    const index = requests.length;
    const model = choices.find(choice => choice.id === body.model)!;
    const chunks = [
      { type: "start", messageId: `answer-${index}`, messageMetadata: { replyModel: { id: model.id, label: model.label } } },
      { type: "start-step" }, { type: "text-start", id: "text" },
      { type: "text-delta", id: "text", delta: `回答 ${index}` }, { type: "text-end", id: "text" },
      { type: "finish-step" }, { type: "finish", finishReason: "stop" },
    ];
    return route.fulfill({ contentType: "text/event-stream", headers: { "x-vercel-ai-ui-message-stream": "v1" }, body: chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n" });
  });
  return requests;
}

for (const width of [1440, 390, 320]) {
  test(`model selection preserves images locally and explicitly excludes them for text models at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const requests = await setup(page);
    await page.goto("/agent");
    const selector = page.getByRole("combobox", { name: "助理模型" });
    await expect(selector).toContainText("DeepSeek Flash");
    const input = page.locator("[data-agent-composer] textarea");
    await page.getByLabel("上传附件", { exact: true }).setInputFiles({ name: "pixel.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=", "base64") });
    await input.fill("识别图片");
    await expect(page.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "切换到识图模型" }).click();
    await expect(selector).toContainText("GPT-6.1 Sol");
    await expect(page.locator("[data-agent-model-rates]")).toHaveCount(0);
    await expect(page.locator("[data-agent-image-billing]")).toHaveText("图片随上下文重新送入模型时会再次计入输入 Token。");
    await input.press("Enter");
    await expect(page.getByText("回答 1", { exact: true })).toBeVisible();
    expect(requests[0].model).toBe("gpt");
    expect(requests[0].images).toBe("include");
    expect(requests[0].messages.some(message => message.parts.some(part => part.mediaType === "image/png"))).toBe(true);
    await expect(page.locator("[data-agent-reply-model]")).toHaveCount(0);
    await expect(page.locator("[data-agent-assistant-turn]")).not.toContainText("GPT-6.1 Sol");
    await selector.click();
    await page.getByRole("option", { name: "GLM-5.3 Flash", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "仅携带文字继续？" });
    await expect(dialog).toBeVisible();
    await dialog.evaluate(async element => {
      await Promise.allSettled(element.getAnimations().map(animation => animation.finished));
    });
    const layout = await dialog.evaluate(element => {
      const box = (node: Element) => {
        const { left, right, top, bottom } = node.getBoundingClientRect();
        return { left, right, top, bottom };
      };
      return {
        dialog: box(element), radius: getComputedStyle(element).borderTopLeftRadius,
        title: box(element.querySelector('[data-slot="dialog-title"] > span:last-child')!),
        description: box(element.querySelector('[data-slot="dialog-description"]')!),
        close: box(element.querySelector('[data-slot="dialog-close"]')!),
        buttons: [...element.querySelectorAll('[data-slot="dialog-footer"] button')].map(box),
        overflow: element.scrollWidth - element.clientWidth,
      };
    });
    expect(layout.radius).toBe("16px");
    expect(Math.abs(layout.title.left - layout.description.left)).toBeLessThanOrEqual(1);
    expect(layout.title.left - layout.dialog.left).toBeGreaterThanOrEqual(19);
    expect(layout.title.right).toBeLessThanOrEqual(layout.close.left - 4);
    expect(layout.dialog.right - layout.description.right).toBeGreaterThanOrEqual(19);
    expect(layout.dialog.left).toBeGreaterThanOrEqual(15);
    expect(layout.dialog.right).toBeLessThanOrEqual(width - 15);
    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(layout.buttons).toHaveLength(2);
    for (const button of layout.buttons) {
      expect(button.left - layout.dialog.left).toBeGreaterThanOrEqual(19);
      expect(layout.dialog.right - button.right).toBeGreaterThanOrEqual(19);
      expect(button.top - layout.description.bottom).toBeGreaterThanOrEqual(12);
      expect(layout.dialog.bottom - button.bottom).toBeGreaterThanOrEqual(19);
    }
    await dialog.screenshot({ path: testInfo.outputPath("model-switch-dialog.png") });
    await page.getByRole("button", { name: "仅携带文字继续", exact: true }).click();
    await expect(selector).toContainText("GLM-5.3 Flash");
    await expect(page.locator("[data-agent-image-billing]")).toHaveCount(0);
    await input.fill("根据文字继续");
    await input.press("Enter");
    await expect(page.getByText("回答 2", { exact: true })).toBeVisible();
    expect(requests[1].model).toBe("glm");
    expect(requests[1].images).toBe("exclude");
    expect(requests[1].messages.some(message => message.parts.some(part => part.mediaType?.startsWith("image/")))).toBe(false);
    await expect(page.getByAltText("pixel.png")).toBeVisible();
    await page.reload();
    await openAgentHistory(page, "识别图片");
    await expect(selector).toContainText("GLM-5.3 Flash");
    await expect(page.getByText("本轮仅携带文字上下文；历史原图仍保留在本地，切换到识图模型可再次使用。")).toBeVisible();
    await expect(page.getByAltText("pixel.png")).toBeVisible();
    await selector.click();
    await page.getByRole("option", { name: /GPT-6.1 Sol/ }).click();
    await input.fill("再看原图");
    await input.press("Enter");
    await expect(page.getByText("回答 3", { exact: true })).toBeVisible();
    expect(requests[2].images).toBe("include");
    expect(requests[2].messages.some(message => message.parts.some(part => part.mediaType === "image/png"))).toBe(true);
  });
}

test("unavailable models explain their state and Markdown uploads use plain text", async ({ page }) => {
  const requests = await setup(page, true);
  await page.goto("/agent");
  const selector = page.getByRole("combobox", { name: "助理模型" });
  await selector.click();
  const option = page.getByRole("option", { name: /GPT-6.1 Sol/ });
  await expect(option).toHaveAttribute("aria-disabled", "true");
  await expect(option).toContainText("图片计量尚未配置");
  await page.keyboard.press("Escape");
  const upload = page.getByLabel("上传附件", { exact: true });
  await upload.setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("unsupported") });
  await expect(page.getByRole("alert")).toContainText("仅支持 PNG、JPEG、WebP、TXT 和 Markdown");
  await upload.setInputFiles({ name: "notes.md", mimeType: "", buffer: Buffer.from("# 笔记") });
  await page.locator("[data-agent-composer] textarea").fill("读笔记");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("回答 1", { exact: true })).toBeVisible();
  const file = requests[0].messages.flatMap(message => message.parts).find(part => part.type === "file");
  expect(file?.mediaType).toBe("text/plain");
  expect(file?.url).toMatch(/^data:text\/plain;base64,/);
});

test("floating assistant exposes the same model choices", async ({ page }) => {
  await setup(page);
  await page.goto("/mastery");
  await page.locator("[data-agent-floating-trigger]").click();
  const panel = page.locator("[data-agent-floating-panel]");
  const selector = panel.getByRole("combobox", { name: "助理模型" });
  await expect(selector).toBeVisible();
  await selector.click();
  await page.getByRole("option", { name: /GPT-6.1 Sol/ }).click();
  await expect(selector).toContainText("GPT-6.1 Sol");
});

test("restoring a disabled preference selects an available model without showing old reply model labels", async ({ page }) => {
  const requests = await setup(page);
  await page.goto("/agent");
  const selector = page.getByRole("combobox", { name: "助理模型" });
  await selector.click();
  await page.getByRole("option", { name: /GPT-6.1 Sol/ }).click();
  const input = page.locator("[data-agent-composer] textarea");
  await input.fill("保存模型偏好");
  await input.press("Enter");
  await expect(page.getByText("回答 1", { exact: true })).toBeVisible();
  await page.route("**/api/agent/chat", route => route.request().method() !== "GET" ? route.fallback() : route.fulfill({ json: { success: true, data: {
    enabled: true, defaultModel: "deepseek", models: choices.map(choice => choice.id === "gpt" ? { ...choice, available: false, reason: "disabled" } : choice),
  } } }));
  await page.reload();
  await openAgentHistory(page, "保存模型偏好");
  await expect(selector).toContainText("DeepSeek Flash");
  await expect(page.locator("[data-agent-reply-model]")).toHaveCount(0);
  await expect(page.locator("[data-agent-assistant-turn]")).not.toContainText("GPT-6.1 Sol");
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  await page.route("**/api/agent/chat", async route => {
    if (route.request().method() === "POST") await pending;
    await route.fallback();
  });
  await input.fill("继续回答");
  await input.press("Enter");
  try { await expect(selector).toBeDisabled(); }
  finally { finish(); }
  await expect(page.getByText("回答 2", { exact: true })).toBeVisible();
  expect(requests[1].model).toBe("deepseek");
});


test("admin image limits allow more than four images and more than eight MiB without lifting text limits", async ({ page }) => {
  const requests = await setup(page, false, { maxImages: 8, maxImageBytes: 10 * 1024 * 1024, maxImagePixels: 32_000_000 });
  await page.goto("/agent");
  const selector = page.getByRole("combobox", { name: "助理模型" });
  await expect(selector).toContainText("DeepSeek Flash");
  await selector.click();
  await page.getByRole("option", { name: /GPT-6.1 Sol/ }).click();
  const upload = page.getByLabel("上传附件", { exact: true });
  const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=", "base64");
  await upload.setInputFiles({ name: "too-large.png", mimeType: "image/png", buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await expect(page.getByRole("alert")).toContainText("超过 10 MiB");
  const large = Buffer.concat([pixel, Buffer.alloc(9 * 1024 * 1024)]);
  await upload.setInputFiles([
    ...Array.from({ length: 5 }, (_, index) => ({ name: `picture-${index}.png`, mimeType: "image/png", buffer: index < 2 ? large : pixel })),
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("test notes") },
  ]);
  await expect(page.getByRole("alert")).toHaveCount(0);
  const input = page.locator("[data-agent-composer] textarea");
  await input.fill("读取五张图片和笔记");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("回答 1", { exact: true })).toBeVisible();
  const files = requests[0].messages.flatMap(message => message.parts).filter(part => part.type === "file");
  expect(files.filter(part => part.mediaType === "image/png")).toHaveLength(5);
  expect(files.filter(part => part.mediaType === "text/plain")).toHaveLength(1);
  expect(Buffer.byteLength(JSON.stringify(requests[0]))).toBeGreaterThan(16 * 1024 * 1024);
  await upload.setInputFiles({ name: "large-notes.txt", mimeType: "text/plain", buffer: Buffer.alloc(8 * 1024 * 1024 + 1) });
  await expect(page.getByRole("alert")).toContainText("超过 8 MiB");
  await upload.setInputFiles(Array.from({ length: 4 }, (_, index) => ({ name: `next-${index}.png`, mimeType: "image/png", buffer: pixel })));
  await input.fill("继续识图");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("本轮最多发送 8 张图片（含历史图片）");
  expect(requests).toHaveLength(1);
});
