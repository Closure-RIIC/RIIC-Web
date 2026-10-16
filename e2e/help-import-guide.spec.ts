import { expect, test } from "@playwright/test";

test("import guide uses page-by-page navigation", async ({ page }) => {
  await page.goto("/help/import-operators");

  const guideRoot = page.locator("[data-help-import-step]");
  const nextButton = page.getByRole("button", { name: "下一页" });

  await expect(guideRoot).toHaveAttribute("data-help-import-step", "1");
  await expect(page.getByRole("heading", { name: "打开「配置 Box 与布局」" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "选择导入方式" })).toHaveCount(0);
  await expect(page.getByLabel("教程进度", { exact: true }).getByText("第 1 步 · 共 5 步")).toBeVisible();
  expect(new URL(page.url()).searchParams.has("source")).toBe(false);

  const firstFigure = page.locator('[data-help-screenshot-slot="01"]');
  const zoomLayer = firstFigure.locator("[data-help-screenshot-zoom-layer]");
  const firstHighlight = firstFigure.locator('[data-help-screenshot-highlight="1"]');
  await expect(zoomLayer.locator('[data-help-screenshot-highlight="1"]')).toHaveCount(1);
  const zoomLayerBefore = (await zoomLayer.boundingBox())!;
  const highlightBefore = (await firstHighlight.boundingBox())!;
  await firstFigure.getByRole("link", { name: "打开高清原图：计算器中的配置入口" }).hover();
  await expect.poll(async () => (await zoomLayer.boundingBox())!.width).toBeGreaterThan(zoomLayerBefore.width);
  expect((await firstHighlight.boundingBox())!.width).toBeGreaterThan(highlightBefore.width);

  await nextButton.click();
  await expect(guideRoot).toHaveAttribute("data-help-import-step", "2");
  await expect(page.getByRole("heading", { name: "回到「干员数据」，点「更换」" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("step")).toBe("2");

  await nextButton.click();
  await expect(guideRoot).toHaveAttribute("data-help-import-step", "3");
  await expect(page.getByRole("heading", { name: "在设置中选择数据来源" })).toBeVisible();
  const sourceHighlight = page.locator('[data-help-screenshot-slot="03"] [data-help-screenshot-highlight="1"]');
  await expect(sourceHighlight).toHaveAttribute("data-help-screenshot-highlight-label", "选择森空岛或 MAA");
  await expect(sourceHighlight).toHaveAttribute("data-help-screenshot-highlight-y", "69.4");

  const tutorialTargets = page.locator("[data-help-step-target]");
  await expect(tutorialTargets).toHaveCount(5);
  await page.locator('[data-help-step-target="4"]').click();
  await expect(guideRoot).toHaveAttribute("data-help-import-step", "4");
  const sklandRadio = page.getByRole("radio", { name: /^森空岛/ });
  const maaRadio = page.getByRole("radio", { name: /^MAA/ });
  await expect(sklandRadio).not.toBeChecked();
  await expect(maaRadio).not.toBeChecked();
  await expect(page.locator("[data-help-import-choice-empty]")).toBeVisible();
  await expect(page.locator('[data-help-import-method="skland"]')).toHaveCount(0);
  await expect(page.locator('[data-help-import-method="maa"]')).toHaveCount(0);

  await page.locator('[data-help-import-method-option="skland"]').click();
  await expect(sklandRadio).toBeChecked();
  await expect(page.locator('[data-help-import-method="skland"]')).toBeVisible();
  await expect(page.locator('[data-help-import-method="maa"]')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("source")).toBe("skland");
  const hdScreenshot = page.locator('[data-help-screenshot-slot="04"] img');
  await expect(hdScreenshot).toHaveAttribute("src", "/images/help/help-import-04-skland-scan.png");
  await expect(page.getByText(/勾选并确认两项协议。/)).toBeVisible();
  await expect(page.getByRole("link", { name: "打开高清原图：先确认协议，再扫码" })).toBeVisible();
  expect((await hdScreenshot.boundingBox())!.width).toBeGreaterThan(900);
  const sklandHighlights = page.locator('[data-help-screenshot-slot="04"] [data-help-screenshot-highlight]');
  await expect(sklandHighlights).toHaveCount(2);
  await expect(sklandHighlights.nth(0)).toHaveAttribute("data-help-screenshot-highlight-label", "确认协议");
  await expect(sklandHighlights.nth(0)).toHaveAttribute("data-help-screenshot-highlight-y", "69.6");
  await expect(sklandHighlights.nth(1)).toHaveAttribute("data-help-screenshot-highlight-label", "扫码");
  await expect(sklandHighlights.nth(1)).toHaveAttribute("data-help-screenshot-highlight-y", "37.2");

  await page.locator('[data-help-import-method-option="maa"]').click();
  await expect(maaRadio).toBeChecked();
  await expect(page.locator('[data-help-import-method="skland"]')).toHaveCount(0);
  await expect(page.locator('[data-help-import-method="maa"]')).toBeVisible();
  expect(new URL(page.url()).searchParams.get("source")).toBe("maa");

  await page.locator('[data-help-step-target="5"]').click();
  await expect(guideRoot).toHaveAttribute("data-help-import-step", "5");
  await expect(page.getByRole("heading", { name: "完成设置并重新生成" })).toBeVisible();
  await expect(page.getByText("提示请求过多或并发已满？")).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("step")).toBe("5");
  expect(new URL(page.url()).searchParams.get("source")).toBe("maa");

  await page.goBack();
  await expect(guideRoot).toHaveAttribute("data-help-import-step", "4");
  await expect(page.locator('[data-help-import-method="maa"]')).toBeVisible();
  await expect(page.locator('[data-help-import-method="skland"]')).toHaveCount(0);
  await expect(maaRadio).toBeChecked();
  expect(new URL(page.url()).searchParams.get("step")).toBe("4");
  expect(new URL(page.url()).searchParams.get("source")).toBe("maa");
});

test("import guide supports direct links, horizontal steps, and floating help navigation", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/help/import-operators?source=maa&step=4");

  const guideRoot = page.locator("[data-help-import-step]");
  await expect(guideRoot).toHaveAttribute("data-help-import-step", "4");
  await expect(page.locator('[data-help-import-method="maa"]')).toBeVisible();
  await expect(page.locator('[data-help-import-method="skland"]')).toHaveCount(0);
  const maaRadio = page.getByRole("radio", { name: /^MAA/ });
  await expect(maaRadio).toBeChecked();
  await expect.poll(() => new URL(page.url()).searchParams.get("source")).toBe("maa");
  expect(new URL(page.url()).searchParams.get("step")).toBe("4");

  const sklandRadio = page.getByRole("radio", { name: /^森空岛/ });
  await sklandRadio.focus();
  await page.keyboard.press("Space");
  await expect(sklandRadio).toBeChecked();
  await expect(page.locator('[data-help-import-method="skland"]')).toBeVisible();
  await expect(page.locator('[data-help-import-method="maa"]')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("source")).toBe("skland");

  const tutorialTargets = page.locator("[data-help-step-target]");
  await expect(tutorialTargets).toHaveCount(5);
  await expect(page.locator('[data-help-step-target="4"]')).toHaveAttribute("aria-current", "step");
  await expect(page.locator('[data-help-step-target="4"]')).toBeInViewport();

  const stepScroll = await page.locator("[data-help-step-navigation-scroll]").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(stepScroll.scrollWidth).toBeGreaterThan(stepScroll.clientWidth);

  await page.locator('[data-help-step-target="5"]').click();
  await expect(guideRoot).toHaveAttribute("data-help-import-step", "5");
  await expect(page.locator('[data-help-step-target="5"]')).toHaveAttribute("aria-current", "step");

  const helpTrigger = page.getByRole("button", { name: "帮助目录", exact: true });
  const helpNavigation = page.getByRole("navigation", { name: "帮助文档导航" });
  await expect(helpTrigger).toBeVisible();
  await expect(helpTrigger).toHaveAttribute("aria-expanded", "false");
  await helpTrigger.click();
  await expect(helpTrigger).toHaveAttribute("aria-expanded", "true");
  await expect(helpNavigation).toBeVisible();
  await expect(helpNavigation.getByRole("link", { name: /切换已有干员/ })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(helpNavigation).toBeHidden();
  await expect(helpTrigger).toBeFocused();

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
});

test("help content fills the desktop container", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/help/import-operators");

  const contentBox = await page.locator("#help-content").boundingBox();
  expect(contentBox).not.toBeNull();
  expect(contentBox!.x).toBeLessThan(220);
  expect(contentBox!.width).toBeGreaterThan(1000);

  const helpTrigger = page.getByRole("button", { name: "帮助目录", exact: true });
  const triggerBox = await helpTrigger.boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(triggerBox!.width).toBeGreaterThanOrEqual(44);
  expect(triggerBox!.height).toBeGreaterThanOrEqual(44);
  expect(1440 - triggerBox!.x - triggerBox!.width).toBeLessThanOrEqual(40);
  expect(900 - triggerBox!.y - triggerBox!.height).toBeLessThanOrEqual(40);
});

