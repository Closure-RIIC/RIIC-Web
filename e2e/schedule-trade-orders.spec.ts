import { expect, test } from "@playwright/test";
import layout243 from "@riic/arknights-domain/layouts/243.json" with { type: "json" };
import { mockApis, seedV4Session, twoShiftPlanData } from "./production-readiness.fixture";

test("trade icons and selected orders follow the current shift instead of the input layout", async ({ page }) => {
  test.setTimeout(90_000);
  const result = structuredClone(twoShiftPlanData);
  result.maa.plans[1]!.rooms.trading.reverse();
  await mockApis(page);
  await seedV4Session(page, result, { rotationProfile: "main_backup_12_12" });
  await page.addInitScript((layout) => {
    const key = "arknights-infra-calc-session-v4";
    const session = JSON.parse(localStorage.getItem(key)!);
    session.layout = layout;
    localStorage.setItem(key, JSON.stringify(session));
  }, { ...layout243, rooms: layout243.rooms.map(room => room.id === "trade_1" ? { ...room, product: { trade: { order: "originium" } } } : room) });
  await page.goto("/");
  const compact = page.locator("[data-compact-schedule-view]");
  await expect(compact).toBeVisible({ timeout: 45_000 });

  for (const shift of [0, 1]) {
    await page.getByRole("tab", { name: new RegExp(`^第 ${shift + 1} 班`) }).click();
    await page.getByRole("tab", { name: "一图流布局", exact: true }).click();
    for (const room of [1, 2]) {
      const originium = room === (shift === 0 ? 2 : 1);
      const icon = compact.locator(`[data-schedule-room="trade_${room}"] [data-compact-product-badge] img`);
      await expect(icon).toHaveAttribute("src", originium ? /\/orundum\.webp\?/ : /\/lmd_orders\.webp\?/);
      await expect(icon).toHaveAttribute("alt", originium ? "开采协力" : "龙门商法");
    }
    await page.getByRole("tab", { name: "列表式布局", exact: true }).click();
    const list = page.locator('[data-schedule-view="list"]');
    for (const room of [1, 2]) {
      const label = room === (shift === 0 ? 2 : 1) ? "开采协力" : "龙门商法";
      await expect(list.locator(`[data-schedule-room="trade_${room}"]`).getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true");
    }
  }
});
