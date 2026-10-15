import { expect, test } from "@playwright/test";
import { mockAnonymousWebsiteSession, mockApis } from "./production-readiness.fixture";

test("pending orders expire and can be removed while paid history remains", async ({ page }) => {
  await mockAnonymousWebsiteSession(page);
  await mockApis(page);
  const now = Date.now();
  const order = (id: string, status: string, age: number) => ({ id, status, productId: "points_10", amountFen: 1000, points: 110, paymentUrl: null, paidAt: null, createdAt: new Date(now - age).toISOString() });
  let orders = [order("recent", "pending", 0), order("expired", "pending", 4 * 86400000), order("paid", "paid", 5 * 86400000)];
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
    if (route.request().method() === "DELETE") {
      orders = orders.filter(order => order.id !== "recent");
      return route.fulfill({ json: { data: { deleted: true } } });
    }
    return route.fulfill({ json: { data: { order: { status: "pending" } } } });
  });
  await page.goto("/billing");
  const section = page.locator("[data-billing-orders]");
  await expect(section.locator("li")).toHaveCount(2);
  await expect(section.getByRole("button", { name: "删除待支付订单 expired" })).toHaveCount(0);
  await expect(section.getByRole("button", { name: "删除待支付订单 paid" })).toHaveCount(0);
  await section.getByRole("button", { name: "删除待支付订单 recent", exact: true }).click();
  await expect(section.locator("li")).toHaveCount(2);
  const confirmDelete = section.getByRole("button", { name: "确认删除待支付订单 recent", exact: true });
  await expect(confirmDelete).toHaveText("确认删除");
  await page.getByRole("heading", { name: "最近订单", exact: true }).hover();
  await expect(section.getByRole("button", { name: "删除待支付订单 recent", exact: true })).toHaveText("删除");
  await section.getByRole("button", { name: "删除待支付订单 recent", exact: true }).click();
  await section.getByRole("button", { name: "确认删除待支付订单 recent", exact: true }).click();
  await expect(section.locator("li")).toHaveCount(1);
  await expect(section).toContainText("已付款 · 已到账");
  await page.reload();
  await expect(section.locator("li")).toHaveCount(1);
  orders.push(order("another", "pending", 0), order("third", "pending", 0));
  await page.reload();
  await expect(section.locator("li")).toHaveCount(3);
  await section.getByRole("button", { name: "一键清空未支付订单", exact: true }).click();
  await expect(section.locator("li")).toHaveCount(3);
  await page.getByRole("heading", { name: "最近订单", exact: true }).hover();
  await expect(section.getByRole("button", { name: "一键清空未支付订单", exact: true })).toBeVisible();
  await section.getByRole("button", { name: "一键清空未支付订单", exact: true }).click();
  await section.getByRole("button", { name: "确认清空所有未支付订单", exact: true }).click();
  await expect(section.locator("li")).toHaveCount(1);
  await expect(section).toContainText("已付款 · 已到账");
  await expect(section.getByRole("button", { name: "一键清空未支付订单", exact: true })).toBeDisabled();
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test(`payment plans navigate within the workbench at ${viewport.width}px`, async ({ page }) => {
    await mockAnonymousWebsiteSession(page);
    await mockApis(page);
    await page.route("**/api/billing", async (route) => {
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
    if (viewport.width < 768) await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    const accountItem = page.getByRole("button", { name: "账号管理", exact: true }).locator("..");
    await expect(accountItem.locator("xpath=following-sibling::li[1]")).toContainText("付费计划");
    const navigation = page.getByRole("button", { name: "付费计划", exact: true });
    await navigation.click();
    await expect(page).toHaveURL(/\/billing$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "付费计划", exact: true })).toBeVisible();
    await expect(page.locator("[data-billing-prototype]")).toBeVisible();
    await expect(page.getByRole("heading", { name: "10 元积分包" })).toBeVisible();
    if (viewport.width >= 768) await expect(navigation).toHaveAttribute("aria-current", "page");
    await page.getByRole("heading", { name: "积分账本", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("heading", { name: "积分账本", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.reload();
    await expect(page.locator("[data-billing-prototype]")).toBeVisible();
    await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
    await page.goBack();
    await expect(page.locator("[data-account-health-page]")).toBeVisible();
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
  await expect(page.getByRole("link", { name: "前往账号管理登录" })).toHaveAttribute("href", "/account");
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
    const buttonsArePills = await root.locator('[data-slot="button"]:not([data-setup-action])').evaluateAll((buttons) => buttons.every((button) => parseFloat(getComputedStyle(button).borderTopLeftRadius) >= button.getBoundingClientRect().height / 2));
    expect(buttonsArePills).toBe(true);
    const code = page.getByRole("textbox", { name: "积分兑换码" });
    await code.fill("RIIC-TEST");
    await code.press("Enter");
    await expect(root.getByRole("alert")).toContainText("测试兑换码不可用");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
