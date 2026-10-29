import { expect, type Page } from "@playwright/test";

export async function switchWorkbenchLanguage(page: Page, locale: "zh" | "zh-CN" | "zh-TW" | "en") {
  const trigger = page.locator("[data-sidebar-account-trigger]");
  const openedSidebar = !await trigger.isVisible();
  if (openedSidebar) {
    await page.locator("[data-app-topbar]").getByRole("button", { name: /^(切换侧边栏|切換側邊欄|Toggle Sidebar)$/i }).click();
  }
  await trigger.click();
  const normalized = locale === "zh" ? "zh-CN" : locale;
  const labels = { "zh-CN": "简体中文", "zh-TW": "繁體中文（台灣）", en: "English" };
  await page.getByRole("menuitemradio", { name: labels[normalized], exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", normalized);
  await page.keyboard.press("Escape");
  if (openedSidebar) await page.keyboard.press("Escape");
}
