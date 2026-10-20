import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { mockApis, mockAnonymousWebsiteSession } from "./production-readiness.fixture";
import { MOWER_PRODUCTION_KEYS } from "../apps/arknights/src/mower-editor";

test.beforeEach(async ({ page }) => {
  await mockAnonymousWebsiteSession(page);
  await mockApis(page);
});

test("Mower compact view keeps every production facility reachable in sparse and unusual plans", async ({ page }) => {
  // Exercise sparse main and backup plans, including their auxiliary facilities.
  test.slow();
  await page.setViewportSize({ width: 1600, height: 1000 });
  const extraPower = Object.fromEntries(MOWER_PRODUCTION_KEYS.map((key, index) => [key, {
    name: index < 4 ? "发电站" : "制造站", plans: [],
  }]));
  await page.addInitScript((plan) => localStorage.setItem("riic-web-mower-editor-v1", JSON.stringify({
    plan1: plan, backup_plans: [{ name: "空副表", plan: {} }],
  })), extraPower);
  await page.goto("/mower");
  const board = page.locator("[data-compact-schedule-view]:visible");
  for (const name of ["主表", "空副表"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    const recycling = board.locator('[data-room-title="回收站"]');
    await expect(recycling).toBeVisible();
    await expect(recycling.locator('.infra-operator-slot[role="button"]')).toHaveCount(2);
    await recycling.locator('.infra-operator-slot[role="button"]').first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    for (const key of MOWER_PRODUCTION_KEYS) {
      const [, floor, room] = key.split("_");
      const card = board.locator(`[data-room-title$="B${floor}0${room}"]`);
      await expect(card).toBeVisible();
      await card.locator('.infra-operator-slot[role="button"]').first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("button", { name: "取消", exact: true }).click();
    }
  }
});

test("Mower facility editing stays scoped to the selected plan and export keeps its fields", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto("/mower");
  await page.getByRole("button", { name: "新建副表", exact: true }).click();
  await page.getByRole("button", { name: "编辑贸易站 B101", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "分组 1", exact: true }).fill("mower-group");
  await dialog.getByRole("textbox", { name: "替换干员 1", exact: true }).fill("阿米娅, 凯尔希");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("tab", { name: "主表", exact: true }).click();
  await page.getByRole("button", { name: "编辑贸易站 B101", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "分组 1", exact: true })).toHaveValue("");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载排班文件", exact: true }).click();
  const download = await pending;
  const plan = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(plan.backup_plans[0].plan.room_1_1.plans[0].group).toBe("mower-group");
  expect(plan.backup_plans[0].plan.room_1_1.plans[0].replacement).toEqual(["阿米娅", "凯尔希"]);
  expect(plan.plan1.dormitory_1.plans[1].agent).toBe("Free");
});

test("Mower reuses responsive list and compact views without horizontal page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/mower");
  await expect(page.locator("[data-compact-schedule-view]:visible")).toBeVisible();
  for (const width of [375, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("button", { name: "编辑贸易站 B101", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "排班信息", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "标题", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "完成", exact: true }).click();
  }
  await page.getByRole("textbox", { name: "搜索 Mower 排班" }).fill("B101");
  await expect(page.getByRole("button", { name: "编辑贸易站 B101", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "编辑制造站 B102", exact: true })).toHaveCount(0);
});
