import { test, expect, type Page } from "@playwright/test";

test.beforeEach(async ({ context, baseURL }) => {
  test.skip(!process.env.ADMIN_UI_PREVIEW, "Local preview checks require the explicit preview command.");
  await context.addCookies([{ name: "riic-locale", value: "zh", domain: new URL(baseURL!).hostname, path: "/" }]);
});

test("preview reuses all six pages and keeps requests inside the sample transport", async ({ page }) => {
  const apiRequests: string[] = [];
  const errors: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/admin/")) apiRequests.push(request.url()); });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/admin-preview");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("运行概览");
  await expect(page.locator("[data-admin-solver-metrics]")).toContainText("1.25");
  const navigation = page.getByRole("navigation", { name: "后台导航", exact: true });
  for (const [title, path] of [["用户管理", "users"], ["问题反馈", "issues"], ["复现测试", "quality"], ["技能注释", "skills"], ["更新日志", "changelog"]]) {
    await navigation.getByRole("link", { name: title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp("/admin-preview/" + path + "$"));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("#admin-content").getByRole("alert")).toHaveCount(0);
  }
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("users filter, paginate, search, and preserve role confirmation", async ({ page }) => {
  await page.goto("/admin-preview/users");
  const table = page.getByRole("table", { name: "用户管理", exact: true });
  await expect(table.getByRole("row")).toHaveCount(11);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(table.getByRole("row")).toHaveCount(8);
  await page.getByRole("combobox", { name: "角色", exact: true }).selectOption("reviewer");
  await expect(table.getByRole("row")).toHaveCount(3);
  await page.getByRole("combobox", { name: "角色", exact: true }).selectOption("all");
  await page.getByRole("combobox", { name: "状态", exact: true }).selectOption("suspended");
  await expect(table.getByRole("row")).toHaveCount(2);
  await page.getByRole("combobox", { name: "状态", exact: true }).selectOption("all");
  await page.getByRole("search").getByRole("textbox").fill("Kestrel");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table).toContainText("Kestrel");
  await page.getByRole("button", { name: "管理账户", exact: true }).click();
  await page.getByRole("button", { name: "设为审阅人", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Kestrel");
  await page.getByRole("dialog").getByRole("button", { name: "确认设为审阅人", exact: true }).click();
  await expect(page.getByRole("button", { name: "撤销审阅人", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看 Session", exact: true }).click();
  await expect(page.locator("#users")).toContainText("Preview browser");
});

test("reviewer navigation, command search, and real route protection", async ({ page }) => {
  await page.goto("/admin-preview");
  await page.getByRole("combobox", { name: "预览角色" }).selectOption("reviewer");
  const nav = page.getByRole("navigation", { name: "后台导航", exact: true });
  await expect(nav.getByRole("link")).toHaveCount(3);
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("反馈");
  await dialog.getByRole("link", { name: /问题反馈/ }).click();
  await expect(page).toHaveURL(/\/admin-preview\/issues$/);
  await page.goto("/admin");
  await expect(page.locator("[data-sidebar=trigger]")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "后台导航", exact: true })).toHaveCount(0);
});

test("mobile navigation and tables do not overflow the page", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/admin-preview/users");
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("button", { name: "展开或收起后台导航" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("link", { name: "问题反馈", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  for (const [locale, label] of [["en", "English"], ["zh-TW", "繁體中文（台灣）"], ["zh-CN", "简体中文"]]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
});

test("English navigation and page copy resolve", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "riic-locale", value: "en", domain: new URL(baseURL!).hostname, path: "/" }]);
  await page.goto("/admin-preview/users");
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Administration navigation" }).getByRole("link")).toHaveCount(6);
  await expect(page.getByRole("table")).toContainText("Kestrel");
  await expect(page.getByText("AdminWorkspace.", { exact: false })).toHaveCount(0);
});

for (const width of [1440, 375]) {
  test(`admin pages scroll to their footer at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 650 });
    await page.goto("/admin-preview/users");
    await expect(page.getByRole("table")).toBeVisible();
    const footer = page.locator('[data-slot="sidebar-wrapper"] footer');
    expect((await footer.boundingBox())!.y).toBeGreaterThan(650);
    await page.mouse.move(width - 80, 450);
    await page.mouse.wheel(0, 1500);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    await expect(footer).toBeInViewport();
  });
}

// Exercise the real console with an in-memory transport. The local preview does
// not expose billing routes, and these display checks need no database accounts.
async function mountBillingConsole(page: Page, agent = false) {
  await page.goto("/admin-preview");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.evaluate(async agent => {
    const importClient = (path: string) => import(path);
    // Use the same optimized modules as the component so React contexts share
    // their identity; /@id aliases can resolve to separate development modules.
    const source = await (await fetch("/src/app/admin/billing/billing-console.tsx")).text();
    const dependency = (name: string) => {
      const url = source.match(new RegExp(`from "([^"]*/deps/${name}\\.js\\?[^"]+)"`))?.[1];
      if (!url) throw new Error(`Missing Vite dependency: ${name}`);
      return url;
    };
    const reactUrl = dependency("react");
    const dependencyDirectory = reactUrl.slice(0, reactUrl.lastIndexOf("/"));
    const [{ default: React }, { default: ReactDOM }, { IntlProvider }, { BillingConsole }, { AdminDataProvider }, { loadMessages }, routerApi] = await Promise.all([
      importClient(reactUrl), importClient(`${dependencyDirectory}/react-dom_client.js`), importClient(dependency("use-intl")),
      importClient("/src/app/admin/billing/billing-console.tsx"), importClient("/src/app/admin/admin-context.tsx"),
      importClient("/src/i18n/messages.ts"), importClient("/@id/@tanstack/react-router"),
    ]);
    const messages = await loadMessages("zh-CN", ["AdminBillingLabels", "Admin_billing_console", "Admin_policy_editor", "Common"]);
    const created_at = "2026-11-20T03:04:05.000Z";
    const user = { user_id: "billing-user-stable-id", email: "billing.member.with.a.long.address.for.table.layout@example.test" };
    const rows: Record<string, Record<string, unknown>[]> = {
      usage: [{ ...user, id: "usage-id", run_id: "request-id", created_at, status: "completed", settlement: "needs_review", points: 1 }],
      wallets: [{ ...user, name: "Billing member", paid_points: 20, monthly_points: 0 }],
      ledger: [{ ...user, id: "ledger-debit-id", created_at, kind: "agent_settlement", points_delta: -1, reference_id: "request-id" }],
      orders: [{ ...user, id: "order-id", created_at, product_id: "points_5", status: "paid", amount_fen: 500, points: 50 }],
      reviews: [
        { ...user, id: "review-open-id", run_id: "request-id", created_at, kind: "settlement", status: "open", resolution: null },
        { ...user, id: "review-resolved-id", run_id: "request-resolved-id", created_at, kind: "missing", status: "resolved", resolution: JSON.stringify({ resolution: "adjusted", reason: "已核对补偿依据", ledgerId: "adjustment-ledger-id" }) },
        { id: "review-unlinked-id", run_id: null, email: null, created_at, kind: "afdian_payment", status: "open", resolution: null },
      ],
      audit: [{ id: "audit-id", created_at, actor_id: "admin-stable-id", actor_email: "admin@example.test", action: "credit", target: user.user_id, reason: "核对" }],
      filters: [{ ...user, id: "filter-id", created_at, stage: "input", version: "filter:1", rule_ids: [] }],
    };
    const requests: { section: string; method: string; query: string; body: Record<string, unknown> | null }[] = [];
    Object.assign(window, { billingDisplayRequests: requests });
    const request = async (input: string, init?: RequestInit) => {
      const params = new URL(input, location.origin).searchParams;
      const section = params.get("section") ?? "summary";
      const method = init?.method ?? "GET";
      const query = params.get("q") ?? "";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({ section, method, query, body });
      const selected = (rows[section] ?? []).filter(row => !query || String(row.email).includes(query));
      const data = method === "POST" ? { ledgerId: "new-adjustment-id" }
        : section === "summary" ? { series: [] }
        : section === "policies" ? { gateway: [], versions: [{ id: "filter:1", kind: "filter", status: "active", created_at, payload: { rules: [], allow: [] } }] }
        : section === "run" ? { run: { ...user, id: "request-id" } }
        : { rows: selected, total: selected.length, page: 1, pages: 1 };
      return new Response(JSON.stringify({ success: true, data }), { headers: { "Content-Type": "application/json" } });
    };
    for (const child of Array.from(document.body.children)) if (child instanceof HTMLElement) child.hidden = true;
    const host = document.createElement("main");
    host.id = "billing-console-fixture";
    host.className = "min-w-0 max-w-full p-4";
    document.body.append(host);
    const root = routerApi.createRootRoute({ component: () => React.createElement(IntlProvider, { locale: "zh-CN", messages, timeZone: "Asia/Shanghai" },
      React.createElement(AdminDataProvider, { request, basePath: "/admin" }, React.createElement(BillingConsole, { agent }))) });
    const router = routerApi.createRouter({ routeTree: root, history: routerApi.createMemoryHistory({ initialEntries: ["/"] }) });
    ReactDOM.createRoot(host).render(React.createElement(routerApi.RouterProvider, { router }));
  }, agent);
  await expect(page.getByRole("navigation", { name: "计费管理", exact: true })).toBeVisible();
}

test("billing tables show email and reconciliation columns while actions retain stable IDs", async ({ page }) => {
  await mountBillingConsole(page);
  const table = page.getByRole("table");
  const email = "billing.member.with.a.long.address.for.table.layout@example.test";
  for (const section of ["调用记录", "积分流水", "支付订单"]) {
    await page.getByRole("button", { name: section, exact: true }).click();
    await expect(table.getByRole("columnheader", { name: "用户邮箱", exact: true })).toBeVisible();
    await expect(table).toContainText(email);
    await expect(table).not.toContainText("billing-user-stable-id");
  }
  await page.getByRole("button", { name: "积分流水", exact: true }).click();
  await table.getByRole("button", { name: "详情", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("billing-user-stable-id");
  await page.keyboard.press("Escape");
  await table.getByRole("button", { name: "退还", exact: true }).click();
  await page.getByLabel("积分数", { exact: true }).fill("1");
  await page.getByLabel("操作原因", { exact: true }).fill("显示邮箱后仍使用稳定用户ID");
  await page.getByRole("button", { name: "确认调账", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const writes = await page.evaluate(() => (window as unknown as { billingDisplayRequests: { section: string; method: string; body: unknown }[] }).billingDisplayRequests.filter(row => row.method === "POST"));
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ section: "adjust", body: { userId: "billing-user-stable-id", referenceId: "ledger-debit-id", action: "refund" } });

  await page.getByRole("button", { name: "对账", exact: true }).click();
  await expect(table.getByRole("columnheader")).toHaveText(["时间", "请求 ID", "用户邮箱", "类型", "状态", "处理结果", "操作"]);
  await expect(table).toContainText("结算待核对（settlement）");
  await expect(table).toContainText("模型用量缺失（missing）");
  await expect(table).toContainText("待处理（open）");
  await expect(table).toContainText("已处理（resolved）");
  const resolved = table.getByRole("row").filter({ hasText: "request-resolved-id" });
  await expect(resolved).toContainText("已调账（adjusted）");
  await expect(resolved).toContainText("已核对补偿依据");
  await expect(resolved).toContainText("adjustment-ledger-id");
  await expect(resolved.getByRole("button", { name: "处理", exact: true })).toHaveCount(0);
  await expect(table.getByRole("row")).toHaveCount(4);
  await expect(table.getByRole("button", { name: "处理", exact: true })).toHaveCount(2);
  await page.screenshot({ path: test.info().outputPath("billing-admin-desktop.png"), fullPage: true });
  await page.getByLabel("用户 / 关联 ID / 邮箱", { exact: true }).fill(email);
  await page.getByRole("button", { name: "查询 / 刷新", exact: true }).click();
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect.poll(() => page.evaluate(() => (window as unknown as { billingDisplayRequests: { query: string }[] }).billingDisplayRequests.at(-1)?.query)).toBe(email);
  await page.getByRole("button", { name: "操作审计", exact: true }).click();
  await page.getByLabel("用户 / 关联 ID / 邮箱", { exact: true }).fill("");
  await page.getByRole("button", { name: "查询 / 刷新", exact: true }).click();
  await expect(table).toContainText("admin@example.test");
});

test("billing email cells stay inside scrollable tables at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBillingConsole(page);
  await page.getByRole("button", { name: "对账", exact: true }).click();
  const table = page.getByRole("table");
  await expect(table).toContainText("billing.member.with.a.long.address.for.table.layout@example.test");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await table.evaluate(element => element.parentElement!.scrollWidth > element.parentElement!.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("billing-admin-mobile.png"), fullPage: true });
  await mountBillingConsole(page, true);
  await page.getByRole("button", { name: "过滤记录", exact: true }).click();
  await expect(page.getByRole("table")).toContainText("billing.member.with.a.long.address.for.table.layout@example.test");
  await expect(page.getByRole("table").getByRole("columnheader", { name: "用户邮箱", exact: true })).toBeVisible();
});
