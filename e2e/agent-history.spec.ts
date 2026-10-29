import { expect, test, type Page } from "@playwright/test";
import { mockApis } from "./production-readiness.fixture";

async function prepare(page: Page) {
  await mockApis(page);
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: {
    user: { id: "history-user", name: "博士", email: "history@example.test" },
    session: { expiresAt: "2099-01-01T00:00:00Z" },
  } }));
  const requests: Array<{ messages: Array<{ role: string; parts: Array<{ type: string; text?: string; filename?: string }> }> }> = [];
  await page.route("**/api/agent/chat", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { success: true, data: { enabled: true, provider: "deepseek", model: "test" } } });
    requests.push(route.request().postDataJSON());
    const index = requests.length;
    const chunks = [
      { type: "start", messageId: `answer-${index}` }, { type: "start-step" },
      { type: "text-start", id: `text-${index}` }, { type: "text-delta", id: `text-${index}`, delta: `已回答第 ${index} 次提问。` },
      { type: "text-end", id: `text-${index}` }, { type: "finish-step" }, { type: "finish", finishReason: "stop" },
    ];
    return route.fulfill({ contentType: "text/event-stream", headers: { "x-vercel-ai-ui-message-stream": "v1" }, body: chunks.map((part) => `data: ${JSON.stringify(part)}\n\n`).join("") + "data: [DONE]\n\n" });
  });
  return requests;
}

async function storedHistory(page: Page, owner = "history-user") {
  return page.evaluate((key) => new Promise<{ conversations: Array<{ id: string; title: string; messages: unknown[] }>; expanded: boolean }>((resolve, reject) => {
    const open = indexedDB.open("riic-agent-history-v1", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const read = database.transaction("accounts").objectStore("accounts").get(key);
      read.onsuccess = () => { resolve(read.result ?? { conversations: [], expanded: true }); database.close(); };
      read.onerror = () => { reject(read.error); database.close(); };
    };
  }), owner);
}

