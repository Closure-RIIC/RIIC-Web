import { expect, test } from "@playwright/test";

test("docs search supports keyboard selection, empty results, and Escape", async ({ page }) => {
  await page.goto("/docs");
  await expect(page.locator('body[data-app-hydrated="true"]')).toBeVisible();
  const trigger = page.locator("[data-docs-topbar]").getByRole("button", { name: "搜索文档" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "搜索文档", exact: true });
  const input = dialog.getByRole("textbox", { name: "搜索文档" });
  await expect(input).toBeFocused();
  await input.fill("no-such-document-198237");
  await expect(dialog.getByRole("status")).toHaveText("0 篇相关文档");
  await expect(dialog).toContainText("没有找到相关文档");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Control+k");
  await input.fill("无人机");
  await input.press("ArrowDown");
  await expect(dialog.getByRole("link").first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/docs\/drones$/);
  await expect(page.getByRole("heading", { name: "无人机安排", exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
});

test("public documentation does not load the workbench or call its private APIs", async ({ page }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", request => requests.push(new URL(request.url()).pathname));
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/docs");
  await expect(page.locator('body[data-app-hydrated="true"]')).toBeVisible();
  await page.locator("[data-docs-home]").getByRole("link", { name: /先导入自己的干员/ }).click();
  await expect(page).toHaveURL(/\/docs\/first-import$/);
  await expect(page.getByRole("heading", { name: "首次导入", exact: true })).toBeVisible();
  expect(requests.filter(path => /^\/api\/(?:agent|skland|plans?|tasks?|workspace)(?:\/|$)/.test(path))).toEqual([]);
  expect(requests.some(path => /src\/App\.tsx$|src\/generated\/training-planner-data/.test(path))).toBe(false);
  expect(errors).toEqual([]);
});

test("article navigation resets scroll and browser back restores the reading position", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/docs/first-import");
  const scroll = page.locator('[data-app-scroll-area="docs"]');
  const next = page.getByRole("navigation", { name: "上一篇与下一篇" }).getByRole("link");
  await next.scrollIntoViewIfNeeded();
  const position = await scroll.evaluate(element => element.scrollTop);
  await next.click();
  await expect(page).toHaveURL(/\/docs\/skland-sync$/);
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/docs\/first-import$/);
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeCloseTo(position, 0);
});

test("unknown documentation URLs return a helpful 404", async ({ page }) => {
  const response = await page.goto("/docs/does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "没有找到这篇文档" })).toBeVisible();
  await page.getByRole("link", { name: "返回文档首页" }).click();
  await expect(page).toHaveURL(/\/docs$/);
});
