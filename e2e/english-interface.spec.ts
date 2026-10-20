import { expect, test } from "@playwright/test";

test("English mode keeps the calculator and account entry copy in English", async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "null",
  }));
  await page.addInitScript(() => window.localStorage.setItem("infra-demo-locale", "en"));
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("region", { name: "Schedule setup" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Want to preview scheduling without signing in?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "View sample schedule" })).toBeVisible();
  await expect(page.locator("[data-docs-link]").first()).toHaveAccessibleName("Docs");
  await expect(page.locator("[data-docs-link]").first()).toHaveAttribute("href", "/docs");

  await page.getByRole("button", { name: "Configure Box and layout" }).click();
  const accountDialog = page.locator("[data-website-account-dialog]");
  await expect(accountDialog).toBeVisible();
  await expect(accountDialog).toHaveAccessibleName("Website account sign-in");
  await expect(accountDialog.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(accountDialog.getByRole("button", { name: "Show password" })).toBeVisible();
});
