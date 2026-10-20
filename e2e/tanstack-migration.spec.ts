import { verifyPublicCompression } from "../scripts/verify-public-compression.mjs";
import { switchWorkbenchLanguage } from "./workbench-language";
import { readdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("public routes retain SSR metadata, icons, private caching, and real 404 responses", async ({ request }) => {
  for (const pathname of ["/", "/manual", "/training", "/mastery", "/recruitment", "/skills", "/account", "/about", "/changelog", "/help", "/help/import-operators", "/help/owned-operators", "/privacy", "/terms", "/account/reset-password", "/settings", "/account-health", "/mower", "/inventory", "/gacha", "/skland", "/skland/infrastructure", "/help/beginner", "/wishes", "/wishes2", "/plush"]) {
    const response = await request.get(pathname);
    expect(response.status(), pathname).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    const html = await response.text();
    expect(html).toMatch(/<title>[^<]+<\/title>/);
    expect(html).toContain('name="riic-build-id"');
  }
  for (const pathname of ["/not-a-route", "/admin", "/admin/users", "/admin/issues", "/admin/quality", "/admin/wishes", "/admin/billing", "/admin/agent", "/agent", "/billing", "/plan/missing", "/admin-preview", "/api/auth/admin/list-users"]) {
    expect((await request.get(pathname)).status(), pathname).toBe(404);
  }
  for (const pathname of ["/icon.png", "/apple-icon.png", "/favicon.ico"]) {
    expect((await request.get(pathname)).ok(), pathname).toBe(true);
  }
});

test("production HTML uses request locale and negotiated compression", async ({ request }) => {
  const response = await request.get("/privacy", { headers: { cookie: "riic-locale=en", "accept-encoding": "gzip" } });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-encoding"]).toBe("gzip");
  expect(await response.text()).toContain('lang="en"');
  expect(await response.text()).toMatch(/<title>Privacy/);
  const identity = await request.get("/", { headers: { "accept-encoding": "identity" } });
  expect(identity.headers()["content-encoding"]).toBeUndefined();
});

test("hydration, language changes, persistent workbench navigation and browser history work", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("[data-primary-navigation-page=calculator]")).toBeVisible();
  await switchWorkbenchLanguage(page, "en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle(/Closure/);
  await page.locator("[data-primary-navigation-page=training]").click();
  await expect(page).toHaveURL(/\/training$/);
  await page.locator("[data-primary-navigation-page=calculator]").click();
  await expect(page).toHaveURL(/\/$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/training$/);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(errors).toEqual([]);
});

test("public help links preserve search state and mobile legal pages hydrate", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/help");
  await expect(page).toHaveURL(/\/docs$/);
  await page.locator('[data-docs-home] a[href="/docs/faq-box"]').click();
  await expect(page).toHaveURL(/\/docs\/faq-box$/);
  await page.goto("/help/owned-operators?issue=unexpected-operators");
  await expect(page).toHaveURL(/\/docs\/faq-box$/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/terms");
  await expect(page.locator("h1")).toBeVisible();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("h1")).toContainText("Terms");
  expect(errors).toEqual([]);
});

test("production assets retain compression and version-aware cache headers", async ({ request }) => {
  const verification = await verifyPublicCompression("http://127.0.0.1:5195/api/health");
  expect(["br", "gzip"]).toContain(verification.scriptEncoding);
  const asset = await request.get(verification.scriptUrl);
  expect(asset.headers()["cache-control"]).toContain("immutable");
  const portrait = (await readdir("public/images/operator-portraits")).find(name => name.endsWith(".webp"));
  expect(portrait).toBeTruthy();
  const pathname = "/images/operator-portraits/" + encodeURIComponent(portrait!);
  const unversioned = await request.get(pathname);
  expect(unversioned.status()).toBe(200);
  expect(unversioned.headers()["cache-control"] ?? "").not.toContain("immutable");
  const versioned = await request.get(pathname + "?v=1-abcdef012345");
  expect(versioned.status()).toBe(200);
  expect(versioned.headers()["cache-control"]).toContain("immutable");
});