for (const width of [1440, 375]) {
  test(`Agent starts fresh after reload, resumes history and keeps five chats at ${width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    const requests = await prepare(page);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: width < 768 ? "reduce" : "no-preference" });
    await page.goto("/agent");
    const input = page.getByRole("textbox", { name: "发给可露希尔的消息" });
    await expect(input).toBeVisible();
    await page.locator('input[aria-label="上传附件"]').setInputFiles({ name: "上下文.txt", mimeType: "text/plain", buffer: Buffer.from("续聊也应保留这个附件") });
    await input.fill("第一个问题");
    await input.press("Enter");
    await expect(page.getByText("已回答第 1 次提问。", { exact: true })).toBeVisible();
    await expect.poll(async () => (await storedHistory(page)).conversations[0]?.messages.length).toBe(2);
    await page.reload();
    await expect(page.getByRole("heading", { name: "想了解什么？" })).toBeVisible();
    await expect(page.getByText("已回答第 1 次提问。", { exact: true })).toHaveCount(0);
    expect((await storedHistory(page)).conversations[0]?.title).toBe("第一个问题");
    for (let index = 2; index <= 6; index++) {
      await input.fill(`问题 ${index}`);
      await input.press("Enter");
      await expect(page.getByText(`已回答第 ${index} 次提问。`, { exact: true })).toBeVisible();
      await expect.poll(async () => (await storedHistory(page)).conversations[0]?.title).toBe(`问题 ${index}`);
      if (index < 6) await page.getByRole("button", { name: "新对话", exact: true }).click();
    }
    await expect.poll(async () => (await storedHistory(page)).conversations.length).toBe(5);
    expect((await storedHistory(page)).conversations.some((entry) => entry.title === "第一个问题")).toBe(false);
    if (width < 768) await page.getByRole("button", { name: /^(切换侧边栏|切換側邊欄|Toggle Sidebar)$/i }).click();
    const history = page.locator("[data-agent-history]");
    await expect(history.getByRole("link")).toHaveCount(5);
    await expect(page.getByRole("button", { name: "历史记录", exact: true })).toHaveCount(0);
    await expect(page.locator('[data-slot="sidebar-menu-item"]').filter({ has: page.locator('[data-primary-navigation-page="agent"]') }).locator("[data-agent-history]")).toBeVisible();
    await page.getByRole("button", { name: "折叠对话历史" }).click();
    await expect(history).toBeHidden();
    await expect.poll(async () => (await storedHistory(page)).expanded).toBe(false);
    await page.reload();
    await expect(input).toBeVisible();
    if (width < 768) await page.getByRole("button", { name: /^(切换侧边栏|切換側邊欄|Toggle Sidebar)$/i }).click();
    await expect(page.getByRole("button", { name: "展开对话历史" })).toBeVisible();
    await page.getByRole("button", { name: "展开对话历史" }).click();
    let releaseReady!: () => void;
    const readyGate = new Promise<void>((resolve) => { releaseReady = resolve; });
    await page.route("**/api/agent/chat", async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await readyGate;
      return route.fulfill({ json: { success: true, data: { enabled: true } } });
    });
    try {
      await history.getByRole("link", { name: "问题 2", exact: true }).click();
      await expect(page.getByText("已回答第 2 次提问。", { exact: true })).toBeVisible();
      await expect(page.locator("[data-agent-composer]")).toHaveCount(0);
    } finally { releaseReady(); }
    const composer = page.locator("[data-agent-composer]");
    await expect(composer).toBeVisible();
    await expect(composer).toHaveCSS("opacity", "1");
    const animation = await composer.evaluate((el) => getComputedStyle(el).animationName);
    if (width < 768) expect(animation).toBe("none");
    else {
      expect(animation).toContain("composerEnter");
      const frames = await composer.evaluate((el) => (el.getAnimations()[0].effect as KeyframeEffect).getKeyframes());
      expect(frames[0].transform).toBe("translateY(20px)");
      expect(frames.at(-1)?.transform).toBe("translateY(0px)");
    }
    await expect(page.locator("[data-agent-page-scrollbar]")).toHaveCount(1);
    if (width < 768) await expect(page.getByRole("dialog")).toHaveCount(0);
    await input.fill("继续第二个问题");
    await input.press("Enter");
    await expect(page.getByText("已回答第 7 次提问。", { exact: true })).toBeVisible();
    expect(requests[6].messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(requests[6].messages[0].parts.some((part) => part.text === "问题 2")).toBe(true);
    await expect.poll(async () => (await storedHistory(page)).conversations[0]?.title).toBe("问题 2");
    expect((await storedHistory(page)).conversations).toHaveLength(5);
  });
}

test("Agent resumes a saved attachment conversation from another page", async ({ page }) => {
  const requests = await prepare(page);
  await page.goto("/agent");
  const input = page.getByRole("textbox", { name: "发给可露希尔的消息" });
  await expect(input).toBeVisible();
  await page.locator('input[aria-label="上传附件"]').setInputFiles({ name: "资料.txt", mimeType: "text/plain", buffer: Buffer.from("保存附件上下文") });
  await input.fill("帮我看看资料");
  await input.press("Enter");
  await expect(page.getByText("已回答第 1 次提问。", { exact: true })).toBeVisible();
  await expect.poll(async () => (await storedHistory(page)).conversations[0]?.messages.length).toBe(2);
  await page.goto("/mastery");
  await page.locator("[data-agent-history]").getByRole("link", { name: "帮我看看资料", exact: true }).click();
  await expect(page.getByText("已回答第 1 次提问。", { exact: true })).toBeVisible();
  await input.fill("继续分析");
  await input.press("Enter");
  await expect(page.getByText("已回答第 2 次提问。", { exact: true })).toBeVisible();
  expect(requests[1].messages[0].parts.some((part) => part.type === "file" && part.filename === "资料.txt")).toBe(true);
  expect(requests[1].messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
});

test("Agent histories are isolated by account and storage errors stay visible", async ({ page }) => {
  await prepare(page);
  await page.goto("/agent");
  const input = page.getByRole("textbox", { name: "发给可露希尔的消息" });
  await input.fill("只属于第一个账号");
  await input.press("Enter");
  await expect.poll(async () => (await storedHistory(page)).conversations.length).toBe(1);
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: {
    user: { id: "second-history-user", name: "另一位博士", email: "another@example.test" }, session: { expiresAt: "2099-01-01T00:00:00Z" },
  } }));
  await page.reload();
  await expect(page.getByRole("heading", { name: "想了解什么？" })).toBeVisible();
  await expect(page.locator("[data-agent-history]").getByRole("link")).toHaveCount(0);
  expect((await storedHistory(page)).conversations).toHaveLength(1);
  await page.addInitScript(() => { Object.defineProperty(window, "indexedDB", { get() { throw new DOMException("Blocked", "SecurityError"); } }); });
  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: "浏览器暂时无法保存对话历史" })).toBeVisible();
  await expect(input).toBeVisible();
});
