import { expect, test } from "@playwright/test";
import { mockAnonymousWebsiteSession, mockApis, sidebarNavigation } from "./production-readiness.fixture";

test("pending orders expire and can be removed while paid history remains", async ({ page }) => {
  await mockAnonymousWebsiteSession(page);
  await mockApis(page);
  const now = Date.now();
  const order = (id: string, status: string, age: number) => ({ id, status, productId: "points_10", amountFen: 1000, points: 110, paymentUrl: null, paidAt: null, createdAt: new Date(now - age).toISOString() });
  let orders = [order("recent", "pending", 0), order("another", "pending", 0), order("expired", "pending", 4 * 86400000), order("paid", "paid", 5 * 86400000)];
  await page.route("**/api/billing", route => {
    if (route.request().method() === "DELETE") {
      const deleted = orders.filter(order => order.status === "pending").length;
      orders = orders.filter(order => order.status !== "pending");
      return route.fulfill({ json: { data: { deleted } } });
    }
    return route.fulfill({ json: { data: {
    wallet: { totalPoints: 110, paidPoints: 110, monthlyPoints: 0, monthlyExpiresAt: null },
    products: [], ledger: [], usage: [], orders,
  } } });
  });
  await page.route("**/api/billing/orders/recent", route => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { data: { order: { status: "pending" } } } });
  });
  await page.goto("/billing");
  const section = page.locator("[data-billing-orders]");
  const heading = section.getByRole("heading", { name: "最近订单", exact: true });
  const clearButton = heading.locator("..").getByRole("button", { name: "一键清空未支付订单", exact: true });
  await expect(clearButton).toBeVisible();
  await expect(clearButton).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(section.locator("li")).toHaveCount(3);
  await expect(section.locator("li").getByRole("button")).toHaveCount(0);
  await section.getByRole("button", { name: "一键清空未支付订单", exact: true }).click();
  await expect(section.locator("li")).toHaveCount(3);
  await page.getByRole("heading", { name: "最近订单", exact: true }).hover();
  await expect(section.getByRole("button", { name: "一键清空未支付订单", exact: true })).toBeVisible();
  await section.getByRole("button", { name: "一键清空未支付订单", exact: true }).click();
  await section.getByRole("button", { name: "确认清空所有未支付订单", exact: true }).click();
  await expect(section.locator("li")).toHaveCount(1);
  await expect(section).toContainText("已付款 · 已到账");
  await page.reload();
  await expect(section.locator("li")).toHaveCount(1);
  await expect(section.getByRole("button", { name: "一键清空未支付订单", exact: true })).toBeDisabled();
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test(`sidebar login preserves the page before navigating to payment plans at ${viewport.width}px`, async ({ page }) => {
    let authenticated = false;
    const user = { id: "billing-user", name: "测试用户", email: "billing@example.test", emailVerified: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await page.route("**/api/auth/get-session", route => route.fulfill({ json: authenticated ? {
      user, session: { id: "billing-session", userId: user.id, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
    } : null }));
    await page.route("**/api/auth/sign-in/email", route => {
      authenticated = true;
      return route.fulfill({ json: { redirect: false, token: "test-token", user } });
    });
    await mockApis(page);
    let billingRequests = 0;
    await page.route("**/api/billing", async (route) => {
      billingRequests += 1;
      expect(route.request().method()).toBe("GET");
      await route.fulfill({ json: { data: {
        wallet: { totalPoints: 110, paidPoints: 110, monthlyPoints: 0, monthlyExpiresAt: null },
        products: [{ id: "points_10", name: "10 元积分包", amountFen: 1000, points: 110, description: "110 积分", kind: "topup", checkoutConfigured: false }],
        ledger: [], orders: [], usage: [],
      } } });
    });
    await page.setViewportSize(viewport);
    await page.goto("/account-health");
    await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
    if (viewport.width < 768) await page.locator("[data-app-topbar]").getByRole("button", { name: /^(切换侧边栏|切換側邊欄|Toggle Sidebar)$/i }).click();
    const navigation = page.getByRole("menuitem", { name: "付费计划", exact: true });
    await (await sidebarNavigation(page, "账号管理")).click();
    await expect(page.locator("[data-sidebar-account-menu]")).toHaveCount(0);
    const loginDialog = page.getByRole("dialog", { name: "登录网站账号", exact: true });
    await expect(loginDialog).toBeVisible();
    await expect(page).toHaveURL(/\/account-health$/);
    await expect(page.locator("[data-billing-prototype]")).toHaveCount(0);
    expect(billingRequests).toBe(0);
    await page.keyboard.press("Escape");
    await expect(loginDialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/account-health$/);
    if (viewport.width < 768) await page.locator("[data-app-topbar]").getByRole("button", { name: /^(切换侧边栏|切換側邊欄|Toggle Sidebar)$/i }).click();
    await (await sidebarNavigation(page, "账号管理")).click();
    await loginDialog.getByRole("textbox", { name: "邮箱", exact: true }).fill(user.email);
    await loginDialog.getByLabel("密码", { exact: true }).fill("secure-password-1");
    await loginDialog.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/account-health$/);
    expect(billingRequests).toBe(0);
    if (viewport.width < 768) await page.locator("[data-app-topbar]").getByRole("button", { name: /^(切换侧边栏|切換側邊欄|Toggle Sidebar)$/i }).click();
    await (await sidebarNavigation(page, "付费计划")).click();
    await expect(page).toHaveURL(/\/billing$/);
    await expect(page.getByRole("heading", { name: "付费计划", exact: true })).toBeVisible();
    await expect(page.locator("[data-billing-prototype]")).toBeVisible();
    await expect(page.getByRole("heading", { name: "10 元积分包" })).toBeVisible();
    if (viewport.width >= 768) {
      await sidebarNavigation(page, "付费计划");
      await expect(navigation).toHaveAttribute("aria-current", "page");
      await page.keyboard.press("Escape");
    }
    await page.getByRole("heading", { name: "积分账本", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("heading", { name: "积分账本", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.reload();
    await expect(page.locator("[data-billing-prototype]")).toBeVisible();
    await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
    await page.goBack();
    await expect(page.locator("[data-account-health-page]")).toBeVisible();
    if (viewport.width < 768) await page.locator("[data-app-topbar]").getByRole("button", { name: /^(切换侧边栏|切換側邊欄|Toggle Sidebar)$/i }).click();
    await (await sidebarNavigation(page, "付费计划")).click();
    await expect(page).toHaveURL(/\/billing$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}

test("payment plans provide an account login entry when signed out", async ({ page }) => {
  await mockAnonymousWebsiteSession(page);
  await mockApis(page);
  await page.route("**/api/billing", (route) => route.fulfill({
    status: 401, json: { error: { message: "请先登录网站账号。" } },
  }));
  await page.goto("/billing");
  await expect(page.getByRole("heading", { name: "付费计划", exact: true })).toBeVisible();
  await expect(page.getByText("请先登录网站账号。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "登录网站账号", exact: true }).last().click();
  await expect(page.getByRole("dialog", { name: "登录网站账号", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/billing$/);
});

for (const width of [1440, 375]) {
  test(`billing records keep amounts clear and reveal usage details at ${width}px`, async ({ page }) => {
    await mockAnonymousWebsiteSession(page);
    await mockApis(page);
    const createdAt = "2026-10-02T00:00:00.000Z";
    await page.route("**/api/billing", (route) => route.fulfill({ json: { data: {
      wallet: { totalPoints: 1250, paidPoints: 1000, monthlyPoints: 250, monthlyExpiresAt: "2026-11-02T00:00:00.000Z" },
      products: [{ id: "points_1499", name: "常用积分包", amountFen: 1499, points: 165, description: "用于助理对话与基建求解", kind: "topup", checkoutConfigured: false, badge: "推荐" }],
      orders: [
        { id: "order-paid", productId: "points_1499", status: "paid", amountFen: 1499, points: 165, paymentUrl: null, createdAt, paidAt: createdAt },
        { id: "order-cancelled", productId: "points_1499", status: "cancelled", amountFen: 1499, points: 165, paymentUrl: null, createdAt, paidAt: null },
      ],
      usage: [{ id: "usage-1", toolName: "agent_chat", status: "completed_unsettled", points: 3, toolFeePoints: 1, tokenPoints: 2, inputTokens: 4200, outputTokens: 600, cachedInputTokens: 2000, upstreamCostRmb: 0.01, chargedCostRmb: 0.03, createdAt }],
      ledger: [{ id: "credit", kind: "topup", pointsDelta: 165, createdAt }, { id: "debit", kind: "token_settlement", pointsDelta: -2, createdAt }],
    } } }));
    await page.route("**/api/billing/cdk", async (route) => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual({ action: "redeem", code: "RIIC-TEST" });
      await route.fulfill({ status: 400, json: { error: { message: "测试兑换码不可用" } } });
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/billing");
    const root = page.locator("[data-billing-prototype]");
    await expect(root).toBeVisible();
    const orders = page.locator("[data-billing-orders]");
    await expect(orders.getByRole("listitem")).toHaveCount(2);
    await expect(orders.getByText("￥14.99", { exact: true })).toHaveCount(2);
    await expect(orders).not.toContainText("points_1499");
    await expect(orders).toContainText("已付款 · 已到账");
    await expect(orders).toContainText("已取消");
    const usage = page.locator("[data-billing-usage]");
    await expect(usage).toContainText("助理对话");
    await expect(usage.getByText("部分费用待结算", { exact: true })).toBeVisible();
    await expect(usage.getByText("结算状态", { exact: true })).not.toBeVisible();
    await usage.locator("summary").click();
    await expect(usage.getByText("结算状态", { exact: true })).toBeVisible();
    await expect(usage.getByText("工具扣费", { exact: true })).toBeVisible();
    await expect(usage.getByText("Token 扣费", { exact: true })).toBeVisible();
    await expect(usage.getByText(/^(输入 Token|输出 Token|缓存命中|计费金额|模型成本|4,200|￥0\.03)$/)).toHaveCount(0);
    await usage.locator("summary").press("Enter");
    await expect(usage.getByText("结算状态", { exact: true })).not.toBeVisible();
    const ledger = page.locator("[data-billing-ledger]");
    await expect(ledger).toContainText("充值到账");
    await expect(ledger).toContainText("+165");
    await expect(ledger).toContainText("对话用量结算");
    await expect(ledger).toContainText("−2");
    const disabledPurchase = page.getByRole("button", { name: "待配置支付链接" });
    await expect(disabledPurchase).toBeDisabled();
    await expect(disabledPurchase).toHaveCSS("opacity", "1");
    const returnAction = root.getByRole("button", { name: "返回助理" });
    await expect(returnAction).toHaveAttribute("data-setup-action", "");
    await expect(returnAction).toHaveAttribute("href", "/agent");
    await expect(returnAction).toHaveCSS("border-radius", "18px");
    const clearOrders = orders.getByRole("button", { name: "一键清空未支付订单", exact: true });
    await expect(clearOrders).toBeDisabled();
    await expect(clearOrders).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(clearOrders).toHaveCSS("border-width", "0px");
    const pillButtons = root.locator('[data-slot="button"]:not([data-setup-action])').filter({ hasNotText: /^一键清空未支付订单$/ });
    const buttonsArePills = await pillButtons.evaluateAll((buttons) => buttons.length > 0 && buttons.every((button) => parseFloat(getComputedStyle(button).borderTopLeftRadius) >= button.getBoundingClientRect().height / 2));
    expect(buttonsArePills).toBe(true);
    const code = page.getByRole("textbox", { name: "积分兑换码" });
    await code.fill("RIIC-TEST");
    await code.press("Enter");
    await expect(root.getByRole("alert")).toContainText("测试兑换码不可用");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
