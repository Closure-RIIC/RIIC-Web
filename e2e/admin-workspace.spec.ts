import { test, expect } from "@playwright/test";

test.beforeEach(async ({ context, baseURL }) => {
  test.skip(!process.env.ADMIN_UI_PREVIEW, "Local preview checks require the explicit preview command.");
  await context.addCookies([{ name: "riic-locale", value: "zh", domain: new URL(baseURL!).hostname, path: "/" }]);
});

test("preview reuses all six pages and keeps requests inside the sample transport", async ({ page }) => {
  const apiRequests: string[] = [];
  const errors: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/admin/")) apiRequests.push(request.url()); });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/admin-preview");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("运行概览");
  await expect(page.locator("[data-admin-solver-metrics]")).toContainText("1.25");
  const navigation = page.getByRole("navigation", { name: "后台导航", exact: true });
  for (const [title, path] of [["用户管理", "users"], ["问题反馈", "issues"], ["复现测试", "quality"], ["技能注释", "skills"], ["更新日志", "changelog"]]) {
    await navigation.getByRole("link", { name: title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp("/admin-preview/" + path + "$"));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("#admin-content").getByRole("alert")).toHaveCount(0);
  }
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("users filter, paginate, search, and preserve role confirmation", async ({ page }) => {
  await page.goto("/admin-preview/users");
  const table = page.getByRole("table", { name: "用户管理", exact: true });
  await expect(table.getByRole("row")).toHaveCount(11);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(table.getByRole("row")).toHaveCount(8);
  await page.getByRole("combobox", { name: "角色", exact: true }).selectOption("reviewer");
  await expect(table.getByRole("row")).toHaveCount(3);
  await page.getByRole("combobox", { name: "角色", exact: true }).selectOption("all");
  await page.getByRole("combobox", { name: "状态", exact: true }).selectOption("suspended");
  await expect(table.getByRole("row")).toHaveCount(2);
  await page.getByRole("combobox", { name: "状态", exact: true }).selectOption("all");
  await page.getByRole("search").getByRole("textbox").fill("Kestrel");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table).toContainText("Kestrel");
  await page.getByRole("button", { name: "管理账户", exact: true }).click();
  await page.getByRole("button", { name: "设为审阅人", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Kestrel");
  await page.getByRole("dialog").getByRole("button", { name: "确认设为审阅人", exact: true }).click();
  await expect(page.getByRole("button", { name: "撤销审阅人", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看 Session", exact: true }).click();
  await expect(page.locator("#users")).toContainText("Preview browser");
});

test("reviewer navigation, command search, and real route protection", async ({ page }) => {
  await page.goto("/admin-preview");
  await page.getByRole("combobox", { name: "预览角色" }).selectOption("reviewer");
  const nav = page.getByRole("navigation", { name: "后台导航", exact: true });
  await expect(nav.getByRole("link")).toHaveCount(3);
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("反馈");
  await dialog.getByRole("link", { name: /问题反馈/ }).click();
  await expect(page).toHaveURL(/\/admin-preview\/issues$/);
  await page.goto("/admin");
  await expect(page.locator("[data-sidebar=trigger]")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "后台导航", exact: true })).toHaveCount(0);
});

test("mobile navigation and tables do not overflow the page", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/admin-preview/users");
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("button", { name: "展开或收起后台导航" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("link", { name: "问题反馈", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  for (const [locale, label] of [["en", "English"], ["zh-TW", "繁體中文（台灣）"], ["zh-CN", "简体中文"]]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
});

test("English navigation and page copy resolve", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "riic-locale", value: "en", domain: new URL(baseURL!).hostname, path: "/" }]);
  await page.goto("/admin-preview/users");
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Administration navigation" }).getByRole("link")).toHaveCount(6);
  await expect(page.getByRole("table")).toContainText("Kestrel");
  await expect(page.getByText("AdminWorkspace.", { exact: false })).toHaveCount(0);
});

for (const width of [1440, 375]) {
  test(`admin pages scroll to their footer at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 650 });
    await page.goto("/admin-preview/users");
    await expect(page.getByRole("table")).toBeVisible();
    const footer = page.locator('[data-slot="sidebar-wrapper"] footer');
    expect((await footer.boundingBox())!.y).toBeGreaterThan(650);
    await page.mouse.move(width - 80, 450);
    await page.mouse.wheel(0, 1500);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    await expect(footer).toBeInViewport();
  });
}
