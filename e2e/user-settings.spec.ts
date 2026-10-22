import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { mockApis, seedV4Session, scheduleVisualPlanData } from "./production-readiness.fixture";

test("settings persist and control language, schedule controls and MAA export", async ({ page }) => {
  await mockApis(page);
  await seedV4Session(page);
  await page.goto("/settings");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  await page.getByRole("switch", { name: /^加载英文资源/ }).click();
  await page.locator("[data-sidebar-account-trigger]").click();
  await expect(page.getByRole("menuitemradio", { name: "EN（关闭）", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByRole("switch", { name: /^严格按照顺序入驻/ }).click();
  await page.getByRole("switch", { name: /^加载干员图片/ }).click();
  await page.getByRole("button", { name: "细致调整", exact: true }).click();
  await page.getByRole("combobox", { name: "一图流和列表式控件", exact: true }).click();
  await page.getByRole("option", { name: "下拉表单", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("switch", { name: /^严格按照顺序入驻/ })).not.toBeChecked();
  await page.locator("[data-sidebar-account-trigger]").click();
  await expect(page.getByRole("menuitemradio", { name: "EN（关闭）", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.goto("/");
  const shifts = page.getByRole("combobox", { name: "班次", exact: true });
  await expect(shifts).toBeVisible();
  await expect(page.locator("[data-plan-board]")).toHaveAttribute("data-hide-images", "");
  const pending = page.waitForEvent("download");
  await page.locator('[data-calculator-export-actions="desktop"]').getByRole("button", { name: "导出到 MAA", exact: true }).click();
  const download = await pending;
  const exported = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(exported.plans.flatMap((plan: { rooms: Record<string, Array<{ sort: boolean }>> }) => Object.values(plan.rooms).flat()).every((room: { sort: boolean }) => room.sort === false)).toBe(true);
});

test("settings dropdowns preserve independent choices and fit narrow screens", async ({ page }) => {
  await mockApis(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: "细致调整", exact: true }).click();
  const shifts = page.getByRole("combobox", { name: "多班制切换方式", exact: true });
  await expect(shifts).toBeDisabled();
  await page.getByRole("switch", { name: /^统一使用总设置/ }).click();
  await shifts.click();
  await shifts.press("ArrowDown");
  await shifts.press("Enter");
  await expect(shifts).toHaveValue("下拉表单");
  await expect(page.getByRole("combobox", { name: "一图流和列表式控件", exact: true })).toHaveValue("按钮");
  await page.getByRole("combobox", { name: "导出图片范围", exact: true }).click();
  await page.getByRole("option", { name: "全班", exact: true }).click();
  await page.getByRole("combobox", { name: "技能页加载方式", exact: true }).click();
  await page.getByRole("option", { name: "每十条点击加载", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "细致调整", exact: true }).click();
  await expect(shifts).toHaveValue("下拉表单");
  await expect(page.getByRole("combobox", { name: "导出图片范围", exact: true })).toHaveValue("全班");
  const pagination = page.getByRole("combobox", { name: "技能页加载方式", exact: true });
  await expect(pagination).toHaveValue("每十条点击加载");
  await page.setViewportSize({ width: 375, height: 812 });
  await pagination.click();
  await expect(page.getByRole("option", { name: "无限下滚", exact: true })).toBeVisible();
  const popup = await page.locator('[data-slot="combobox-content"]').boundingBox();
  expect(popup).not.toBeNull();
  expect(popup!.x).toBeGreaterThanOrEqual(0);
  expect(popup!.x + popup!.width).toBeLessThanOrEqual(375);
  await pagination.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(pagination).toHaveValue("每十条点击加载");
});

test("Mower controls stay hidden by default and appear when enabled", async ({ page }) => {
  await mockApis(page);
  await seedV4Session(page);
  await page.goto("/settings");
  const mower = page.getByRole("switch", { name: /Mower/ });
  await expect(mower).not.toBeChecked();
  await mower.click();
  await page.reload();
  await expect(mower).toBeChecked();
  await page.goto("/manual");
  await expect(page.getByRole("button", { name: /Export Mower|导出 Mower/ })).toBeVisible();
});

test("one-shift image export preserves the selected shift", async ({ page }) => {
  await mockApis(page);
  await seedV4Session(page);
  await page.addInitScript(() => localStorage.setItem("riic-web-user-settings", JSON.stringify({ scheduleViewControl: "select" })));
  await page.goto("/");
  const shifts = page.getByRole("combobox", { name: "班次", exact: true });
  await shifts.selectOption("1");
  const pending = page.waitForEvent("download");
  await page.locator('[data-calculator-export-actions="desktop"]').getByRole("button", { name: /导出图片/ }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("arknights-infra-schedule-shift-2.png");
  await expect(shifts).toHaveValue("1");
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
});

test("calculator room sorting is reflected in MAA export and stays within the active shift", async ({ page }) => {
  await mockApis(page);
  await seedV4Session(page, scheduleVisualPlanData);
  await page.addInitScript(() => localStorage.setItem("riic-web-user-settings", JSON.stringify({ allowReplacementOperatorSort: true })));
  await page.goto("/");
  const room = page.locator('[data-compact-schedule-view] [data-room-group="trading"]').first();
  await room.getByRole("button", { name: "调整干员顺序", exact: true }).click();
  await expect(room.getByRole("button", { name: "退出调整顺序", exact: true })).toHaveAttribute("aria-pressed", "true");
  await room.locator('.infra-operator-slot[role="button"]').nth(0).click();
  await room.locator('.infra-operator-slot[role="button"]').nth(1).click();
  const pending = page.waitForEvent("download");
  await page.locator('[data-calculator-export-actions="desktop"]').getByRole("button", { name: "导出到 MAA", exact: true }).click();
  const download = await pending;
  const exported = JSON.parse(await readFile((await download.path())!, "utf8"));
  const names = (operators: Array<string | { name: string }>) => operators.map((operator) => typeof operator === "string" ? operator : operator.name);
  expect(names(exported.plans[0].rooms.trading[0].operators)).toEqual(["凯尔希", "阿米娅", "贝洛内"]);
  expect(names(exported.plans[1].rooms.trading[0].operators)).toEqual(["阿米娅", "凯尔希", "贝洛内"]);
});

test("standalone Mower editor uses the shared schedule components", async ({ page }) => {
  await mockApis(page);
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto("/mower");
  await expect(page.locator("[data-mower-schedule-page]")).toBeVisible();
  await expect(page.locator("[data-plan-board]")).toBeVisible();
  await page.getByRole("button", { name: "编辑贸易站 B101", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "添加干员" })).toBeVisible();
});

test("Mower morale rules use the current Box picker", async ({ page }) => {
  await mockApis(page);
  await seedV4Session(page);
  await page.goto("/mower");
  await page.locator("[data-mower-rules] summary").click();
  await page.getByRole("button", { name: "需要回满心情的干员", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("textbox", { name: "搜索当前 Box 干员" })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: /阿米娅|Amiya/ }).first()).toBeVisible();
});

for (const { width, locale } of [{ width: 1440, locale: "zh" }, { width: 375, locale: "en" }]) {
  test(`grouped settings keep preferences, session extension and data controls usable at ${width}px in ${locale}`, async ({ page, context, baseURL }) => {
    const en = locale === "en";
    await mockApis(page);
    await context.addCookies([{ name: "riic-locale", value: locale, url: baseURL! }]);
    await page.setViewportSize({ width, height: 900 });
    let expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    let extensions = 0;
    let rejectExtension = true;
    await page.route("**/api/auth/get-session", route => route.fulfill({ json: {
      user: { id: "settings-user", name: "Settings Doctor", email: "settings@example.test" },
      session: { expiresAt },
    } }));
    await page.route("**/api/account/data-consent", route => route.fulfill({ json: {
      success: true, data: { current: false, cloudSyncEnabled: true, acceptedAt: null, revokedAt: null },
    } }));
    await page.route("**/api/account/session/extend", route => {
      expect(route.request().method()).toBe("POST");
      if (rejectExtension) return route.fulfill({ status: 503, json: { error: { message: "Session renewal unavailable" } } });
      extensions += 1;
      expiresAt = new Date(Date.parse(expiresAt) + 30 * 86_400_000).toISOString();
      return route.fulfill({ json: { data: { expiresAt } } });
    });
    await page.goto("/settings");
    await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: /^(账号管理|Account management)$/ })).toHaveCount(0);
    const header = page.locator("[data-settings-header]");
    await expect(header.locator("[data-website-account-avatar]")).toBeVisible();
    await expect(header.getByText("Settings Doctor", { exact: true })).toBeVisible();
    await expect(header.getByText("settings@example.test", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /^(返回基建计算器|Back to calculator)$/ })).toHaveCount(0);
    const consent = page.locator("[data-cloud-consent-dialog]");
    await consent.getByRole("button", { name: en ? "Keep local-only mode" : "继续纯本地模式", exact: true }).click();
    await expect(consent).toHaveCount(0);
    const display = page.locator('[data-settings-group="display"]');
    await display.getByRole("button", { name: en ? "Detailed controls" : "细致调整", exact: true }).click();
    await expect(display.getByRole("combobox", { name: en ? "Overview and list control" : "一图流和列表式控件", exact: true })).toBeVisible();
    const resources = page.locator('[data-settings-group="resources"]');
    const images = resources.getByRole("switch", { name: en ? /^Load operator images/ : /^加载干员图片/ });
    await expect(images).toBeChecked();
    await images.click();
    await page.reload();
    await expect(images).not.toBeChecked();
    expect(await page.locator("[data-user-settings-page] [data-infra-heading-accent]").evaluateAll(nodes =>
      nodes.every(node => getComputedStyle(node).display === "none")
    )).toBe(true);
    const cards = await page.locator("[data-settings-columns] [data-infra-technical-card]").evaluateAll(nodes =>
      nodes.map(node => {
        const rect = node.getBoundingClientRect();
        return { left: Math.round(rect.left), top: rect.top, bottom: rect.bottom };
      })
    );
    const columns = [...new Set(cards.map(card => card.left))].map(left => cards.filter(card => card.left === left));
    expect(columns).toHaveLength(width >= 1024 ? 2 : 1);
    for (const column of columns) {
      for (let index = 1; index < column.length; index += 1) {
        expect(column[index].top - column[index - 1].bottom).toBeCloseTo(12, 0);
      }
    }
    if (columns.length === 2) {
      const heights = columns.map(column => column.at(-1)!.bottom - column[0].top);
      expect(Math.abs(heights[0] - heights[1]) / Math.max(...heights)).toBeLessThan(0.2);
    }

    const security = page.locator('[data-settings-group="security"]');
    await expect(security.getByRole("heading", { name: en ? "Sign-in and security" : "登录与安全", exact: true })).toBeVisible();
    await expect(security.locator("[data-account-logout]")).toHaveCount(0);
    await expect(security.getByRole("button", { name: en ? "Sign out everywhere" : "退出全部设备", exact: true })).toHaveCount(1);
    const oldExpiry = await security.getByText(/^(到期时间：|Expires:)/).textContent();
    await security.getByRole("button", { name: en ? "View and extend" : "查看与延长", exact: true }).click();
    const lifetime = page.getByRole("dialog", { name: en ? "Manage session lifetime" : "管理登录有效期", exact: true });
    await lifetime.getByRole("button", { name: en ? "Extend 30 days" : "延长 30 天", exact: true }).click();
    await expect(lifetime.getByRole("alert")).toContainText("Session renewal unavailable");
    const activity = page.locator('[data-slot="live-activity"][data-activity-kind="account"]');
    await expect(activity).toHaveCount(0);
    expect(extensions).toBe(0);
    rejectExtension = false;
    await lifetime.getByRole("button", { name: en ? "Extend 30 days" : "延长 30 天", exact: true }).click();
    await expect(lifetime).toHaveCount(0);
    await expect(activity).toContainText(en ? "This device's session has been extended by 30 days." : "当前设备的登录有效期已延长 30 天。");
    await activity.getByRole("button", { name: en ? "Dismiss notification" : "关闭提示", exact: true }).click();
    await expect(activity).toHaveCount(0);
    await expect(security.getByText(/^(到期时间：|Expires:)/)).not.toHaveText(oldExpiry!);
    expect(extensions).toBe(1);
    const data = page.locator('[data-settings-group="data"]');
    await expect(data.locator("[data-cloud-data-panel]")).toHaveCount(1);
    await expect(data.getByRole("button", { name: en ? "Clear data" : "清除数据", exact: true })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
