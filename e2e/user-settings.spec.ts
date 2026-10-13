import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { mockApis, seedV4Session, scheduleVisualPlanData } from "./production-readiness.fixture";

test("settings persist and control language, schedule controls and MAA export", async ({ page }) => {
  await mockApis(page);
  await seedV4Session(page);
  await page.goto("/settings");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  await page.getByRole("switch", { name: /^加载英文资源/ }).click();
  await expect(page.getByRole("button", { name: "EN（关闭）", exact: true })).toBeDisabled();
  await page.getByRole("switch", { name: /^严格按照顺序入驻/ }).click();
  await page.getByRole("switch", { name: /^加载干员图片/ }).click();
  await page.getByRole("button", { name: "细致调整", exact: true }).click();
  await page.getByRole("combobox", { name: "一图流和列表式控件", exact: true }).click();
  await page.getByRole("option", { name: "下拉表单", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("switch", { name: /^严格按照顺序入驻/ })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "EN（关闭）", exact: true })).toBeDisabled();
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
