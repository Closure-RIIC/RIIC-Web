import { expect, test, type Route } from "@playwright/test";
import { TERMS_VERSION, PRIVACY_VERSION } from "../src/legal-policy";
import { amiyaPortrait, requestId, diagnosticId, layout243, waitForOwnAnimations, planData, twoShiftPlanData, fourShiftPlanData, adjacentPortraitPlanData, lazyPortraitPlanData, authenticatedSklandSnapshot, mockApis, mockAnonymousWebsiteSession, openSklandOverview, navigateToPrimaryPage, seedPreferences, seedV4Session } from "./production-readiness.fixture";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      session: { id: "test-session", token: "test-token", userId: "test-user", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      user: { id: "test-user", name: "测试用户", email: "test@example.com", emailVerified: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    }),
  }));
});

test("cold HTML contains the workbench shell instead of only the client loading placeholder", async ({ request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain("data-calculator-controls");
  expect(html).toContain("data-calculator-start-panel");
  expect(html).not.toContain("从可执行的排班开始");
  expect(html).not.toContain("把你的 BOX 变成今天就能照着换的三班方案");
  expect(html).not.toContain("登录只用于保护个人数据");
  expect(html).not.toContain("生成结果前，不需要先理解所有配置项");
  expect(html).not.toContain('data-schedule-view="compact"');
  expect(html).not.toContain('data-schedule-view="list"');
  expect(html).not.toContain("正在加载基建计算器");
});

test("an anonymous cold start probes the shared session once and does not touch Skland", async ({ page }) => {
  await page.unroute("**/api/auth/get-session");
  let sessionRequests = 0;
  const sklandRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/auth/get-session") sessionRequests += 1;
    if (pathname.startsWith("/api/skland/")) sklandRequests.push(pathname);
  });
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "null",
  }));
  await mockApis(page, { sklandConfigured: true });
  await page.goto("/");

  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  await expect(page.locator('[data-calculator-start-panel][data-onboarding-active="true"]')).toBeVisible();
  await expect(page.getByText("登录网站账号", { exact: true })).toBeVisible();
  await expect(page.getByText("导入自己的 BOX", { exact: true })).toBeVisible();
  await expect(page.getByText("支持自主上传或第三方同步。", { exact: true })).toBeVisible();
  await expect(page.getByText("生成第一份方案", { exact: true })).toBeVisible();
  const sampleTrial = page.locator("[data-anonymous-sample-trial]");
  await expect(sampleTrial).toBeVisible();
  await expect(sampleTrial.getByRole("heading", { name: "不想登录？只想看看全角色导入之后的排班效果" })).toBeVisible();
  await expect(sampleTrial.getByRole("button", { name: "直接查看示例排班" })).toBeVisible();
  await expect(page.getByText("从可执行的排班开始", { exact: true })).toHaveCount(0);
  await expect(page.getByText("把你的 BOX 变成今天就能照着换的三班方案", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/登录只用于保护个人数据|生成结果前，不需要先理解所有配置项/)).toHaveCount(0);
  const onboardingSteps = page.getByRole("list", { name: "生成个人排班的步骤" }).locator(":scope > li");
  await expect(onboardingSteps).toHaveCount(3);
  await expect(onboardingSteps.locator("article.infra-room-surface")).toHaveCount(3);
  await expect(page.getByRole("dialog", { name: "登录网站账号" })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(/正在恢复网站账号|正在确认网站账号|正在打开账号登录/)).toHaveCount(0);
  await expect.poll(() => sessionRequests).toBe(1);
  await page.waitForTimeout(100);
  expect(sklandRequests).toEqual([]);

  const importTrigger = page.getByRole("button", { name: "配置Box与布局" });
  await importTrigger.click();
  await expect(page.getByRole("dialog", { name: "登录网站账号" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "登录网站账号" })).toHaveCount(0);
  await expect(importTrigger).toBeFocused();
});

test("the anonymous sample trial fetches and solves once before showing the schedule", async ({ page }) => {
  await mockAnonymousWebsiteSession(page);
  await mockApis(page, { taskQueueEnabled: true, dismissSolverWarning: false });
  let releasePlan!: () => void;
  const planGate = new Promise<void>((resolve) => {
    releasePlan = resolve;
  });
  let sampleRequests = 0;
  let planRequests = 0;
  let taskRequests = 0;
  let planPayload: Record<string, unknown> | null = null;
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/sample-operbox") sampleRequests += 1;
    if (pathname === "/api/tasks") taskRequests += 1;
  });
  await page.unroute("**/api/plan");
  await page.route("**/api/plan", async (route) => {
    planRequests += 1;
    planPayload = route.request().postDataJSON() as Record<string, unknown>;
    await planGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: planData, requestId }),
    });
  });
  await page.goto("/");

  const trialButton = page.getByRole("button", { name: "直接查看示例排班" });
  await trialButton.click();
  await expect(page.getByRole("button", { name: "正在生成示例排班…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "配置Box与布局" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "暂时跳过引导" })).toBeDisabled();
  await expect.poll(() => ({ sampleRequests, planRequests, taskRequests })).toEqual({ sampleRequests: 1, planRequests: 1, taskRequests: 0 });
  expect(planPayload).toMatchObject({ boxSource: "sample", sourceName: "243 全精二示例" });
  expect(planPayload).not.toHaveProperty("operbox");

  releasePlan();
  await expect(page.locator("[data-plan-board]")).toHaveAttribute("data-plan-revision", diagnosticId);
  await expect(page.locator("[data-anonymous-sample-trial]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("arknights-infra-calc-beta-onboarding-v1"))).toBe("completed");

  // Acknowledge the completion notice before opening another modal. The result
  // board can mount before the notice opens, so an automatic handler can race
  // the login dialog and try to click an inert, underlying close button.
  const completionNotice = page.getByRole("dialog", { name: "排班已生成", exact: true });
  await expect(completionNotice).toBeVisible();
  await completionNotice.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(completionNotice).toHaveCount(0);

  const adjustmentTrigger = page.getByRole("button", { name: "修改练度并重算", exact: true });
  await adjustmentTrigger.click();
  await expect(page.getByRole("dialog", { name: "登录网站账号" })).toBeVisible();
  await expect(page.locator("[data-upgrade-simulation-dialog]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(adjustmentTrigger).toBeFocused();
});

test("the anonymous sample trial is absent for a signed-in onboarding session", async ({ page }) => {
  await mockApis(page);
  await page.goto("/");

  await expect(page.locator('[data-calculator-start-panel][data-onboarding-active="true"]')).toBeVisible();
  await expect(page.locator("[data-anonymous-sample-trial]")).toHaveCount(0);
});

test("an anonymous session with a personal BOX does not render the sample trial", async ({ page }) => {
  await mockAnonymousWebsiteSession(page);
  await mockApis(page);
  await seedV4Session(page, null, { boxSource: "maa", onboardingValue: null });
  await page.goto("/");

  await expect(page.locator('[data-calculator-start-panel][data-onboarding-active="true"]')).toBeVisible();
  await expect(page.getByText("个人 BOX 已就绪，可以配置布局并生成方案。", { exact: true })).toBeVisible();
  await expect(page.locator("[data-anonymous-sample-trial]")).toHaveCount(0);
});

test("a failed anonymous sample solve keeps the trial available for retry", async ({ page }) => {
  await mockAnonymousWebsiteSession(page);
  await mockApis(page);
  let planRequests = 0;
  await page.unroute("**/api/plan");
  await page.route("**/api/plan", async (route) => {
    planRequests += 1;
    if (planRequests === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: { code: "AIC-PLAN-3001", message: "排班服务暂不可用，请稍后重试。", retryable: true },
          requestId,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: planData, requestId }),
    });
  });
  await page.goto("/");

  const trial = page.locator("[data-anonymous-sample-trial]");
  await trial.getByRole("button", { name: "直接查看示例排班" }).click();
  await expect(page.locator('[data-slot="live-activity"]')).toHaveAttribute("data-activity-phase", "error");
  await expect(trial).toBeVisible();
  await expect(trial.getByRole("button", { name: "直接查看示例排班" })).toBeEnabled();
  expect(planRequests).toBe(1);

  await trial.getByRole("button", { name: "直接查看示例排班" }).click();
  await expect(page.locator("[data-plan-board]")).toHaveAttribute("data-plan-revision", diagnosticId);
  expect(planRequests).toBe(2);
});

test("the onboarding cards reuse the Skland technical grid and dismiss into the empty schedule", async ({ page }) => {
  await mockApis(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const onboardingList = page.getByRole("list", { name: "生成个人排班的步骤" });
  const cards = onboardingList.locator(":scope > li");
  const startPanel = page.getByRole("region", { name: "生成排班起步区" });
  const sidebarInset = page.locator('[data-slot="sidebar-inset"]');
  await expect(cards).toHaveCount(3);

  const expectFullScreenAndCentered = async (viewportHeight: number, mobile: boolean) => {
    const geometry = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('[data-calculator-start-panel]')?.getBoundingClientRect();
      const inset = document.querySelector<HTMLElement>('[data-slot="sidebar-inset"]')?.getBoundingClientRect();
      const list = document.querySelector<HTMLElement>('ol[aria-label="生成个人排班的步骤"]')?.getBoundingClientRect();
      const topbar = document.querySelector<HTMLElement>('[data-app-topbar]')?.getBoundingClientRect();
      if (!panel || !inset || !list) throw new Error("Onboarding geometry is unavailable.");
      return {
        panel: { left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom, height: panel.height },
        inset: { left: inset.left, right: inset.right, top: inset.top },
        topbarBottom: topbar?.bottom ?? null,
        listCenter: list.left + list.width / 2,
        panelCenter: panel.left + panel.width / 2,
      };
    });
    expect(geometry.panel.left).toBeCloseTo(geometry.inset.left, 0);
    expect(geometry.panel.right).toBeCloseTo(geometry.inset.right, 0);
    expect(geometry.panel.top).toBeCloseTo(mobile ? geometry.topbarBottom ?? 0 : geometry.inset.top, 0);
    expect(geometry.panel.bottom).toBeGreaterThanOrEqual(viewportHeight - 1);
    expect(geometry.panel.height).toBeGreaterThanOrEqual(viewportHeight - (mobile ? geometry.topbarBottom ?? 0 : 0) - 1);
    expect(geometry.listCenter).toBeCloseTo(geometry.panelCenter, 0);
    await expect(startPanel).toBeVisible();
    await expect(sidebarInset).toBeVisible();
  };

  await expectFullScreenAndCentered(844, true);

  const mobileBoxes = await cards.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, top: box.top, width: box.width };
  }));
  expect(mobileBoxes[0].left).toBeCloseTo(mobileBoxes[1].left, 0);
  expect(mobileBoxes[1].left).toBeCloseTo(mobileBoxes[2].left, 0);
  expect(mobileBoxes[0].width).toBeCloseTo(mobileBoxes[2].width, 0);
  expect(mobileBoxes[1].top).toBeGreaterThan(mobileBoxes[0].top);
  expect(mobileBoxes[2].top).toBeGreaterThan(mobileBoxes[1].top);
  let dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);

  await page.setViewportSize({ width: 768, height: 900 });
  await expectFullScreenAndCentered(900, false);
  const tabletBoxes = await cards.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, top: box.top, width: box.width };
  }));
  expect(tabletBoxes[0].top).toBeCloseTo(tabletBoxes[1].top, 0);
  expect(tabletBoxes[0].width).toBeCloseTo(tabletBoxes[1].width, 0);
  expect(tabletBoxes[2].top).toBeGreaterThan(tabletBoxes[0].top);
  expect(tabletBoxes[2].width).toBeGreaterThan(tabletBoxes[0].width * 1.8);
  dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expectFullScreenAndCentered(900, false);
  const desktopBoxes = await cards.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { top: box.top, width: box.width };
  }));
  expect(desktopBoxes[0].top).toBeCloseTo(desktopBoxes[1].top, 0);
  expect(desktopBoxes[1].top).toBeCloseTo(desktopBoxes[2].top, 0);
  expect(desktopBoxes[0].width).toBeCloseTo(desktopBoxes[2].width, 0);

  dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);

  await page.getByRole("button", { name: "暂时跳过引导" }).click();
  await expect(page.locator("[data-calculator-start-panel]")).toHaveCount(0);
  await expect(page.locator("[data-calculator-regenerate-panel]")).toHaveCount(0);
  await expect(page.locator("[data-plan-board]")).toBeVisible();
  await expect(page.locator('[data-operator-identity="empty"]').first()).toBeVisible();
  await expect(onboardingList).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重新查看三步起步卡" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("arknights-infra-calc-beta-onboarding-v1"))).toBe("dismissed");
});

