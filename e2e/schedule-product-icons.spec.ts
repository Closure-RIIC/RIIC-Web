import { expect, test } from "@playwright/test";
import layout243 from "@riic/arknights-domain/layouts/243.json" with { type: "json" };
import { mockApis, seedV4Session, twoShiftPlanData } from "./production-readiness.fixture";

test("generated schedule product icons follow the MAA plan recipes", async ({ page }) => {
  await mockApis(page);
  await seedV4Session(page, twoShiftPlanData, { rotationProfile: "main_backup_12_12" });
  // The solver chose the opposite recipe order from the input blueprint.
  await page.addInitScript((layout) => {
    const key = "arknights-infra-calc-session-v4";
    const session = JSON.parse(localStorage.getItem(key)!);
    session.layout = layout;
    localStorage.setItem(key, JSON.stringify(session));
  }, { ...layout243, rooms: layout243.rooms.map(room => room.id === "manu_3" ? { ...room, product: { factory: { recipe: "originium" } } } : room) });
  await page.goto("/");
  const schedule = page.locator("[data-compact-schedule-view]");
  await expect(schedule).toBeVisible({ timeout: 45_000 });
  await expect(schedule.locator('[data-schedule-room="manu_3"] [data-compact-product-badge] img')).toHaveAttribute("src", /\/experience\.webp\?/);
  await expect(schedule.locator('[data-schedule-room="manu_4"] [data-compact-product-badge] img')).toHaveAttribute("src", /\/originium_shard\.webp\?/);
  await page.getByRole("tab", { name: "列表式布局", exact: true }).click();
  const list = page.locator('[data-schedule-view="list"]');
  await expect(list.locator('[data-schedule-room="manu_3"]').getByRole("button", { name: "作战记录", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(list.locator('[data-schedule-room="manu_4"]').getByRole("button", { name: "源石碎片", exact: true })).toHaveAttribute("aria-pressed", "true");
});