test("knowledge FAQ replaces quick checks and keeps detailed Box help reachable", async ({ page }) => {
  await page.goto("/help");
  const knowledge = page.locator("[data-help-knowledge]");
  await expect(knowledge.getByRole("button", { name: "生成的排班怎么导入 MAA？", exact: true })).toBeVisible();
  await knowledge.getByRole("button", { name: "生成的排班怎么导入 MAA？", exact: true }).click();
  await expect(knowledge.locator('[data-slot="accordion-panel"]')).toContainText("MAA 自定义基建 JSON");
  await expect(knowledge).not.toContainText("入口名称可能因版本而异");
  await expect(knowledge.getByRole("link", { name: "查看原文", exact: true })).toHaveCount(0);
  await expect(page.locator("#knowledge-topics-title")).toHaveCount(0);
  await expect(page.locator("[data-quick-check-link]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "查看来源与许可", exact: true })).toHaveCount(0);
  await expect(knowledge.locator('a[href="https://github.com/lejciy/RIIC-knowledge"]')).toBeVisible();
  await page.locator('#help-content a[href="/help/owned-operators?issue=unexpected-operators"]').click();
  await expect(page).toHaveURL(/\/help\/owned-operators\?issue=unexpected-operators$/);
  await expect(page.getByRole("radio", { name: "结果里有我没有的干员" })).toBeChecked();
  await expect(page.locator("#sample-warning-title")).toBeVisible();
});

test("app sidebar keeps only the help shortcut", async ({ page }) => {
  await page.addInitScript(() => document.documentElement.classList.add("dark"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).click();

  const mobileSidebar = page.locator('[data-sidebar="sidebar"][data-mobile="true"]');
  await expect(mobileSidebar).toBeVisible();
  await expect(page.locator("[data-faq-navigation]")).toHaveCount(0);

  const helpLink = mobileSidebar.locator("[data-help-link]");
  await expect(helpLink).toHaveCount(1);
  await expect(helpLink).toHaveAttribute("href", "/help");
  await expect(helpLink).toHaveAccessibleName("使用帮助");

  const sidebarBox = await mobileSidebar.boundingBox();
  expect(sidebarBox).not.toBeNull();
  expect(sidebarBox!.width).toBeLessThanOrEqual(Math.min(375 * 0.75, 288) + 1);

  const helpLinkBox = await helpLink.boundingBox();
  expect(helpLinkBox).not.toBeNull();
  expect(helpLinkBox!.height).toBeGreaterThanOrEqual(44);

  await page.setViewportSize({ width: 667, height: 375 });
  await expect(mobileSidebar).toBeVisible();
  const landscapeSidebarBox = await mobileSidebar.boundingBox();
  expect(landscapeSidebarBox).not.toBeNull();
  expect(landscapeSidebarBox!.width).toBeLessThanOrEqual(385);
  const landscapeOverflow = await mobileSidebar.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(landscapeOverflow.scrollWidth).toBe(landscapeOverflow.clientWidth);

  await helpLink.click();
  await expect(page).toHaveURL(/\/help$/);
});
