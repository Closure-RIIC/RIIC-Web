import { expect, type Page } from "@playwright/test";

export async function switchWorkbenchLanguage(page: Page, locale: "zh" | "en") {
  const trigger = page.locator("[data-sidebar-account-trigger]");
  const openedSidebar = !await trigger.isVisible();
  if (openedSidebar) {
    await page.locator("[data-app-topbar]").getByRole("button", { name: "Toggle Sidebar" }).click();
  }
  await trigger.click();
  await page.getByRole("menuitemradio", { name: locale === "en" ? "EN" : "中文", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", locale === "en" ? "en" : "zh-CN");
  await page.keyboard.press("Escape");
  if (openedSidebar) await page.keyboard.press("Escape");
}
