import { expect, type Page } from "@playwright/test";

export async function openAgentHistory(page: Page, title: string) {
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  const toggle = page.locator("[data-agent-history-toggle]");
  if ((page.viewportSize()?.width ?? 1280) < 768 && !await toggle.isVisible()) {
    await page.getByRole("button", { name: /^(切换侧边栏|切換側邊欄|Toggle Sidebar)$/i, exact: true }).click();
  }
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await page.locator("[data-agent-history]").getByRole("link", { name: title, exact: true }).click();
}
