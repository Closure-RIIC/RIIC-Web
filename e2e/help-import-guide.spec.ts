import { expect, test } from "@playwright/test";

test("import guide keeps its screenshots and both import methods in a document", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/help/import-operators");
  await expect(page).toHaveURL(/\/docs\/first-import/);
  await expect(page.getByRole("heading", { name: "首次导入", exact: true })).toBeVisible();
  await expect(page.locator("[data-docs-import-step]")).toHaveCount(5);
  const figure = page.locator('[data-help-screenshot-slot="01"]');
  const zoom = figure.locator("[data-help-screenshot-zoom-layer]");
  const before = (await zoom.boundingBox())!;
  await figure.getByRole("link", { name: "打开高清原图：计算器中的配置入口" }).hover();
  await expect.poll(async () => (await zoom.boundingBox())!.width).toBeGreaterThan(before.width);
  await expect(zoom.locator('[data-help-screenshot-highlight="1"]')).toHaveCount(1);

  await page.locator('aside a[href="#import-methods"]').click();
  await expect(page.locator("[data-help-import-choice-empty]")).toBeVisible();
  await page.locator('[data-help-import-method-option="skland"]').click();
  await expect(page.getByRole("radio", { name: /^森空岛/ })).toBeChecked();
  await expect(page.locator('[data-help-import-method="skland"]')).toBeVisible();
  await expect(page.locator('[data-help-import-method="maa"]')).toHaveCount(0);
  const screenshot = page.locator('[data-help-screenshot-slot="04"] img');
  await expect(screenshot).toHaveAttribute("src", "/images/help/help-import-04-skland-scan.png");
  await expect(page.getByRole("link", { name: "打开高清原图：先确认协议，再扫码" })).toBeVisible();
  const highlights = page.locator('[data-help-screenshot-slot="04"] [data-help-screenshot-highlight]');
  await expect(highlights).toHaveCount(2);
  await expect(highlights.nth(0)).toHaveAttribute("data-help-screenshot-highlight-label", "确认协议");
  await expect(highlights.nth(1)).toHaveAttribute("data-help-screenshot-highlight-label", "扫码");
  expect((await screenshot.boundingBox())!.width).toBeLessThanOrEqual((await page.locator("#docs-content").boundingBox())!.width);

  await page.locator('[data-help-import-method-option="maa"]').click();
  await expect(page.getByRole("radio", { name: /^MAA/ })).toBeChecked();
  await expect(page.locator('[data-help-import-method="skland"]')).toHaveCount(0);
  await expect(page.locator('[data-help-import-method="maa"]')).toBeVisible();
  expect(new URL(page.url()).searchParams.get("source")).toBe("maa");
  await page.reload();
  await expect(page.getByRole("radio", { name: /^MAA/ })).toBeChecked();
});

test("legacy import links preserve their step and method with accessible mobile navigation", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/help/import-operators?step=4&source=maa");
  await expect(page).toHaveURL(/\/docs\/first-import\?source=maa#import-methods$/);
  await expect(page.getByRole("radio", { name: /^MAA/ })).toBeChecked();
  const skland = page.getByRole("radio", { name: /^森空岛/ });
  await skland.focus();
  await page.keyboard.press("Space");
  await expect(skland).toBeChecked();
  await expect(page.locator('[data-help-import-method="skland"]')).toBeVisible();
  const trigger = page.getByRole("button", { name: "展开或收起目录" });
  await trigger.click();
  const navigation = page.getByRole("navigation", { name: "文档目录" });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link", { name: "首次导入", exact: true })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");
  await expect(navigation).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await navigation.getByRole("button", { name: "常见问题", exact: true }).click();
  await navigation.getByRole("link", { name: "结果里有未持有的干员", exact: true }).click();
  await expect(page).toHaveURL(/\/docs\/faq-box$/);
  await expect(page.getByRole("dialog", { name: /^(侧边栏|側邊欄|Sidebar)$/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("documentation uses the fixed workbench frame and an external scrollbar", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/docs/first-import");
  await expect(page.locator('body[data-app-hydrated="true"]')).toBeVisible();
  const frame = page.locator('[data-slot="sidebar-inset"]');
  const scroll = page.locator('[data-app-scroll-area="docs"]');
  const initial = (await frame.boundingBox())!;
  expect(initial.y).toBe(8);
  expect(initial.height).toBe(884);
  await scroll.hover({ position: { x: 300, y: 200 } });
  await page.mouse.wheel(0, 600);
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(300);
  expect(await frame.boundingBox()).toEqual(initial);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const handle = page.locator("#docs-page-scrollbar .os-scrollbar-vertical .os-scrollbar-handle");
  await expect(handle).toBeVisible();
  expect((await handle.boundingBox())!.x).toBeGreaterThanOrEqual(initial.x + initial.width);
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("FAQ articles keep source attribution and legacy issue links reach the matching answer", async ({ page }) => {
  await page.goto("/help");
  await expect(page).toHaveURL(/\/docs$/);
  await page.locator("[data-docs-home]").getByRole("link", { name: /常见问题总览/ }).first().click();
  await page.locator("#docs-content").getByRole("link", { name: "导出到 MAA", exact: true }).click();
  await expect(page.locator("#docs-content")).toContainText("MAA 自定义基建 JSON");
  await expect(page.locator('#docs-content a[href="https://github.com/lejciy/RIIC-knowledge"]')).toBeVisible();
  await expect(page.getByRole("link", { name: "查看原文", exact: true })).toHaveAttribute("href", /\/blob\/[a-f0-9]{40}\//);
  await page.goto("/help/owned-operators?issue=unexpected-operators");
  await expect(page).toHaveURL(/\/docs\/faq-box$/);
  await expect(page.locator("#docs-content")).toContainText("全角色示例");
  await page.goto("/help/owned-operators?issue=box-not-applied");
  await expect(page).toHaveURL(/\/docs\/faq-box-not-applied$/);
  await expect(page.locator("#docs-content")).toContainText("重新生成");
});

test("documentation navigation stays usable in portrait and landscape", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/docs");
  await page.getByRole("button", { name: "展开或收起目录" }).click();
  const sidebar = page.locator('[data-sidebar="sidebar"][data-mobile="true"]');
  await expect(sidebar).toBeVisible();
  const bounds = (await sidebar.boundingBox())!;
  expect(bounds.width).toBeLessThanOrEqual(375 - 48);
  await expect(sidebar.getByRole("link", { name: "返回基建" })).toHaveAttribute("href", "/");
  await expect(sidebar.getByRole("button", { name: "关闭目录" })).toBeVisible();
  await page.setViewportSize({ width: 667, height: 375 });
  await expect(sidebar).toBeVisible();
  expect(await sidebar.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0);
  await sidebar.getByRole("link", { name: "视频教程", exact: true }).click();
  await expect(page).toHaveURL(/\/docs\/video-tutorials$/);
  await expect(page.getByRole("region", { name: "视频教程列表" }).locator(":scope > article")).toHaveCount(4);
  await expect(page.locator("[data-tutorial-video]")).toHaveCount(3);
  await expect(page.locator("video")).toHaveCount(0);
});
