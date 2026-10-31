import { expect, test } from "@playwright/test";

test("English mode keeps the calculator and account entry copy in English", async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "null",
  }));
  await page.addInitScript(() => window.localStorage.setItem("infra-demo-locale", "en"));
  await page.goto("/");

  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const onboarding = page.getByRole("dialog", { name: "Getting started", exact: true });
  await expect(onboarding).toBeVisible();
  await expect(onboarding.locator("[data-onboarding-task]")).toHaveCount(9);
  await expect(onboarding.getByRole("heading", { name: "Want to preview scheduling without signing in?" })).toBeVisible();
  await expect(onboarding.getByRole("button", { name: "View sample schedule" })).toBeVisible();
  await onboarding.getByRole("button", { name: "Continue later", exact: true }).click();
  await expect(onboarding).toHaveCount(0);
  await expect(page.locator("[data-calculator-controls]")).toBeVisible();
  await expect(page.locator("[data-docs-link]").first()).toHaveAccessibleName("Docs");
  await expect(page.locator("[data-docs-link]").first()).toHaveAttribute("href", "/docs");

  await page.getByRole("button", { name: "Configure BOX and base", exact: true }).click();
  const accountDialog = page.locator("[data-website-account-dialog]");
  await expect(accountDialog).toBeVisible();
  await expect(accountDialog).toHaveAccessibleName("Sign in");
  await expect(accountDialog.locator("[data-website-account-panel]").getByRole("heading", { name: "Sign in", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(accountDialog.getByRole("button", { name: "Show password" })).toBeVisible();
});
