import assert from "node:assert/strict";
import { createServer } from "node:http";
import process from "node:process";
import { URL } from "node:url";
import { chromium, expect } from "@playwright/test";

const apps = [
  { name: "arknights", origin: process.env.ARKNIGHTS_E2E_ORIGIN || "http://127.0.0.1:5194", path: "/account-health", localeCookie: "riic-locale" },
  { name: "endfield", origin: process.env.ENDFIELD_E2E_ORIGIN || "http://127.0.0.1:5196", path: "/skills", localeCookie: "riic-endfield-locale" },
];
for (const app of apps) assert.ok(["127.0.0.1", "localhost"].includes(new URL(app.origin).hostname), "Use isolated local servers only");
// Start Endfield with PLATFORM_API_ORIGIN=http://127.0.0.1:5197.
// Exercise its real access gate against a local account fixture.
const accountFixture = createServer((request, response) => {
  const allowed = request.url === "/api/platform/endfield-access" && request.headers.cookie?.includes("better-auth.session_token=sidebar-e2e");
  response.writeHead(allowed ? 204 : 200, { "Content-Type": "application/json" });
  response.end(allowed ? undefined : "null");
});
await new Promise((resolve, reject) => { accountFixture.once("error", reject); accountFixture.listen(5197, "127.0.0.1", resolve); });
const browser = await chromium.launch({ headless: true });
const failures = [];
try {
  for (const app of apps) {
    for (const locale of ["zh", "en"]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
      try {
        await context.addCookies([
          { name: app.localeCookie, value: locale, url: app.origin },
          { name: "sidebar_state", value: "true", url: app.origin },
          { name: "better-auth.session_token", value: "sidebar-e2e", url: app.origin },
        ]);
        // Isolated browser fixtures; never use a real account or change server data.
        await context.route("**/api/auth/get-session**", route => route.fulfill({ json: locale === "zh" ? null : {
          user: { id: "sidebar-alignment", name: "Sidebar alignment", email: "sidebar@example.test" },
          session: { expiresAt: "2099-01-01T00:00:00Z" },
        } }));
        await context.route("**/api/account/feature-access", route => route.fulfill({ json: { agent: true, billing: false } }));
        await context.route("**/api/releases*", route => route.fulfill({ json: { success: true, data: { environment: "local", releases: [] } } }));
        await context.addInitScript(() => globalThis.localStorage.setItem("arknights-infra-calc-beta-onboarding-v1", "1"));
        const page = await context.newPage();
        page.setDefaultTimeout(30000);
        await page.goto(`${app.origin}${app.path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.locator(app.name === "arknights" ? '[data-workbench-hydrated="true"]' : 'body[data-app-hydrated="true"]').waitFor();
        const sidebar = page.locator('[data-slot="sidebar"]');
        await expect(sidebar).toHaveAttribute("data-state", "expanded");
        const toggle = sidebar.locator('[data-slot="sidebar-trigger"]');
        const navigation = sidebar.locator('[data-slot="sidebar-menu-button"]');
        assert.ok(await navigation.count() >= 4, `${app.name} navigation is populated`);
        await expect(navigation.first().locator("span")).toBeVisible();
        await toggle.click();
        await expect(sidebar).toHaveAttribute("data-state", "collapsed");
        await expect(sidebar.locator('[data-sidebar-account-footer]')).toHaveAttribute("data-compact", "true");
        for (const width of [1440, 1024]) {
          await page.setViewportSize({ width, height: 900 });
          const geometry = await sidebar.evaluate(root => {
            const inner = root.querySelector('[data-slot="sidebar-inner"]').getBoundingClientRect();
            const center = inner.x + inner.width / 2;
            const selectors = [
              '[data-slot="sidebar-trigger"] > svg',
              '[data-game-switcher] > svg:first-child',
              '[data-slot="sidebar-menu-button"] > svg:first-child',
              '[data-sidebar-account-trigger] > :first-child',
              '[data-sidebar-account-footer] a > svg',
            ];
            const icons = [...root.querySelectorAll(selectors.join(","))].map(icon => {
              const box = icon.getBoundingClientRect();
              return { name: icon.parentElement.getAttribute("aria-label") || icon.parentElement.textContent.trim(), center: box.x + box.width / 2, width: box.width, height: box.height };
            });
            return { center, icons };
          });
          assert.ok(geometry.icons.length >= 9, `${app.name}: header, navigation and footer icons are measured`);
          const offCenter = geometry.icons.filter(icon => Math.abs(icon.center - geometry.center) > 0.51);
          assert.equal(offCenter.length, 0, `${app.name}/${locale}/${width}: expected center ${geometry.center}, got ${JSON.stringify(offCenter)}`);
          assert.ok(geometry.icons.every(icon => icon.width > 0 && Math.abs(icon.width - icon.height) < 0.1), "Icons retain square bounds");
        }
        await toggle.click();
        await expect(sidebar).toHaveAttribute("data-state", "expanded");
        await expect(navigation.first().locator("span")).toBeVisible();
        await page.setViewportSize({ width: 375, height: 812 });
        await page.locator('[data-slot="sidebar-trigger"]:visible').click();
        const drawer = page.locator('[data-slot="sidebar"][data-mobile="true"]');
        await expect(drawer).toBeVisible();
        await expect(drawer.locator('[data-slot="sidebar-menu-button"]').first().locator("span")).toBeVisible();
        await expect(drawer.locator('[data-sidebar-account-footer]')).not.toHaveAttribute("data-compact", "true");
        await page.keyboard.press("Escape");
        await expect(drawer).not.toBeVisible();
        process.stdout.write(`PASS ${app.name}/${locale}: collapsed centers at 1440/1024px, expanded labels, 375px drawer\n`);
      } catch (error) {
        failures.push(`${app.name}/${locale}: ${error.message}`);
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  await new Promise(resolve => accountFixture.close(resolve));
}
assert.equal(failures.length, 0, failures.join("\n"));
