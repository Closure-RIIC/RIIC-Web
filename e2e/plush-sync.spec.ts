import { expect, test } from "@playwright/test";
import { mockApis } from "./production-readiness.fixture";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("riic.plush.performance.v1", "quality"));
});

test("gallery appearances persist to Agent and sync between tabs with separate quality", async ({ page, context }) => {
  test.setTimeout(120_000);
  // Settings synchronization does not need a desktop-sized GPU framebuffer.
  // The gallery still renders at its fixed 64-shell quality; Agent stays desktop.
  await page.setViewportSize({ width: 400, height: 600 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/telemetry", route => route.fulfill({ json: { success: true } }));
  await page.goto("/plush?debug=1");
  await page.getByRole("toolbar").getByRole("button", { name: "银灰", exact: true }).click();
  await page.getByLabel("毛长", { exact: true }).fill("1.6");
  const gallery = page.locator('[data-fur-avatar="silverash"]');
  await expect(gallery).toHaveAttribute("data-fur-length", "1.6", { timeout: 30_000 });
  await expect(gallery).toHaveAttribute("data-fur-shells", "64");

  const agent = await context.newPage();
  await agent.setViewportSize({ width: 1280, height: 900 });
  await agent.emulateMedia({ reducedMotion: "reduce" });
  await mockApis(agent);
  await agent.route("**/api/account/data-consent", route => route.fulfill({ json: { success: true, data: { current: false, cloudSyncEnabled: false } } }));
  await agent.route("**/api/billing", route => route.fulfill({ json: { data: { wallet: { totalPoints: 100 } } } }));
  await agent.route("**/api/auth/get-session", route => route.fulfill({ json: {
    user: { id: "plush-user", name: "博士", email: "plush@example.test" },
    session: { expiresAt: "2099-01-01T00:00:00Z" },
  } }));
  await agent.route("**/api/agent/chat", route => route.fulfill({ json: {
    success: true, data: { enabled: true, personas: ["silverash", "exusiai", "saileach", "mountain"].map(id => ({ id })) },
  } }));
  await agent.goto("/agent");
  await agent.getByRole("button", { name: "人格卡：可露希尔", exact: true }).click();
  const portrait = agent.locator('[data-persona-card="silverash"] [data-fur-avatar="silverash"]');
  await expect(portrait).toHaveAttribute("data-fur-ready", "true", { timeout: 30_000 });
  await expect(portrait).toHaveAttribute("data-fur-length", "1.6");
  await expect(portrait).toHaveAttribute("data-fur-shells", "40");
  await expect(portrait).toHaveAttribute("data-fur-fps", "60");
  expect(Number(await portrait.getAttribute("data-fur-pixels"))).toBeLessThanOrEqual(256);
  // Let initial card shader compilation finish before testing a subsequent edit.
  await expect(agent.locator('[data-persona-card] [data-fur-ready="true"][data-fur-avatar]')).toHaveCount(5, { timeout: 30_000 });

  await page.bringToFront();
  await page.getByLabel("毛长", { exact: true }).fill("1.8");
  // Storage synchronization is independent of the background tab's GPU lifecycle.
  await expect.poll(() => agent.evaluate(() => JSON.parse(localStorage.getItem("riic.plush.lab.v2")!).personas.silverash.length)).toBe(1.8);
  await agent.bringToFront();
  await expect(portrait).toHaveAttribute("data-fur-length", "1.8", { timeout: 30_000 });
  await expect(portrait).toHaveAttribute("data-fur-shells", "40");
  await expect(gallery).toHaveAttribute("data-fur-shells", "64");
  await page.bringToFront();
  await page.reload();
  await page.getByRole("toolbar").getByRole("button", { name: "银灰", exact: true }).click();
  await expect(page.getByLabel("毛长", { exact: true })).toHaveValue("1.8");
  await expect(gallery).toHaveAttribute("data-fur-shells", "64", { timeout: 30_000 });
  await agent.close();
});
