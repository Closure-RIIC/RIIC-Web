import { expect, test } from "@playwright/test";
import { sidebarNavigation } from "./production-readiness.fixture";
import { installMockSessionRefresh } from "./mock-session-refresh";

test("admin beta denies direct pages and APIs without exposing either navigation entry", async ({ page, request }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => localStorage.setItem("arknights-infra-calc-beta-onboarding-v1", "1"));
  // A forged browser session/role must not grant a server-side capability.
  await installMockSessionRefresh(page);
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: {
    user: { id: "ordinary-user", name: "Member", email: "member@example.test", role: "admin" },
    session: { expiresAt: "2099-01-01T00:00:00Z" },
  } }));
  await page.goto("/");
  await expect(page.locator("[data-sidebar-account-name]")).toHaveText("Member");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible({ timeout: 30_000 });
  await page.locator("[data-sidebar-account-trigger]").click();
  await expect(page.locator('[data-primary-navigation-page="agent"], [data-primary-navigation-page="billing"], [data-agent-history], [data-agent-floating-widget]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  for (const path of ["/agent", "/billing", "/plan/test-artifact"]) {
    await page.goto(path);
    await expect(page.locator('[data-agent-chat], [data-billing-prototype], [data-plan-artifact-page]')).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  }
  for (const path of ["/api/agent/chat", "/api/agent/plan/test", "/api/billing", "/api/billing/orders/test"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(401);
    expect((await response.json()).error.code).toBe("AIC-AUTH-2008");
  }
  for (const path of ["/api/agent/chat", "/api/billing", "/api/billing/cdk"]) {
    const response = await request.post(path, { headers: { origin: new URL(page.url()).origin }, data: {} });
    expect(response.status(), path).toBe(401);
  }
});

test("production profile exposes explicitly enabled Skland while preserving security defaults", async ({ page, request }) => {
  test.setTimeout(60_000);
  const sklandRequests: string[] = [];
  page.on("request", (browserRequest) => {
    if (new URL(browserRequest.url()).pathname.startsWith("/api/skland/")) {
      sklandRequests.push(browserRequest.url());
    }
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("arknights-infra-calc-beta-onboarding-v1", "1");
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: "基建计算器", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "森空岛同步", exact: true })).toBeVisible();
  await expect(page.getByText("调试工具", { exact: false })).toHaveCount(0);
  await page.locator("[data-sidebar-account-trigger]").click();
  await expect(page.locator('[data-primary-navigation-page="agent"], [data-primary-navigation-page="billing"], [data-agent-history]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByText("智能助理", { exact: true })).toHaveCount(0);
  expect(sklandRequests).toEqual([]);

  await (await sidebarNavigation(page, "账号管理")).click();
  await expect(page.locator("[data-account-management]")).toHaveCount(0);
  const accountDialog = page.getByRole("dialog", { name: "登录网站账号" });
  await expect(accountDialog).toBeVisible();
  await expect(accountDialog.locator("[data-website-account-panel]")).toBeVisible();
  await accountDialog.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "基建计算器", exact: true }).click();

  await page.getByRole("button", { name: "配置Box与布局" }).first().click();
  const setupGate = page.getByRole("dialog", { name: "登录网站账号" });
  await expect(setupGate).toBeVisible();
  await expect(setupGate.getByText("继续使用受账号保护的数据导入与排班功能。", { exact: true })).toBeVisible();
  await expect(page.getByText("上传练度 JSON / XLSX", { exact: true })).toHaveCount(0);

  await page.goto("/manual");
  await expect(page.locator("[data-manual-schedule-empty]")).toBeVisible();
  await expect(page.locator("[data-manual-schedule-unavailable]")).toHaveCount(0);
  await page.getByRole("button", { name: "配置 Box 与布局", exact: true }).click();
  // A fresh manual workspace uses the public sample flow. Personal Box access
  // still uses the account guard covered by the manual-scheduling suite.
  await expect(page.getByRole("dialog", { name: "排班设置", exact: true })).toBeVisible();

  const sklandPageResponse = await request.get("/skland");
  expect(sklandPageResponse.status()).toBe(200);
  expect(await sklandPageResponse.text()).toContain("森空岛");

  const healthResponse = await request.get("/api/health");
  expect([200, 503]).toContain(healthResponse.status());
  const health = await healthResponse.json();
  expect(health.success).toBe(true);
  expect(health.data).toHaveProperty("skland");
  expect(health.data.features).toMatchObject({ debugTools: false, rateLimit: true });

  for (const path of ["/api/skland/session", "/api/skland/accounts"]) {
    const sessionResponse = await request.get(path);
    expect(sessionResponse.status(), path).toBe(401);
    expect(await sessionResponse.json()).toMatchObject({
      success: false,
      error: { code: "AIC-AUTH-2008", retryable: false },
    });
  }

  await page.goto("/terms");
  await expect(page.getByText("森空岛", { exact: false }).first()).toBeVisible();
  await page.goto("/privacy");
  await expect(page.getByText("森空岛", { exact: false }).first()).toBeVisible();
});