test("completed onboarding returns to the empty schedule after changing the layout", async ({ page }) => {
  await mockApis(page);
  await seedV4Session(page, planData, { boxSource: "maa" });
  await page.addInitScript(() => {
    window.localStorage.setItem("arknights-infra-calc-beta-onboarding-v1", "completed");
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.locator("[data-plan-board]")).toBeVisible();
  await page.getByRole("button", { name: "配置Box与布局" }).first().click();
  const setupDialog = page.getByRole("dialog");
  await setupDialog.getByRole("button", { name: "继续", exact: true }).click();
  await setupDialog.getByRole("button", { name: /^342/ }).click();
  await setupDialog.getByRole("button", { name: "Close" }).click();
  await page.getByRole("dialog", { name: "关闭排班设置？" })
    .getByRole("button", { name: "关闭设置" })
    .click();

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator("[data-calculator-start-panel]")).toHaveCount(0);
    await expect(page.locator("[data-calculator-regenerate-panel]")).toHaveCount(0);
    await expect(page.locator("[data-plan-board]")).toBeVisible();
    await expect(page.locator(`[data-schedule-view="${viewport.width >= 1024 ? "compact" : "list"}"]`)).toBeVisible();
    await expect(page.locator('[data-operator-identity="empty"]').first()).toBeVisible();
    await expect(page.getByRole("button", { name: "生成排班" })).toBeVisible();
    await expect(page.getByText("生成第一份方案", { exact: true })).toHaveCount(0);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth, JSON.stringify({ viewport, dimensions })).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  }
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("arknights-infra-calc-beta-onboarding-v1"))).toBe("completed");
});

test("an authenticated personal plan stays disabled while the planner is unavailable", async ({ page }) => {
  await mockApis(page, { plannerReady: false });
  await seedV4Session(page, null, { boxSource: "maa" });
  let planRequests = 0;
  await page.route("**/api/plan", (route) => {
    planRequests += 1;
    return route.abort();
  });
  await page.goto("/");

  const runButton = page.getByRole("button", { name: "生成排班" }).first();
  await expect(runButton).toBeDisabled();
  await expect(runButton).toContainText("排班服务未就绪");
  await expect(runButton).toHaveAttribute("title", "排班服务尚未就绪");
  expect(planRequests).toBe(0);
});

test("a 768px solved plan defaults to list layout and stays inside the viewport", async ({ page }) => {
  await mockApis(page);
  await seedV4Session(page, null);
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  await page.getByRole("button", { name: "生成排班" }).click();
  await expect(page.locator('[data-schedule-view="list"]')).toBeVisible();
  await expect(page.getByRole("tab", { name: "一图流布局" })).toHaveCount(0);

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
});

