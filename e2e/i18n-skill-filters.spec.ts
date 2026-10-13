import { expect, test } from "@playwright/test";
test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
  await page.route("**/api/skill-annotations", (route) => route.fulfill({ json: { success: true, data: { annotations: [] } } }));
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: null }));
  await page.route("**/api/releases**", (route) => route.fulfill({
    json: { success: true, data: { environment: "development", releases: [] } },
  }));
});

test("cookie locale renders on the server, while switching preserves filters and search", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "riic-locale", value: "en", url: baseURL! }]);
  const response = await page.goto("/skills");
  const html = await response!.text();
  expect(html).toContain('lang="en"');
  await expect(page).toHaveTitle("Skill Reference · Closure Infrastructure Terminal");
  const rows = page.locator("[data-skill-filter-row]");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(3)).toContainText("Choose a facility first");
  await rows.nth(0).getByRole("tab", { name: "6-star operators" }).click();
  await rows.nth(1).getByRole("tab", { name: "Guard", exact: true }).click();
  await page.getByRole("textbox", { name: "Search operator, skill name, or effect" }).fill("银灰");
  await page.getByRole("button", { name: "中文", exact: true }).first().click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page).toHaveTitle("技能查询 · 可露希尔基建终端");
  await expect(rows.nth(0).getByRole("tab", { name: "6 星干员" })).toHaveAttribute("aria-selected", "true");
  await expect(rows.nth(1).getByRole("tab", { name: "近卫", exact: true })).toHaveAttribute("aria-selected", "true");
  const search = page.getByRole("textbox", { name: "搜索干员名称/技能名称/技能效果" });
  await expect(search).toHaveValue("银灰");
  await page.getByRole("button", { name: "清除选择", exact: true }).click();
  await expect(search).toHaveValue("银灰");
  await expect(rows.nth(0).getByRole("tab", { name: "全部", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "清除选择", exact: true })).toBeDisabled();
});

test("mobile has four bounded rows and room changes clear the tag", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/skills");
  const rows = page.locator("[data-skill-filter-row]");
  await expect(rows).toHaveCount(4);
  await rows.nth(2).getByRole("tab", { name: "制造站", exact: true }).click();
  await rows.nth(3).getByRole("tab", { name: "贵金属", exact: true }).click();
  await rows.nth(2).getByRole("tab", { name: "贸易站", exact: true }).click();
  await expect(rows.nth(3).getByRole("tab", { name: "全部", exact: true })).toHaveAttribute("aria-selected", "true");
  await rows.nth(2).getByRole("tab", { name: "发电站", exact: true }).click();
  await expect(rows.nth(3)).toContainText("该房间暂无技能标签");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("legacy preference migrates once; an existing cookie takes precedence", async ({ page, context, baseURL }) => {
  await page.addInitScript(() => localStorage.setItem("infra-demo-locale", "en"));
  await page.goto("/skills");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect((await context.cookies()).find((cookie) => cookie.name === "riic-locale")?.value).toBe("en");
  await context.addCookies([{ name: "riic-locale", value: "zh", url: baseURL! }]);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
});

test("a warm English game catalog does not race workbench hydration", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "riic-locale", value: "en", url: baseURL! }]);
  const hydrationErrors: string[] = [];
  page.on("pageerror", (error) => {
    if (/hydration|React error #418/i.test(error.message)) hydrationErrors.push(error.message);
  });

  await page.goto("/");
  // Let the independently loaded game catalog enter the browser cache before
  // repeatedly hydrating a route that renders localized operator and skill text.
  await page.waitForTimeout(2_000);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.goto("/skills");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("[data-skill-filter-row]")).toHaveCount(4);
    await page.goto("/");
  }

  expect(hydrationErrors).toEqual([]);
});

for (const locale of ["zh", "en"] as const) {
  test(`${locale} public pages render translated headings and metadata`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "riic-locale", value: locale, url: baseURL! }]);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (/MISSING_MESSAGE|INVALID_MESSAGE|FORMATTING_ERROR/.test(message.text())) errors.push(message.text());
    });
    const titles = locale === "en"
      ? ["About", "Help Center", "Import Operator Box", "Check Operator Data", "Privacy Policy", "Terms of Service", "Account", "Changelog"]
      : ["关于我们", "使用帮助", "导入干员", "核对干员数据", "隐私政策", "服务条款", "账号", "更新日志"];
    const routes = ["/about", "/help", "/help/import-operators", "/help/owned-operators", "/privacy", "/terms", "/account", "/changelog"];
    for (const [index, route] of routes.entries()) {
      const response = await page.goto(route);
      expect(response?.ok(), route).toBe(true);
      expect(await response!.text()).toContain(`lang="${locale === "zh" ? "zh-CN" : "en"}"`);
      await expect(page).toHaveTitle(new RegExp(titles[index]));
      await expect(page.getByRole("heading").first(), route).toBeVisible();
      if (route === "/changelog") {
        // Its heading is server rendered. Let the translated client feed settle
        // before navigating away while hydration is still starting its fetch.
        await expect(page.locator("[data-changelog-page] [data-skeleton-swap]")).toHaveAttribute("aria-busy", "false");
        await expect(page.locator("[data-changelog-page]").getByText(locale === "en" ? "No published updates yet." : "暂时没有已发布的更新。", { exact: true })).toBeVisible();
      }
    }
    for (const source of ["skland", "maa"] as const) {
      await page.goto(`/help/import-operators?step=4&source=${source}`);
      const method = page.locator(`[data-help-import-method="${source}"]`);
      await expect(method).toBeVisible();
      await expect(method).toContainText(locale === "en" ? "Done when:" : "完成标志：");
      await expect(method.getByRole("img").first()).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}