test("filing links and Rainyun cloud services align left on mobile and right on desktop", async ({ page }) => {
  await mockApis(page);
  await seedPreferences(page);
  await page.goto("/");

  const filingLink = page.getByRole("link", { name: "沪ICP备2026041492号" });
  const publicSecurityLink = page.getByRole("link", { name: "沪公网安备31011502407364号" });
  const link = page.getByRole("link", { name: "由雨云提供云计算服务（在新标签页打开雨云官网）" });
  const image = link.locator("img");
  await expect(filingLink).toHaveAttribute("href", "https://beian.miit.gov.cn/");
  await expect(publicSecurityLink).toHaveAttribute("href", "https://www.beian.gov.cn/portal/registerSystemInfo?recordcode=31011502407364");
  await expect(publicSecurityLink).toHaveAttribute("rel", /noopener/);
  await expect.poll(() => publicSecurityLink.locator("img").evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(link).toHaveAttribute("href", "https://www.rainyun.com/riic_");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
  await expect(link).toHaveAttribute("rel", /noreferrer/);
  await expect(link).toContainText("由");
  await expect(link).toContainText("提供云计算服务");
  await expect(image).toHaveAttribute("src", /rainyun-logo\.png/);
  await expect.poll(() => image.evaluate((element) => {
    const logo = element as HTMLImageElement;
    return logo.complete && logo.naturalWidth > 0 && logo.naturalHeight > 0;
  })).toBe(true);

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(publicSecurityLink).toBeVisible();
    if (viewport.width === 1440) {
      await expect.poll(() => page.locator("[data-filing-links]").evaluate((element) => {
        const [icp, security] = Array.from(element.querySelectorAll("a"), (link) => link.getBoundingClientRect());
        return security.x > icp.right && Math.abs(security.y - icp.y) < 1;
      })).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(link).toBeVisible();
    await link.focus();
    await expect(link).toBeFocused();

    const geometry = await link.evaluate((element) => {
      const linkBox = element.getBoundingClientRect();
      const logoBox = element.querySelector("img")?.getBoundingClientRect();
      const copyBoxes = Array.from(element.querySelectorAll<HTMLElement>("[data-rainyun-copy]"))
        .map((copy) => copy.getBoundingClientRect());
      const footer = element.closest("footer");
      const footerBox = footer?.getBoundingClientRect();
      const footerStyle = footer ? getComputedStyle(footer) : null;
      return {
        height: linkBox.height,
        logoWidth: logoBox?.width ?? Number.NaN,
        logoCenterY: logoBox ? logoBox.top + logoBox.height / 2 : Number.NaN,
        copyCenterYs: copyBoxes.map((copy) => copy.top + copy.height / 2),
        right: linkBox.right,
        left: linkBox.left,
        footerLeft: footerBox?.left ?? Number.NaN,
        footerPaddingLeft: Number.parseFloat(footerStyle?.paddingLeft ?? "0"),
        footerRight: footerBox?.right ?? Number.NaN,
        footerPaddingRight: Number.parseFloat(footerStyle?.paddingRight ?? "0"),
      };
    });
    expect(geometry.height).toBeGreaterThanOrEqual(44 - 0.01);
    expect(geometry.logoWidth).toBeCloseTo(viewport.width < 640 ? 56 : 64, 0);
    for (const copyCenterY of geometry.copyCenterYs) {
      expect(copyCenterY - geometry.logoCenterY).toBeCloseTo(2, 0);
    }
    if (viewport.width < 768) {
      expect(geometry.left).toBeCloseTo(geometry.footerLeft + geometry.footerPaddingLeft, 0);
    } else {
      expect(geometry.right).toBeCloseTo(geometry.footerRight - geometry.footerPaddingRight, 0);
    }
  }
});

test("primary pages prefetch after hydration and navigate on the first click", async ({ page }) => {
  const trainingRouteRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/training") {
      trainingRouteRequests.push(request.url());
    }
  });
  await mockApis(page, { sklandConfigured: true, sklandSnapshot: authenticatedSklandSnapshot });
  await seedPreferences(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const destinations = [
    { name: "练卡建议", href: "/training", root: "[data-training-page]" },
    { name: "技能查询", href: "/skills", root: "[data-skill-query-page]" },
    { name: "森空岛状态中心", href: "/skland", root: "[data-skland-page]" },
    { name: "账号管理", href: "/account", root: "[data-account-management]" },
  ];
  for (const destination of destinations) {
    await expect(page.getByRole("button", { name: destination.name, exact: true })).toHaveAttribute("href", destination.href);
  }
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  await expect(page.locator('[data-primary-navigation-prefetch="eager"]')).toBeVisible();
  await expect(page.locator('[data-navigation-pending]')).toHaveCount(0);

  for (const destination of destinations) {
    await page.getByRole("button", { name: destination.name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${destination.href.replace("/", "\\/")}$`));
    await expect(page.locator(destination.root)).toBeVisible({ timeout: 45_000 });
    if (destination.href === "/training") expect(trainingRouteRequests.length).toBeGreaterThan(0);
  }

  await page.getByRole("button", { name: "基建计算器", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("[data-calculator-controls]")).toBeVisible();
});

test("legacy plans API identifies the account saved-plans successor", async ({ request }) => {
  const legacy = await request.get("/api/plans");
  expect(legacy.headers().deprecation).toBe("true");
  expect(legacy.headers().link).toContain("</api/account/saved-plans>");

  const canonical = await request.get("/api/account/saved-plans");
  expect(canonical.headers().deprecation).toBeUndefined();
});

test("legacy overloaded APIs identify their resource-oriented successors", async ({ request }) => {
  const cases = [
    { method: "DELETE", path: "/api/workspace", successor: "/api/account/data-consent" },
    { method: "GET", path: "/api/admin/users?userId=user_test", successor: "/api/admin/users/user_test/sessions" },
    { method: "GET", path: "/api/admin/records?kind=runs", successor: "/api/admin/plan-runs" },
    { method: "GET", path: "/api/skland/session", successor: "/api/skland/accounts" },
    { method: "GET", path: "/api/skland/status", successor: "/api/skland/status/refresh" },
    { method: "DELETE", path: "/api/skland/data", successor: "/api/skland/account-data" },
  ] as const;
  for (const entry of cases) {
    const response = await request.fetch(entry.path, { method: entry.method });
    expect(response.headers().deprecation, `${entry.method} ${entry.path}`).toBe("true");
    expect(response.headers().link, `${entry.method} ${entry.path}`).toContain(`<${entry.successor}>`);
  }
  const legacyAdminAction = await request.post("/api/admin/users", {
    data: { userId: "user_test", action: "revokeSessions" },
  });
  expect(legacyAdminAction.headers().deprecation).toBe("true");
  expect(legacyAdminAction.headers().link).toContain("</api/admin/users/user_test/sessions>");

  const legacyFeedbackUpdate = await request.patch("/api/admin/records", {
    data: { feedbackId: "feedback_test", status: "working", note: "test" },
  });
  expect(legacyFeedbackUpdate.headers().deprecation).toBe("true");
  expect(legacyFeedbackUpdate.headers().link).toContain("</api/admin/feedback/feedback_test>");

  const legacySingleLogout = await request.delete("/api/skland/session", {
    data: { accountId: "account_test" },
  });
  expect(legacySingleLogout.headers().deprecation).toBe("true");
  expect(legacySingleLogout.headers().link).toContain("</api/skland/accounts/account_test>");
});

test("resource-oriented admin APIs keep authentication and method boundaries", async ({ request }) => {
  const reads = [
    "/api/admin/users/user_test/sessions",
    "/api/admin/plan-runs",
    "/api/admin/plan-runs/run_test",
    "/api/admin/feedback",
    "/api/admin/feedback/feedback_test",
    "/api/admin/solver-metrics",
  ];
  for (const path of reads) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(401);
    if (path === "/api/admin/solver-metrics") {
      expect(response.headers()["cache-control"]).toContain("no-store");
    }
  }

  expect((await request.patch("/api/admin/users/user_test", {
    data: { banned: true },
  })).status()).toBe(401);
  expect((await request.delete("/api/admin/users/user_test/sessions")).status()).toBe(401);
  expect((await request.patch("/api/admin/feedback/feedback_test", {
    data: { status: "reproduced", note: "test" },
  })).status()).toBe(401);
  expect((await request.delete("/api/admin/feedback", {
    data: { ids: ["feedback_test"] },
  })).status()).toBe(401);
});

test("website login lazy-loads its UI without probing the shared session again", async ({ page }) => {
  await page.addInitScript(() => {
    window.requestIdleCallback = () => 1;
    window.cancelIdleCallback = () => undefined;
  });
  await page.unroute("**/api/auth/get-session");
  let sessionRequests = 0;
  await page.route("**/api/auth/get-session", async (route) => {
    sessionRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "null",
    });
  });
  let releaseChunks: (() => void) | undefined;
  const chunkGate = new Promise<void>((resolve) => {
    releaseChunks = resolve;
  });
  let deferredChunkRequests = 0;
  await page.route("**/_next/static/chunks/*.js", async (route) => {
    const response = await route.fetch();
    const body = await response.body();
    if (/function WebsiteAccountDialog\s*\(/.test(body.toString("utf8"))) {
      deferredChunkRequests += 1;
      await chunkGate;
    }
    await route.fulfill({ response, body });
  });
  await mockApis(page);
  await seedPreferences(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect.poll(() => sessionRequests).toBe(1);
  await page.waitForTimeout(100);

  await page.getByRole("button", { name: "账号管理", exact: true }).click();
  const loadingDialog = page.locator("[data-website-account-dialog-loading]");
  await expect(loadingDialog).toBeVisible();
  await expect(loadingDialog.getByRole("status")).toContainText("正在加载登录界面…");
  await expect(loadingDialog.locator('[data-slot="skeleton"]')).toHaveCount(0);
  await expect(page.locator("[data-website-account-panel]")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect.poll(() => deferredChunkRequests).toBeGreaterThan(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(loadingDialog.locator("[data-website-account-loading-spinner]")).toHaveCSS("animation-name", "none");
  await page.keyboard.press("Escape");
  await expect(loadingDialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "账号管理", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "账号管理", exact: true }).click();
  await expect(loadingDialog).toBeVisible();

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(loadingDialog).toBeVisible();
    const box = await loadingDialog.boundingBox();
    expect(box).not.toBeNull();
    if (viewport.width < 768) {
      // The shared loading dialog uses the same mobile sheet as the loaded UI.
      expect(box?.width).toBe(viewport.width);
      expect(box?.height).toBe(viewport.height);
    } else {
      expect(box?.width ?? 0).toBeLessThanOrEqual(viewport.width - 16);
      expect(box?.height ?? 0).toBeLessThanOrEqual(viewport.height - 16);
    }
  }

  releaseChunks?.();
  await page.unroute("**/_next/static/chunks/*.js");
  await expect(loadingDialog).toHaveCount(0);
  const accountDialog = page.getByRole("dialog", { name: "登录网站账号" });
  await expect(accountDialog.locator("[data-website-account-panel]")).toBeVisible();
  expect(sessionRequests).toBe(1);
  await expect(accountDialog.locator('[data-slot="skeleton"]')).toHaveCount(0);
  await expect(accountDialog.locator("[data-account-action-cards]")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(accountDialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "账号管理", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "账号管理", exact: true }).click();
  await expect(accountDialog.locator("[data-website-account-panel]")).toBeVisible();
  expect(sessionRequests).toBe(1);
});

test("website login opens account management after the gated navigation dialog", async ({ page }) => {
  let authenticated = false;
  await page.unroute("**/api/auth/get-session");
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: authenticated ? JSON.stringify({
      session: { id: "signed-in-session", token: "token", userId: "signed-in-user", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      user: { id: "signed-in-user", name: "新用户", email: "signed-in@example.test", emailVerified: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    }) : "null",
  }));
  await page.route("**/api/auth/sign-in/email", (route) => {
    authenticated = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ redirect: false, token: "token", user: { id: "signed-in-user", name: "新用户", email: "signed-in@example.test", emailVerified: true } }) });
  });
  await mockApis(page, { sklandConfigured: true });
  await seedPreferences(page);
  await page.goto("/");
  await page.getByRole("button", { name: "账号管理", exact: true }).click();
  const accountPanel = page.locator("[data-website-account-panel]");
  await accountPanel.getByRole("textbox", { name: "邮箱", exact: true }).fill("signed-in@example.test");
  await accountPanel.getByLabel("密码", { exact: true }).fill("secure-password-1");
  await accountPanel.getByRole("button", { name: "登录", exact: true }).click();

  await expect(page.getByRole("dialog", { name: "登录网站账号" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "账号管理", exact: true })).toHaveAttribute("data-active", "");
  await expect(page.locator("[data-account-management]")).toBeVisible();
  await expect(page.getByText("signed-in@example.test", { exact: true })).toBeVisible();
  const websiteAvatar = page.locator("[data-website-account-avatar]");
  await expect(websiteAvatar).toBeVisible();
  await expect(websiteAvatar).toHaveAttribute("data-account-orb-color", /^#[0-9A-F]{6}$/);
  await expect(websiteAvatar.locator("canvas")).toBeVisible();
  await expect(websiteAvatar.locator("[data-fluid-orb-fallback]")).toBeVisible();
  await expect(websiteAvatar.locator("[data-fluid-orb-fallback]")).toHaveCSS("opacity", "0");
  await expect(websiteAvatar).not.toContainText("新");
  const websiteAvatarBox = await websiteAvatar.boundingBox();
  expect(websiteAvatarBox?.width).toBeCloseTo(56, 0);
  expect(websiteAvatarBox?.height).toBeCloseTo(56, 0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(websiteAvatar).toHaveAttribute("data-fluid-orb-motion", /^(still|fallback)$/);
});

test("website login resumes the protected personal plan intent", async ({ page }) => {
  let authenticated = false;
  await page.unroute("**/api/auth/get-session");
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: authenticated ? JSON.stringify({
      session: { id: "signed-in-session", token: "token", userId: "signed-in-user", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      user: { id: "signed-in-user", name: "新用户", email: "signed-in@example.test", emailVerified: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    }) : "null",
  }));
  await page.route("**/api/auth/sign-in/email", (route) => {
    authenticated = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ redirect: false, token: "token", user: { id: "signed-in-user", name: "新用户", email: "signed-in@example.test", emailVerified: true } }) });
  });
  await mockApis(page);
  await seedV4Session(page, null, { boxSource: "maa" });
  await page.goto("/");

  await page.getByRole("button", { name: "生成排班" }).click();
  const accountPanel = page.locator("[data-website-account-panel]");
  await accountPanel.getByRole("textbox", { name: "邮箱", exact: true }).fill("signed-in@example.test");
  await accountPanel.getByLabel("密码", { exact: true }).fill("secure-password-1");
  await accountPanel.getByRole("button", { name: "登录", exact: true }).click();

  await expect(page.getByRole("dialog", { name: "登录网站账号" })).toHaveCount(0);
  await expect(page.locator("[data-plan-board]")).toHaveAttribute("data-plan-revision", diagnosticId);
  await expect(page.getByRole("button", { name: "导出到 MAA" })).toBeEnabled();
});

test("website account Fluid Orb keeps its CSS fallback without WebGL", async ({ page }) => {
  await page.addInitScript(() => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value(contextId: string, ...args: unknown[]) {
        if (contextId === "webgl") return null;
        return Reflect.apply(originalGetContext, this, [contextId, ...args]);
      },
    });
  });
  await mockApis(page, { sklandConfigured: true });
  await seedPreferences(page);
  await page.goto("/account");

  const websiteAvatar = page.locator("[data-website-account-avatar]");
  await expect(websiteAvatar).toBeVisible();
  await expect(websiteAvatar).toHaveAttribute("data-fluid-orb-motion", "fallback");
  await expect(websiteAvatar.locator("[data-fluid-orb-fallback]")).toBeVisible();
  await expect(websiteAvatar.locator("[data-fluid-orb-fallback]")).toHaveCSS("opacity", "1");
});

test("seven-day bindings stay visible and require renewed authorization", async ({ page }) => {
  await mockApis(page, { sklandConfigured: true, sklandBindingCount: 1, sklandRenewalDueCount: 1 });
  await seedPreferences(page);
  await page.goto("/");
  const sklandNavigation = page.getByRole("button", { name: "森空岛状态中心", exact: true });
  await expect(sklandNavigation.locator(".lucide-cloud")).toBeVisible();
  await sklandNavigation.click();
  await expect(page.getByText("ACCOUNT TERMINAL", { exact: true })).toHaveCount(0);
  await expect(page.getByText("统一管理网站账号、登录设备和森空岛授权。森空岛凭据固定七天失效，到期后需要重新扫码。", { exact: true })).toHaveCount(0);
  await expect(page.locator("[data-skland-binding-summary]")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "七天授权期已结束，请重新授权" })).toBeVisible();
  await expect(page.locator("[data-skland-login-panel]")).toBeVisible();
});

test("a cached Skland box is labeled separately when the website binding needs browser reauthorization", async ({ page }) => {
  await mockApis(page, { sklandConfigured: true, sklandBindingCount: 1 });
  await seedV4Session(page, planData, { boxSource: "skland" });
  await page.goto("/");

  await openSklandOverview(page);
  await expect(page.getByRole("heading", { name: "森空岛已绑定，请授权当前浏览器" })).toBeVisible();
  await expect(page.getByText(/网站账号仍保留 1 个森空岛绑定/)).toBeVisible();

  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await page.getByRole("button", { name: "基建计算器", exact: true }).click();
  await page.getByRole("button", { name: "配置Box与布局" }).first().click();
  const setupDialog = page.getByRole("dialog");
  await setupDialog.getByRole("button", { name: /第 1 步，共 3 步：干员数据/ }).click();
  await expect(setupDialog.getByText("上次同步的森空岛数据", { exact: true })).toBeVisible();
});

test("account settings revokes every session and returns to the app", async ({ page }) => {
  let revokeRequests = 0;
  let authenticated = true;
  await page.unroute("**/api/auth/get-session");
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: authenticated ? JSON.stringify({
      session: { id: "test-session", token: "test-token", userId: "test-user", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      user: { id: "test-user", name: "测试用户", email: "test@example.com", emailVerified: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    }) : "null",
  }));
  await page.route("**/api/auth/revoke-sessions", (route) => {
    revokeRequests += 1;
    authenticated = false;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: true }) });
  });
  await mockApis(page);
  await seedPreferences(page);
  await page.goto("/");
  await page.getByRole("button", { name: "账号管理", exact: true }).click();

  const accountManagement = page.locator("[data-account-management]");
  await expect(accountManagement).toBeVisible();
  await expect(page.getByText("test@example.com", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "退出全部设备" }).last().click();
  await expect.poll(() => revokeRequests).toBe(1);
  await expect(page.locator("[data-account-management]")).toHaveCount(0);
  await expect(page.locator("[data-calculator-controls]")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "登录网站账号" })).toHaveCount(0);
  const accountRoute = await page.request.get("/account");
  expect(accountRoute.status()).toBe(200);
  expect(await accountRoute.text()).toContain("data-workbench-hydrated");
});

test("password reset rejects a link without a token before making a request", async ({ page }) => {
  let resetRequests = 0;
  await page.route("**/api/auth/reset-password", (route) => {
    resetRequests += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: true }) });
  });
  await page.goto("/account/reset-password");
  await expect(page.getByText("重置链接无效或缺少令牌，请重新申请密码重置邮件。")).toBeVisible();
  await expect(page.getByRole("button", { name: "确认重置" })).toBeDisabled();
  expect(resetRequests).toBe(0);
});

test("password reset requires matching password confirmation before making a request", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let resetRequests = 0;
  await page.route("**/api/auth/reset-password", async (route) => {
    resetRequests += 1;
    expect(route.request().postDataJSON()).toMatchObject({
      newPassword: "Axy123!?",
      token: "valid-reset-token",
    });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: true }) });
  });
  await page.goto("/account/reset-password?token=valid-reset-token");

  await page.getByLabel("新密码", { exact: true }).fill("weakpassword1");
  await page.getByLabel("确认新密码", { exact: true }).fill("weakpassword1");
  await page.getByRole("button", { name: "确认重置" }).click();
  await expect(page.getByText(/密码强度不足：至少 8 位/)).toBeVisible();
  expect(resetRequests).toBe(0);

  await page.getByLabel("新密码", { exact: true }).fill("Axy123!?");
  await page.getByLabel("确认新密码", { exact: true }).fill("Different-password-1");
  await expect(page.getByText(/密码强度不足：至少 8 位/)).toHaveCount(0);
  await expect(page.getByLabel("新密码", { exact: true })).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "显示新密码" }).click();
  await expect(page.getByLabel("新密码", { exact: true })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "隐藏新密码" }).click();
  await expect(page.getByLabel("新密码", { exact: true })).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "确认重置" }).click();
  await expect(page.getByText("两次输入的密码不一致。", { exact: true })).toBeVisible();
  expect(resetRequests).toBe(0);

  await page.getByLabel("确认新密码", { exact: true }).fill("Axy123!?");
  await expect(page.getByText("两次输入的密码不一致。", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "确认重置" }).click();
  await expect.poll(() => resetRequests).toBe(1);
  await expect(page.getByText("密码已重置，旧 Session 已撤销，请返回首页登录。", { exact: true })).toBeVisible();
});

test("anonymous MAA data cannot drive planning or training advice", async ({ page }) => {
  await page.unroute("**/api/auth/get-session");
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "null" }));
  await mockApis(page);
  await seedV4Session(page, planData, { boxSource: "maa" });
  await page.goto("/");

  await expect(page.locator("[data-calculator-controls]")).toBeVisible({ timeout: 15_000 });
  const protectedRun = page.getByRole("button", { name: "生成排班" });
  await expect(protectedRun).toBeEnabled();
  await protectedRun.click();
  await expect(page.getByRole("dialog", { name: "登录网站账号" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "练卡建议" }).click();
  await expect(page.locator('[data-primary-page="training"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-training-page]")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "登录后查看练卡建议" })).toBeVisible();
  await expect(page.getByText("当前数据来自自主上传或第三方同步。请前往账号管理登录；匿名状态仍可改用全角色样例生成建议。", { exact: true })).toBeVisible();
  await expect(page.locator("[data-training-advice-list]")).toHaveCount(0);
});

test("server auth boundaries reject anonymous planning and every development Skland route", async ({ request }) => {
  test.setTimeout(60_000);
  const maaResponse = await request.post("/api/plan", {
    data: { layout: layout243, operbox: [], sourceName: "anonymous.json", boxSource: "maa", rotation: "abc_12_6_6" },
  });
  expect(maaResponse.status()).toBe(401);
  expect((await maaResponse.json()).error.code).toBe("AIC-AUTH-2008");

  const forgedSample = await request.post("/api/plan", {
    data: { layout: layout243, operbox: [], sourceName: "forged.json", boxSource: "sample", rotation: "abc_12_6_6" },
  });
  expect(forgedSample.status()).toBe(400);
  expect((await forgedSample.json()).error.code).toBe("AIC-REQ-1001");

  for (const [method, path] of [
    ["GET", "/api/skland/session"],
    ["GET", "/api/skland/session?mode=summary"],
    ["DELETE", "/api/skland/session"],
    ["GET", "/api/skland/accounts"],
    ["GET", "/api/skland/accounts?mode=summary"],
    ["DELETE", "/api/skland/accounts"],
    ["DELETE", "/api/skland/accounts/account_test"],
    ["POST", "/api/skland/auth/qr"],
    ["POST", "/api/skland/auth/qr/status"],
    ["POST", "/api/skland/auth/credential"],
    ["POST", "/api/skland/sync"],
    ["POST", "/api/skland/role"],
    ["GET", "/api/skland/status"],
    ["POST", "/api/skland/status/refresh"],
    ["DELETE", "/api/skland/data"],
    ["DELETE", "/api/skland/account-data"],
  ] as const) {
    const response = await request.fetch(path, { method });
    expect(response.status(), `${method} ${path}`).toBe(401);
    expect((await response.json()).error.code, `${method} ${path}`).toBe("AIC-AUTH-2008");
  }

  const nativeAdmin = await request.post("/api/auth/admin/list-users", { data: {} });
  expect(nativeAdmin.status()).toBe(404);
  expect((await request.get("/admin")).status()).toBe(404);
  expect((await request.get("/admin/issues")).status()).toBe(404);
  expect((await request.get("/admin/users")).status()).toBe(404);
});

test("serves versioned WebP portraits with immutable caching only when versioned", async ({ request }) => {
  expect(amiyaPortrait).toMatch(/^\/images\/operator-portraits\/002_amiya\.webp\?v=\d+-[0-9a-f]{12}$/);
  const versioned = await request.get(amiyaPortrait);
  expect(versioned.ok()).toBe(true);
  expect(versioned.headers()["content-type"]).toContain("image/webp");
  expect(versioned.headers()["cache-control"]).toContain("max-age=31536000");
  expect(versioned.headers()["cache-control"]).toContain("immutable");

  const unversioned = await request.get(amiyaPortrait.split("?")[0]);
  expect(unversioned.ok()).toBe(true);
  expect(unversioned.headers()["cache-control"]).toBe("public, max-age=0");
});

test("prefetches only the adjacent shift portrait during browser idle time", async ({ page }) => {
  await mockApis(page);
  await seedV4Session(page, adjacentPortraitPlanData);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { effectiveType: "4g", saveData: false },
    });
    window.requestIdleCallback = (callback) => window.setTimeout(() => callback({
      didTimeout: false,
      timeRemaining: () => 50,
    }), 0);
    window.cancelIdleCallback = (handle) => window.clearTimeout(handle);
  });

  const requestedPortraits: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "image" && request.url().includes("/images/operator-portraits/")) {
      requestedPortraits.push(request.url());
    }
  });
  await page.goto("/");
  await expect(page.locator("[data-plan-board]")).toHaveAttribute("data-plan-revision", diagnosticId);

  await expect.poll(() => requestedPortraits.some((url) => url.includes("/003_kalts.webp?"))).toBe(true);
  expect(requestedPortraits.some((url) => url.includes("/4037_demetr.webp?"))).toBe(false);

  const shiftTabs = page.locator('[data-shift-tabs] [role="tab"]');
  await shiftTabs.nth(1).click();
  await expect(shiftTabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => requestedPortraits.some((url) => url.includes("/4037_demetr.webp?"))).toBe(true);
});

test("defers a portrait far below the mobile viewport until it approaches view", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Chromium owns the deterministic native lazy-loading threshold assertion.");
  await mockApis(page);
  await seedV4Session(page, lazyPortraitPlanData);
  await page.addInitScript(() => {
    const styleId = "deferred-portrait-test-style";
    const installDeferredPortraitStyle = () => {
      const target = document.head ?? document.documentElement;
      if (!target) return false;
      let style = document.getElementById(styleId) as HTMLStyleElement | null;
      if (!style) {
        style = document.createElement("style");
        style.id = styleId;
        style.textContent = '[data-room-group="processing"] { margin-top: 3000px !important; }';
      }
      if (!style.isConnected) target.append(style);
      return true;
    };
    installDeferredPortraitStyle();
    const observer = new MutationObserver(installDeferredPortraitStyle);
    observer.observe(document, { childList: true, subtree: true });
    window.addEventListener("DOMContentLoaded", installDeferredPortraitStyle, { once: true });
    window.addEventListener("load", () => {
      installDeferredPortraitStyle();
      observer.disconnect();
    }, { once: true });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const requestedPortraits: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "image" && request.url().includes("/images/operator-portraits/")) {
      requestedPortraits.push(request.url());
    }
  });
  await page.goto("/");

  const deferredPortrait = page.locator('[data-schedule-view="list"] img[alt="嘉辛塔"]');
  await expect(deferredPortrait).toHaveAttribute("loading", "lazy");
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  await expect.poll(() => deferredPortrait.evaluate((element) => {
    window.scrollTo(0, 0);
    return element.getBoundingClientRect().top;
  })).toBeGreaterThan(viewportHeight * 2);
  await page.waitForTimeout(300);
  expect(requestedPortraits).toHaveLength(3);
  expect(requestedPortraits.some((url) => url.includes("/4237_jcinta.webp?"))).toBe(false);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => requestedPortraits.some((url) => url.includes("/4237_jcinta.webp?"))).toBe(true);
});

test("restores a v4 schedule without hydration errors and keeps only safe data", async ({ page }) => {
  await mockApis(page);
  await seedV4Session(page);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");
  await expect(page.locator("[data-plan-board]")).toHaveAttribute("data-plan-revision", diagnosticId);
  await expect(page.locator('[data-slot="live-activity"]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator("[data-plan-board]")).toHaveAttribute("data-plan-revision", diagnosticId);
  await expect(page.locator('[data-slot="live-activity"]')).toHaveCount(0);
  expect(consoleErrors.filter((message) => /hydration|did not match/i.test(message))).toEqual([]);

  const persisted = await page.evaluate(() => JSON.parse(
    window.localStorage.getItem("arknights-infra-calc-session-v5") ?? "{}"
  ));
  expect(persisted.savedAt).toBeTruthy();
  expect(persisted.expiresAt).toBeTruthy();
  expect(persisted.result.debug).toBeUndefined();
  expect(JSON.stringify(persisted)).not.toContain("cliPath");
  expect(JSON.stringify(persisted)).not.toContain("stdout");
});

test("planning preloads every versioned product icon and renders direct immutable WebP requests", async ({ page }) => {
  await mockApis(page);
  await seedV4Session(page, null);
  await page.unroute("**/api/plan");

  let releasePlan!: () => void;
  const planBarrier = new Promise<void>((resolve) => {
    releasePlan = resolve;
  });
  let planReleased = false;
  const productsRequestedBeforePlanResponse = new Set<string>();
  page.on("request", (request) => {
    if (!planReleased && request.url().includes("/images/products/")) {
      productsRequestedBeforePlanResponse.add(new URL(request.url()).pathname);
    }
  });
  await page.route("**/api/plan", async (route) => {
    await planBarrier;
    planReleased = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: planData, requestId }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "生成排班" }).click();
  await expect.poll(() => productsRequestedBeforePlanResponse.size).toBe(6);
  expect(productsRequestedBeforePlanResponse.has("/images/products/drone.webp")).toBe(true);
  releasePlan();

  const productImages = page.locator('[data-daily-production-summary] img[src^="/images/products/"]');
  await expect(productImages).toHaveCount(6);
  const imageAttributes = await productImages.evaluateAll((images) => images.map((image) => ({
    src: image.getAttribute("src"),
    width: image.getAttribute("width"),
    height: image.getAttribute("height"),
    loading: image.getAttribute("loading"),
  })));
  for (const image of imageAttributes) {
    expect(image.src).toMatch(/^\/images\/products\/[a-z_]+\.webp\?v=\d+-[0-9a-f]{12}$/);
    expect(image.src).not.toContain("/_next/image");
    expect(["16", "32"]).toContain(image.width);
    expect(image.height).toBe(image.width);
    expect(image.loading).toBe("eager");
  }

  const versionedPath = imageAttributes[0].src;
  if (!versionedPath) throw new Error("Missing versioned product image path.");
  const versionedResponse = await page.request.get(versionedPath);
  expect(versionedResponse.headers()["cache-control"]).toContain("max-age=31536000");
  expect(versionedResponse.headers()["cache-control"]).toContain("immutable");

  const unversionedResponse = await page.request.get(versionedPath.split("?")[0]);
  expect(unversionedResponse.headers()["cache-control"] ?? "").not.toContain("immutable");
});

test("a failed complete Skland restore keeps the independently restored identity visible", async ({ page }) => {
  await mockApis(page, {
    sklandConfigured: true,
    sklandSnapshot: authenticatedSklandSnapshot,
    sklandSessionFailure: true,
  });
  await page.unroute("**/api/skland/status/refresh");
  let releaseStatus!: () => void;
  const statusBarrier = new Promise<void>((resolve) => {
    releaseStatus = resolve;
  });
  await page.route("**/api/skland/status/refresh", async (route) => {
    await statusBarrier;
    await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
  });
  await seedPreferences(page);
  const fullRestoreFailed = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/skland/accounts"
      && !url.searchParams.has("mode")
      && response.status() === 500;
  });
  await page.goto("/");

  const accountControl = page.locator("[data-skland-account-control]");
  await expect(accountControl).toHaveAttribute("aria-label", "测试博士，进入森空岛状态中心");
  const accountAvatar = accountControl.locator("[data-skland-account-avatar]");
  await expect(accountAvatar).toBeVisible();
  await expect(accountAvatar.locator("img")).toHaveCount(0);
  const emptyRemoteAvatar = accountAvatar.locator('[data-remote-avatar-state="fallback"]');
  await expect(emptyRemoteAvatar).toBeVisible();
  await expect(emptyRemoteAvatar.locator('[data-slot="skeleton"]')).toHaveCount(0);
  expect(await emptyRemoteAvatar.evaluate((element) => element.childElementCount)).toBe(0);
  await expect(accountControl).not.toContainText("测");
  await fullRestoreFailed;
  await accountControl.click();
  await expect(page.getByText(/森空岛会话恢复失败，请稍后刷新。/)).toBeVisible();
  await page.getByRole("button", { name: "基建计算器", exact: true }).click();
  await expect(accountControl).toHaveAttribute("aria-label", "测试博士，进入森空岛状态中心");
  releaseStatus();
});

test("a failed Skland avatar request leaves the logged-in calculator control blank", async ({ page }) => {
  const avatarUrl = "https://example.com/unavailable-skland-avatar.png";
  await page.route(avatarUrl, (route) => route.abort("failed"));
  await mockApis(page, {
    sklandConfigured: true,
    sklandSnapshot: {
      ...authenticatedSklandSnapshot,
      player: { ...authenticatedSklandSnapshot.player, avatarUrl },
    },
  });
  await seedPreferences(page);
  await page.goto("/");

  const accountControl = page.locator("[data-skland-account-control]");
  const accountAvatar = accountControl.locator("[data-skland-account-avatar]");
  await expect(accountControl).toBeVisible();
  await expect(accountControl).toHaveAttribute("aria-label", "测试博士，进入森空岛状态中心");
  await expect(accountAvatar.locator("img")).toHaveCount(0);
  const failedRemoteAvatar = accountAvatar.locator('[data-remote-avatar-state="fallback"]');
  await expect(failedRemoteAvatar).toBeVisible();
  await expect(failedRemoteAvatar.locator('[data-slot="skeleton"]')).toHaveCount(0);
  expect(await failedRemoteAvatar.evaluate((element) => element.childElementCount)).toBe(0);
});

test("two-shift output drives product estimates, room formulas, and profile details", async ({ page, browserName }) => {
  await mockApis(page);
  await seedV4Session(page, twoShiftPlanData, { rotationProfile: "main_backup_12_12" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const shiftTabs = page.getByRole("tab", { name: /第 \d 班 · 12h/ });
  await expect(shiftTabs).toHaveCount(2);
  await expect(page.locator("[data-shift-tabs]")).toHaveCSS("overflow-y", "hidden");
  await expect(page.getByRole("tab", { name: /第 3 班/ })).toHaveCount(0);
  await expect(shiftTabs.first()).toHaveAttribute("aria-label", /主力 上班 · 替补 休息/);

  const dailyProducts = page.locator("[data-daily-production-summary]");
  await expect(dailyProducts).toHaveAttribute("data-production-source", "solver");
  await expect(page.getByText("PLAN ONLINE", { exact: true })).toHaveCount(0);
  await expect(dailyProducts.locator("[data-daily-product-group]")).toHaveCount(3);
  await expect(dailyProducts.locator("[data-daily-product-group]").nth(0)).toHaveAttribute("data-daily-product-group", "experience");
  await expect(dailyProducts.locator("[data-daily-product-group]").nth(1)).toHaveAttribute("data-daily-product-group", "lmd");
  await expect(dailyProducts.locator("[data-daily-product-group]").nth(2)).toHaveAttribute("data-daily-product-group", "orundum");
  await expect(dailyProducts.locator("[data-daily-product]")).toHaveCount(5);
  await expect(dailyProducts.locator('[data-daily-product-group="lmd"] [data-daily-product]').nth(0)).toHaveAttribute("data-daily-product", "lmd-orders");
  await expect(dailyProducts.locator('[data-daily-product-group="lmd"] [data-daily-product]').nth(1)).toHaveAttribute("data-daily-product", "gold");
  await expect(dailyProducts.locator('[data-daily-product-group="orundum"] [data-daily-product]').nth(0)).toHaveAttribute("data-daily-product", "orundum");
  await expect(dailyProducts.locator('[data-daily-product-group="orundum"] [data-daily-product]').nth(1)).toHaveAttribute("data-daily-product", "shards");
  await expect(dailyProducts.locator('[data-daily-product="lmd-orders"]')).toContainText(/龙门币.*34,254.*龙门币/s);
  // 53,000 / 500 manufactured gold plus 10 gold from daily acquisition.
  await expect(dailyProducts.locator('[data-daily-product="gold"]')).toContainText(/赤金.*116.*枚/s);
  await expect(dailyProducts.locator('[data-daily-product="experience"]')).toContainText(/经验.*22,400.*经验/s);
  await expect(dailyProducts.locator('[data-daily-product="shards"]')).toContainText(/源石碎片.*48.*枚/s);
  await expect(dailyProducts.locator('[data-daily-product="orundum"]')).toContainText(/合成玉.*360.*合成玉/s);
  await expect(dailyProducts.getByText("龙门币订单", { exact: true })).toHaveCount(0);
  await waitForOwnAnimations(dailyProducts.locator("[data-plan-metric]").last());

  const primaryProductOffsets = await Promise.all(
    ["experience", "lmd", "orundum"].map((group) => dailyProducts.locator(`[data-daily-product-group="${group}"]`).evaluate((card) => {
      const product = card.querySelector<HTMLElement>("[data-daily-product]");
      if (!product) throw new Error(`Missing primary product in ${card.getAttribute("data-daily-product-group") ?? "unknown"} card`);
      const cardBounds = card.getBoundingClientRect();
      const productBounds = product.getBoundingClientRect();
      return { inlineStart: productBounds.left - cardBounds.left, blockStart: productBounds.top - cardBounds.top };
    })),
  );
  expect(primaryProductOffsets[0].inlineStart).toBeCloseTo(primaryProductOffsets[1].inlineStart, 0);
  expect(primaryProductOffsets[0].inlineStart).toBeCloseTo(primaryProductOffsets[2].inlineStart, 0);
  expect(primaryProductOffsets[0].blockStart).toBeCloseTo(primaryProductOffsets[1].blockStart, 0);
  expect(primaryProductOffsets[0].blockStart).toBeCloseTo(primaryProductOffsets[2].blockStart, 0);

  const manufactureFormula = page.locator('[data-room-title="制造站 1"]');
  const tradeFormula = page.locator('[data-room-title="贸易站 1"]');
  await expect(manufactureFormula).toContainText(/236%\s*=\s*100%\s*\+\s*130%\s*纯技能\s*\+\s*6%\s*跨设施/);
  await expect(tradeFormula).toContainText(/333\.7%\s*=\s*100%\s*\+\s*135%\s*综合加成\s*×\s*1\.42\s*订单机制/);
  await expect(manufactureFormula.getByText("基础", { exact: true })).toHaveCount(0);
  await expect(tradeFormula.getByText("基础", { exact: true })).toHaveCount(0);

  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 900 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    const fit = await dailyProducts.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
    expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth);
    for (const product of await dailyProducts.locator("[data-daily-product-group]").all()) {
      const cardFit = await product.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
      expect(cardFit.scrollWidth).toBeLessThanOrEqual(cardFit.clientWidth + 1);
    }
  }

  await page.getByRole("tab", { name: /第 2 班 · 12h/ }).click();
  await expect(shiftTabs.nth(1)).toHaveAttribute("aria-label", /替补 上班 · 主力 休息/);

  await expect(page.getByRole("button", { name: "查看详情", exact: true })).toHaveCount(0);
  const detailsTrigger = page.locator("[data-plan-primary-details-trigger]");
  await detailsTrigger.click();
  const detailsSheet = page.locator('[data-slot="drawer-content"]');
  await expect(detailsSheet).toBeVisible();
  await expect(detailsSheet.getByRole("heading", { name: "预计日产物" })).toBeVisible();
  await expect(detailsSheet.locator("[data-production-details]")).toHaveAttribute("data-production-source", "solver");
  await expect(detailsSheet.getByText("DAILY OUTPUT", { exact: true })).toHaveCount(0);
  await expect(detailsSheet.getByText("完整精度汇总 · 显示取整", { exact: true })).toHaveCount(0);
  await expect(detailsSheet.locator("[data-production-group]").nth(0)).toHaveAttribute("data-production-group", "experience");
  await expect(detailsSheet.locator("[data-production-group]").nth(1)).toHaveAttribute("data-production-group", "lmd");
  await expect(detailsSheet.locator("[data-production-group]").nth(2)).toHaveAttribute("data-production-group", "orundum");
  await expect(detailsSheet.locator('[data-production-group="lmd"] [data-production-detail]').nth(0)).toHaveAttribute("data-production-detail", "lmd-orders");
  await expect(detailsSheet.locator('[data-production-group="lmd"] [data-production-detail]').nth(1)).toHaveAttribute("data-production-detail", "gold");
  await expect(detailsSheet.getByText("龙门币订单", { exact: true })).toHaveCount(0);
  await expect(detailsSheet.locator('[data-production-detail="gold"]')).toContainText("订单原料");
  await expect(detailsSheet.locator('[data-production-group="orundum"] [data-production-detail]').nth(0)).toHaveAttribute("data-production-detail", "orundum");
  await expect(detailsSheet.locator('[data-production-group="orundum"] [data-production-detail]').nth(1)).toHaveAttribute("data-production-detail", "shards");
  await expect(detailsSheet.locator('[data-production-detail="shards"]')).toContainText("制造环节");
  await expect(detailsSheet.locator('[data-production-detail="experience"]')).toContainText(/22,400.*估算自然制造.*估算无人机0 经验/s);
  await expect(detailsSheet.locator('[data-production-detail="lmd-orders"]')).toContainText(/34,254.*估算自然订单.*估算无人机订单0 龙门币/s);
  await expect(detailsSheet.locator('[data-production-detail="gold"]')).toContainText(/116.*估算自然制造106 枚.*估算无人机制造0 枚.*日常获取10 枚/s);
  await expect(detailsSheet.locator('[data-production-detail="orundum"]')).toContainText(/360.*估算碎片阶段可供480 合成玉.*估算订单阶段可交付360 合成玉/s);
  await expect(detailsSheet.locator('[data-production-detail="shards"]')).toContainText(/48.*估算自然制造.*估算无人机/s);
  await expect(detailsSheet).not.toContainText("拆分为前端估算，总量以求解器为准");
  await expect(detailsSheet.getByText("限制环节：合成玉订单", { exact: true })).toBeVisible();
  await expect(detailsSheet.locator("[data-production-method]")).toHaveCount(0);
  await expect(detailsSheet.getByRole("heading", { name: "产线提升空间" })).toHaveCount(0);
  await expect(detailsSheet.locator("[data-efficiency-insights]")).toHaveCount(0);
  await expect(detailsSheet.getByRole("heading", { name: "设施组合提升空间" })).toHaveCount(0);
  await expect(detailsSheet.getByText("下一步建议", { exact: true })).toHaveCount(0);
  await expect(detailsSheet.getByText("原效率与基准", { exact: true })).toHaveCount(0);
  await expect(detailsSheet.getByText("领域指标", { exact: true })).toHaveCount(0);
  await expect(detailsSheet.getByText(/机制等效|当前 1\.42|参考 1\.31/)).toHaveCount(0);
  await expect(detailsSheet.locator('[data-recommendation-card="compact"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-slot="drawer-root"]')).toHaveCount(0);
  await expect(detailsTrigger).toBeFocused();

  await detailsTrigger.click();
  await expect(detailsSheet).toBeVisible();
  await expect.poll(async () => (await detailsSheet.boundingBox())?.x).toBeCloseTo(880, 0);
  if (browserName === "webkit") {
    await detailsSheet.getByRole("button", { name: "关闭详情" }).click();
  } else {
    const drawerHandle = page.locator('[data-slot="drawer-handle"]');
    const handleBox = await drawerHandle.boundingBox();
    expect(handleBox).not.toBeNull();
    await page.mouse.move(handleBox!.x + 40, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + handleBox!.width - 10, handleBox!.y + handleBox!.height / 2, { steps: 12 });
    await page.mouse.up();
  }
  await expect(page.locator('[data-slot="drawer-root"]')).toHaveCount(0);
  await expect(detailsTrigger).toBeFocused();

  await page.getByRole("button", { name: "练卡建议" }).click();
  await expect(page.getByText("练度提升", { exact: true })).toBeVisible();
  await expect(page.getByText("目前精一 · 目标精二", { exact: true })).toBeVisible();
});

test("old sessions normalize duplicate operator names before training advice renders", async ({ page }) => {
  await mockApis(page);
  await seedV4Session(page, planData, {
    operbox: [
      { id: "char_amiya_guard", name: "阿米娅", elite: 1, level: 70, own: true, potential: 6, rarity: 5 },
      { id: "char_002_amiya", name: "阿米娅", elite: 2, level: 80, own: true, potential: 6, rarity: 5 },
    ],
  });
  await page.goto("/");

  await page.getByRole("button", { name: "练卡建议" }).click();
  await expect(page.getByText(/干员名称重复：阿米娅/)).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => JSON.parse(
    window.localStorage.getItem("arknights-infra-calc-session-v5") ?? "{}"
  ).operbox)).toEqual([
    { id: "char_002_amiya", name: "阿米娅", elite: 2, level: 80, own: true, potential: 6, rarity: 5 },
  ]);
});

test("four-shift output persists the fourth tab and migrates an old v4 profile", async ({ page }) => {
  const legacyResult = structuredClone(fourShiftPlanData);
  delete (legacyResult.profile as { rotation_profile?: string }).rotation_profile;
  delete (legacyResult.rotation as { profile?: string }).profile;

  await mockApis(page);
  await seedV4Session(page, legacyResult, {
    activeShift: 0,
    rotationProfile: "fiammetta_8_8_4_4",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const fourthShift = page.getByRole("tab", { name: /第 4 班 · 4h/ });
  await expect(page.getByRole("tab", { name: /第 \d 班 · (?:8|4)h/ })).toHaveCount(4);
  await fourthShift.click();
  await expect(fourthShift).toHaveAttribute("aria-selected", "true");
  await expect.poll(async () => page.evaluate(() => JSON.parse(
    window.localStorage.getItem("arknights-infra-calc-session-v5") ?? "{}"
  ).activeShift)).toBe(3);

  await page.reload();
  await expect(page.getByRole("tab", { name: /第 4 班 · 4h/ })).toHaveAttribute(
    "aria-selected",
    "true",
    { timeout: 15_000 },
  );
  const persisted = await page.evaluate(() => JSON.parse(
    window.localStorage.getItem("arknights-infra-calc-session-v5") ?? "{}"
  ));
  expect(persisted.activeShift).toBe(3);
  expect(persisted.result.rotation.profile).toBe("fiammetta_8_8_4_4");
});

test("ignores root attributes injected by browser extensions during hydration", async ({ page }) => {
  await mockApis(page);
  await seedPreferences(page);
  await page.route("**/", async (route) => {
    const response = await fetch(route.request().url(), { headers: route.request().headers() });
    const body = (await response.text()).replace(
      /<html([^>]*)>/,
      '<html$1 data-fabric-scheme="dark">'
    );
    await route.fulfill({
      status: response.status,
      contentType: response.headers.get("content-type") ?? "text/html; charset=utf-8",
      body,
    });
  });
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-fabric-scheme", "dark");
  expect(consoleErrors.filter((message) => /hydration|did not match/i.test(message))).toEqual([]);
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1440, height: 900 },
]) {
  test(`website account registration is reachable and explains consent at ${viewport.width}px`, async ({ page }) => {
    let signUpRequests = 0;
    await page.unroute("**/api/auth/get-session");
    await page.route("**/api/auth/get-session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "null" }));
    await page.route("**/api/auth/sign-up/email", async (route) => {
      signUpRequests += 1;
      const body = route.request().postDataJSON() as { email?: string; password?: string };
      expect(body.email).toBe(`account-${viewport.width}@example.test`);
      expect(body.password).toBe("Axy123!?");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ token: null, user: { id: "new-user", name: "测试用户", email: body.email, emailVerified: false } }),
      });
    });
    await page.route("**/api/auth/email-otp/verify-email", async (route) => {
      const body = route.request().postDataJSON() as { email?: string; otp?: string };
      expect(body).toEqual({ email: `account-${viewport.width}@example.test`, otp: "123456" });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: true, token: null, user: { id: "new-user", name: "测试用户", email: body.email, emailVerified: true } }),
      });
    });
    await mockApis(page);
    await seedPreferences(page);
    await page.setViewportSize(viewport);
    await page.goto("/");

    await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
    if (viewport.width < 768) await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    const accountNavigation = page.getByRole("button", { name: "账号管理", exact: true });
    await expect(accountNavigation.locator(".lucide-user-round")).toBeVisible();
    await accountNavigation.click();
    await expect(page.locator("[data-account-management]")).toHaveCount(0);
    const accountDialog = page.getByRole("dialog", { name: "登录网站账号" });
    await expect(accountDialog).toBeVisible();
    const accountPanel = accountDialog.locator("[data-website-account-panel]");
    await expect(accountPanel.locator("[data-wizard-steps]")).toHaveCount(0);
    await accountPanel.getByRole("button", { name: "忘记密码" }).click();
    await expect(accountPanel.getByRole("button", { name: /第 1 步，共 2 步：确认邮箱/ })).toHaveAttribute("aria-current", "step");
    await accountPanel.getByRole("button", { name: "返回登录" }).click();
    await expect(accountPanel.locator("[data-wizard-steps]")).toHaveCount(0);
    await accountPanel.getByRole("button", { name: "创建账号" }).click();
    await expect(accountPanel.locator("[data-wizard-steps]")).toHaveCount(0);
    await expect(accountPanel.getByRole("heading", { name: "创建网站账号" })).toBeVisible();
    await expect(accountPanel.getByRole("link", { name: "服务条款", exact: true })).toHaveAttribute("href", "/terms");
    await expect(accountPanel.getByRole("link", { name: "隐私政策", exact: true })).toHaveAttribute("href", "/privacy");
    await expect(accountPanel.getByText("2–20 个字符，可使用中文、英文字母、数字、空格、下划线和短横线。", { exact: true })).toBeVisible();
    await accountPanel.getByRole("textbox", { name: "邮箱", exact: true }).fill(`account-${viewport.width}@example.test`);
    await page.getByLabel("密码", { exact: true }).fill("weakpassword1");
    await page.getByLabel("确认密码", { exact: true }).fill("weakpassword1");
    await expect(page.getByLabel("密码", { exact: true })).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "显示密码" }).click();
    await expect(page.getByLabel("密码", { exact: true })).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "隐藏密码" }).click();
    await expect(page.getByLabel("密码", { exact: true })).toHaveAttribute("type", "password");
    await page.getByLabel("昵称").fill("博士😀");
    await page.getByRole("button", { name: "创建账号并发送验证码" }).click();
    await expect(accountPanel.getByText(/昵称只能使用中文、英文字母、数字/)).toBeVisible();
    await page.getByLabel("昵称").fill("测试用户");
    await expect(accountPanel.getByRole("meter", { name: "密码强度" })).toHaveAttribute("aria-valuetext", "良好");
    await page.getByRole("button", { name: "创建账号并发送验证码" }).click();
    await expect(accountPanel.getByText(/密码强度不足：至少 8 位/)).toBeVisible();
    expect(signUpRequests).toBe(0);
    await page.getByLabel("密码", { exact: true }).fill("Axy123!?");
    await page.getByLabel("确认密码", { exact: true }).fill("different-password-1");
    await expect(accountPanel.getByText(/密码强度不足：至少 8 位/)).toHaveCount(0);
    await expect(accountPanel.getByRole("meter", { name: "密码强度" })).toHaveAttribute("aria-valuetext", "强");
    await page.getByRole("button", { name: "创建账号并发送验证码" }).click();
    await expect(accountPanel.getByText("两次输入的密码不一致。", { exact: true })).toBeVisible();
    expect(signUpRequests).toBe(0);
    await page.getByLabel("确认密码", { exact: true }).fill("Axy123!?");
    await expect(accountPanel.getByText("两次输入的密码不一致。", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "创建账号并发送验证码" }).click();
    expect(signUpRequests).toBe(1);
    await expect(accountPanel.locator("[data-wizard-steps]")).toHaveCount(0);
    for (const [index, digit] of [..."123456"].entries()) {
      await accountPanel.getByRole("textbox", { name: `邮箱验证码第 ${index + 1} 位，共 6 位` }).fill(digit);
    }
    await accountPanel.getByRole("button", { name: "验证邮箱", exact: true }).click();
    await expect(accountPanel.getByText("邮箱验证完成", { exact: true })).toBeVisible();
    await expect(accountPanel.getByText("邮箱验证完成，现在可以登录网站账号。")).toBeVisible();
  });
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1440, height: 900 },
]) {
  test(`cloud consent, sync, restore, plan controls, and deletion work at ${viewport.width}px`, async ({ page }) => {
    let consentCurrent = false;
    let workspace: Record<string, unknown> | null = null;
    let workspaceWrites = 0;
    let restoreRequests = 0;
    let revokeRequests = 0;
    let deleteRequests = 0;
    let failNextDelete = viewport.width === 390;
    let planDeleted = false;
    let planPinned = false;
    const revisionId = "33333333-3333-4333-8333-333333333333";
    const timestamp = "2026-08-21T08:00:00.000Z";
    const savedPlanContext = {
      presetLabel: "333",
      layout: { ...layout243, template: "333" },
      rotationProfile: "abc_12_6_6",
      fiammettaEnabled: false,
    };
    const fulfill = (route: Route, data: unknown) => route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "X-Request-Id": requestId },
      body: JSON.stringify({ success: true, data, requestId }),
    });

    await page.route("**/api/account/data-consent", async (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        expect(body).toMatchObject({
          termsAccepted: true,
          privacyAccepted: true,
          termsVersion: TERMS_VERSION,
          privacyVersion: PRIVACY_VERSION,
        });
        consentCurrent = true;
      } else if (route.request().method() === "DELETE") {
        consentCurrent = false;
        revokeRequests += 1;
        return fulfill(route, { revoked: true, deleted: true });
      }
      return fulfill(route, {
        current: consentCurrent,
        termsVersion: TERMS_VERSION,
        privacyVersion: PRIVACY_VERSION,
        acceptedAt: consentCurrent ? timestamp : null,
        revokedAt: null,
        cloudSyncEnabled: true,
      });
    });
    await page.route("**/api/workspace", async (route) => {
      if (route.request().method() === "GET") {
        return fulfill(route, workspace ?? {
          exists: false,
          revision: 0,
          state: null,
          operbox: null,
          result: null,
          updatedAt: null,
          syncedAt: null,
          revisions: [],
        });
      }
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        if (body.restoreRevisionId) {
          expect(body.restoreRevisionId).toBe(revisionId);
          expect(workspace).not.toBeNull();
          restoreRequests += 1;
          workspace = { ...workspace!, revision: 3, updatedAt: timestamp, syncedAt: timestamp };
          return fulfill(route, workspace);
        }
        workspaceWrites += 1;
        expect((body.state as { boxSource?: string }).boxSource).toBe("maa");
        expect(Array.isArray(body.operbox)).toBe(true);
        expect(JSON.stringify(body)).not.toContain("debugBundle");
        workspace = {
          exists: true,
          revision: 2,
          state: body.state,
          operbox: body.operbox,
          result: body.result,
          updatedAt: timestamp,
          syncedAt: timestamp,
          revisions: [{ id: revisionId, revision: 1, createdAt: timestamp, expiresAt: "2026-09-20T08:00:00.000Z" }],
        };
        return fulfill(route, workspace);
      }
      return fulfill(route, { deleted: true });
    });
    await page.route("**/api/account/saved-plans", (route) => fulfill(route, {
      plans: [
        ...(planDeleted ? [] : [{
          id: "saved-plan-1",
          diagnosticId,
          title: "333 · 本地 MAA",
          calculationContext: savedPlanContext,
          boxMatchesWorkspace: true,
          pinned: planPinned,
          createdAt: timestamp,
          updatedAt: timestamp,
          expiresAt: planPinned ? null : "2026-09-20T08:00:00.000Z",
          result: planData,
        }]),
        {
          id: "saved-plan-legacy",
          diagnosticId: null,
          title: "旧版排班",
          calculationContext: null,
          boxMatchesWorkspace: true,
          pinned: false,
          createdAt: timestamp,
          updatedAt: timestamp,
          expiresAt: "2026-09-20T08:00:00.000Z",
          result: planData,
        },
        {
          id: "saved-plan-box-mismatch",
          diagnosticId: "saved-plan-box-mismatch-diagnostic",
          title: "Box 已变化的排班",
          calculationContext: savedPlanContext,
          boxMatchesWorkspace: false,
          pinned: false,
          createdAt: timestamp,
          updatedAt: timestamp,
          expiresAt: "2026-09-20T08:00:00.000Z",
          result: planData,
        },
      ],
    }));
    await page.route("**/api/account/saved-plans/*", async (route) => {
      if (route.request().method() === "PATCH") {
        planPinned = Boolean((route.request().postDataJSON() as { pinned?: boolean }).pinned);
        return fulfill(route, {
          id: "saved-plan-1",
          diagnosticId,
          title: "333 · 本地 MAA",
          calculationContext: savedPlanContext,
          boxMatchesWorkspace: true,
          pinned: planPinned,
          createdAt: timestamp,
          updatedAt: timestamp,
          expiresAt: null,
          result: planData,
        });
      }
      deleteRequests += 1;
      if (failNextDelete) {
        failNextDelete = false;
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          headers: { "X-Request-Id": requestId },
          body: JSON.stringify({
            success: false,
            error: {
              code: "AIC-SYS-5000",
              message: "排班删除失败，请稍后重试。",
              requestId,
              retryable: true,
            },
            requestId,
          }),
        });
      }
      planDeleted = true;
      return fulfill(route, { deleted: true });
    });

    await mockApis(page);
    await seedV4Session(page, planData, { boxSource: "maa" });
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();

    const dialog = page.getByRole("dialog", { name: "启用账号云端工作区" });
    await expect(dialog).toBeVisible();
    await dialog.evaluate(async (element) => {
      // Wait for the dialog entrance, not the descendant scrollbar's
      // scroll-driven timeline, whose finished promise intentionally stays pending.
      await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
    });
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox?.width ?? 0).toBeLessThanOrEqual(viewport.width - 16);
    expect(dialogBox?.height ?? 0).toBeLessThanOrEqual(viewport.height - 16);
    const dialogBody = dialog.locator('[data-slot="dialog-body"]');
    const dialogBodyBox = await dialogBody.boundingBox();
    expect(dialogBodyBox).not.toBeNull();
    const bodyPadding = await dialogBody.evaluate((element) => {
      const style = getComputedStyle(element);
      return { left: Number.parseFloat(style.paddingLeft), right: Number.parseFloat(style.paddingRight) };
    });
    expect(bodyPadding.left).toBeGreaterThanOrEqual(20);
    expect(bodyPadding.right).toBeGreaterThanOrEqual(20);
    const decline = dialog.getByRole("button", { name: "继续纯本地模式" });
    const accept = dialog.getByRole("button", { name: "同意并开始同步" });
    const declineBox = await decline.boundingBox();
    const acceptBox = await accept.boundingBox();
    expect(declineBox).not.toBeNull();
    expect(acceptBox).not.toBeNull();
    const [declineHeight, acceptHeight] = await Promise.all([
      decline.evaluate((element) => Number.parseFloat(getComputedStyle(element).height)),
      accept.evaluate((element) => Number.parseFloat(getComputedStyle(element).height)),
    ]);
    expect(declineHeight).toBeGreaterThanOrEqual(44);
    expect(acceptHeight).toBeGreaterThanOrEqual(44);
    if (viewport.width < 640) {
      expect(acceptBox!.y).toBeGreaterThan(declineBox!.y);
      expect(Math.abs(acceptBox!.width - declineBox!.width)).toBeLessThanOrEqual(1);
    } else {
      expect(Math.abs(acceptBox!.y - declineBox!.y)).toBeLessThanOrEqual(1);
    }
    if (viewport.width === 390) {
      await page.setViewportSize({ width: 390, height: 480 });
      const compactDialogBox = await dialog.boundingBox();
      expect(compactDialogBox?.height ?? 0).toBeLessThanOrEqual(464);
      await expect(dialog.getByRole("heading", { name: "启用账号云端工作区" })).toBeVisible();
      await expect(decline).toBeVisible();
      await expect(accept).toBeVisible();
      expect(await dialogBody.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
      await page.setViewportSize(viewport);
    }
    await expect(accept).toBeDisabled();
    await dialog.getByRole("checkbox").nth(0).check();
    await dialog.getByRole("checkbox").nth(1).check();
    await accept.click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => workspaceWrites).toBe(1);

    await navigateToPrimaryPage(page, {
      name: "账号管理",
      href: "/account",
      root: "[data-account-management]",
    }, viewport.width < 768);
    const cloudPanel = page.locator("[data-cloud-data-panel]");
    await expect(cloudPanel).toBeVisible();
    await expect(cloudPanel).toContainText("已同步 · 最近同步");
    await expect(cloudPanel).not.toContainText("可恢复版本");
    await expect(cloudPanel).not.toContainText("修订 1");
    await expect(cloudPanel).not.toContainText("最多 10 版");
    await expect(cloudPanel).not.toContainText("最近 5 条");
    const devicesCard = page.locator("[data-infra-technical-card]").filter({ has: page.getByRole("heading", { name: "登录设备" }) });
    const cloudCard = page.locator('[data-slot="cloud-workspace-card"]');
    const devicesTitle = devicesCard.getByRole("heading", { name: "登录设备" });
    const cloudTitle = cloudCard.getByRole("heading", { name: "账号云端工作区" });
    const restorePlan = cloudCard.getByRole("button", { name: "恢复排班：333 · 本地 MAA" });
    const pinPlan = cloudCard.getByRole("button", { name: "固定排班：333 · 本地 MAA" });
    const deletePlan = cloudCard.getByRole("button", { name: "删除排班：333 · 本地 MAA" });
    const legacyRestore = cloudCard.getByRole("button", { name: "恢复排班：旧版排班" });
    const mismatchRestore = cloudCard.getByRole("button", { name: "恢复排班：Box 已变化的排班" });
    await expect(cloudCard).toBeVisible();
    await expect(cloudPanel.locator("button svg")).toHaveCount(0);
    expect(await cloudPanel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(cloudPanel.getByText("333 · 本地 MAA", { exact: true })).toBeVisible();
    await expect(cloudPanel.getByText("旧版排班", { exact: true })).toBeVisible();
    await expect(cloudPanel.getByText("缺少计算配置，无法恢复", { exact: true })).toBeVisible();
    await expect(cloudPanel.getByText("MAA Box 不一致，无法恢复", { exact: true })).toBeVisible();
    await expect(legacyRestore).toBeDisabled();
    await expect(mismatchRestore).toBeDisabled();
    const matchingStyles = await Promise.all([
      devicesTitle.evaluate((element) => getComputedStyle(element).fontSize),
      cloudTitle.evaluate((element) => getComputedStyle(element).fontSize),
      restorePlan.evaluate((element) => Number.parseFloat(getComputedStyle(element).height)),
      pinPlan.evaluate((element) => Number.parseFloat(getComputedStyle(element).height)),
      deletePlan.evaluate((element) => Number.parseFloat(getComputedStyle(element).height)),
    ]);
    expect(matchingStyles[1]).toBe(matchingStyles[0]);
    expect(matchingStyles.slice(2)).toEqual([44, 44, 44]);
    expect(restoreRequests).toBe(0);
    await pinPlan.click();
    await expect.poll(() => planPinned).toBe(true);
    await expect(cloudPanel.getByRole("button", { name: "取消固定排班：333 · 本地 MAA" })).toBeVisible();
    await cloudPanel.getByRole("button", { name: "恢复排班：333 · 本地 MAA" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("[data-plan-result-summary]")).toContainText("333 基建方案");
    await navigateToPrimaryPage(page, {
      name: "账号管理",
      href: "/account",
      root: "[data-account-management]",
    }, viewport.width < 768);
    const restoredCloudPanel = page.locator("[data-cloud-data-panel]");
    await expect(restoredCloudPanel).toBeVisible();
    await restoredCloudPanel.getByRole("button", { name: "删除排班：333 · 本地 MAA" }).click();
    expect(deleteRequests).toBe(0);
    await expect(restoredCloudPanel.getByRole("button", { name: "取消删除排班：333 · 本地 MAA" })).toBeVisible();
    const confirmDelete = restoredCloudPanel.getByRole("button", { name: "确认删除排班：333 · 本地 MAA" });
    await expect(confirmDelete).toBeVisible();
    await expect(restoredCloudPanel.locator("[data-cloud-delete-status]")).toContainText("请确认是否删除排班");

    if (viewport.width === 390) {
      await restoredCloudPanel.getByRole("button", { name: "取消删除排班：333 · 本地 MAA" }).click();
      expect(deleteRequests).toBe(0);
      await expect(restoredCloudPanel.locator("[data-cloud-delete-status]")).toContainText("已取消删除排班");

      await restoredCloudPanel.getByRole("button", { name: "删除排班：333 · 本地 MAA" }).click();
      await page.waitForTimeout(8_200);
      expect(deleteRequests).toBe(0);
      await expect(restoredCloudPanel.getByRole("button", { name: "确认删除排班：333 · 本地 MAA" })).toHaveCount(0);
      await expect(restoredCloudPanel.locator("[data-cloud-delete-status]")).toContainText("删除确认已超时");

      await restoredCloudPanel.getByRole("button", { name: "删除排班：333 · 本地 MAA" }).click();
      await restoredCloudPanel.getByRole("button", { name: "确认删除排班：333 · 本地 MAA" }).click();
      await expect.poll(() => deleteRequests).toBe(1);
      expect(planDeleted).toBe(false);
      await expect(restoredCloudPanel).toContainText("排班删除失败，请稍后重试。");

      await restoredCloudPanel.getByRole("button", { name: "删除排班：333 · 本地 MAA" }).click();
    }
    await restoredCloudPanel.getByRole("button", { name: "确认删除排班：333 · 本地 MAA" }).click();
    await expect.poll(() => planDeleted).toBe(true);
    expect(deleteRequests).toBe(viewport.width === 390 ? 2 : 1);

    const revoke = restoredCloudPanel.getByRole("button", { name: /按住撤销并删除/ });
    await revoke.scrollIntoViewIfNeeded();
    await expect(revoke).toBeVisible();
    const revokeBox = await revoke.boundingBox();
    expect(revokeBox).not.toBeNull();
    const revokeX = revokeBox!.x + revokeBox!.width / 2;
    const revokeY = revokeBox!.y + revokeBox!.height / 2;
    await page.mouse.move(revokeX, revokeY);
    await page.mouse.down();
    for (let frame = 0; frame < 20; frame += 1) {
      await page.mouse.move(revokeX + (frame % 2), revokeY);
      await page.waitForTimeout(100);
    }
    await page.mouse.up();
    await expect.poll(() => revokeRequests).toBe(1);
    await expect(restoredCloudPanel).toContainText("当前保持纯本地模式，不会上传已有数据。");
  });
}

for (const scenario of [
  { status: "shown", expectedSlot: "training-newbie-list", hasFactory: true },
  { status: "complete", expectedSlot: "training-newbie-complete", hasFactory: false },
  { status: "skipped_by_efficiency", expectedSlot: "training-newbie-skipped", hasFactory: true },
] as const) {
  test(`structured training advice obeys newbie status ${scenario.status}`, async ({ page }) => {
    const structuredAdviceResult = {
      ...planData,
      trainingAdvice: {
        schema_version: 2,
        context: {
          has_originium_shard_factory: scenario.hasFactory,
          engineering_robot_count: 12,
          trade_average_efficiency_percent: 31,
          manufacturing_average_efficiency_percent: 26,
        },
        newbie_section_status: scenario.status,
        incomplete_newbie: [{
          operator: "芬",
          product: "trade",
          action: "train",
          current: { elite: 0, level: 30 },
          target: { kind: "derive_from_skill_binding" },
        }],
        recommendations: [{
          operator: "泡泡",
          action: "acquire",
          target: { kind: "needs_review" },
          priority: "high_efficiency_standalone",
          priority_rank: 100,
          reason: "standalone",
          product: "originium_shards",
          acquisition: { kind: "public_recruitment", detail: "公开招募获取" },
        }],
        combinations: [{
          id: "bubble_group",
          name: "泡泡火神组",
          product: "originium_shards",
          consumer_products: ["gold"],
          tier: "high_efficiency",
          scale: "small",
          facilities: ["manufacturing_station"],
          state: "needs_review",
          completed_slots: 0,
          total_slots: 1,
          completion_percent: 0,
          members: [{
            operator: "泡泡",
            role: "core",
            progress: "needs_review",
            owned: false,
            target_met: false,
            target: { kind: "needs_review" },
            counts_toward_completion: true,
          }],
        }],
      },
    };

    await mockApis(page);
    await seedV4Session(page, structuredAdviceResult);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "练卡建议" }).click();
    await expect(page.getByRole("heading", { name: "练卡建议", exact: true })).toBeVisible();
    await expect(page.getByText(`搓玉 ${scenario.hasFactory ? "是" : "否"}`, { exact: true })).toBeVisible();
    await expect(page.getByText(/源石厂 [是否]/)).toHaveCount(0);

    if (scenario.expectedSlot === "training-newbie-list") {
      await expect(page.locator("[data-training-newbie-list]")).toBeVisible();
      await expect(page.locator('[data-slot="training-newbie-complete"]')).toHaveCount(0);
      await expect(page.locator('[data-slot="training-newbie-skipped"]')).toHaveCount(0);
      await expect(page.getByText("按技能解锁要求", { exact: false })).toBeVisible();
    } else {
      await expect(page.locator("[data-training-newbie-list]")).toHaveCount(0);
      await expect(page.locator(`[data-slot="${scenario.expectedSlot}"]`)).toBeVisible();
    }

    await expect(page.getByText("源石碎片", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("目标待核对", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("独立推荐", { exact: true })).toBeVisible();
    await expect(page.getByText("待核对", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/needs_review|originium_shards|standalone/, { exact: false })).toHaveCount(0);

    if (scenario.status === "shown") {
      const combinationMember = page
        .locator('[data-slot="training-combination-card"]')
        .getByRole("button")
        .first();
      await combinationMember.hover();
      const profession = page.locator('[data-slot="tooltip-content"][data-open] [data-operator-profession]');
      await expect(profession).toHaveText("重装");
      await expect(profession.locator("img")).toHaveAttribute("src", "/images/profession/重装.webp");
    }
  });
}
