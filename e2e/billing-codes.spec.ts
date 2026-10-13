import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { Pool } from "pg";

test("admin issues and revokes a batch while redemption updates wallet and preserves single use", async ({ page, context, browser, baseURL }) => {
  const databaseUrl = process.env.AUTH_INTEGRATION_DATABASE_URL;
  test.skip(!databaseUrl, "Requires an isolated authentication test database.");
  if (!new URL(databaseUrl!).pathname.endsWith("_test")) throw new Error("Only an isolated *_test database is allowed.");
  test.setTimeout(240_000);
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const users: string[] = [];
  const recipientContext = await browser.newContext({ baseURL });
  const reviewerContext = await browser.newContext({ baseURL });
  async function login(target: BrowserContext, role: string) {
    const id = `cdk-e2e-${randomUUID()}`;
    const password = "Cdk-Browser-Test-2026!";
    await pool.query('insert into public."user" (id,name,email,email_verified,role) values ($1,$2,$3,true,$4)', [id, "Code test", `${id}@example.test`, role]);
    users.push(id);
    await pool.query("insert into account (id,account_id,provider_id,user_id,password) values ($1,$2,'credential',$2,$3)", [randomUUID(), id, await hashPassword(password)]);
    const response = await target.request.post(`${baseURL}/api/auth/sign-in/email`, { headers: { origin: process.env.BETTER_AUTH_URL ?? baseURL! }, data: { email: `${id}@example.test`, password } });
    expect(response.status(), (await response.text()).slice(0, 500)).toBe(200);
    const cookies = response.headersArray().filter(header => header.name.toLowerCase() === "set-cookie").map(header => header.value.split(";", 1)[0]).filter(pair => pair.split("=", 1)[0].endsWith("session_token"));
    expect(cookies).toHaveLength(1);
    for (const pair of cookies) {
      const index = pair.indexOf("=");
      await target.addCookies([{ name: pair.slice(0, index), value: pair.slice(index + 1), domain: new URL(baseURL!).hostname, path: "/", httpOnly: true, secure: pair.startsWith("__Secure-"), sameSite: "Lax" }]);
    }
    return { id, headers: { cookie: cookies.join("; "), origin: baseURL! } };
  }
  try {
    await login(context, "admin");
    const recipient = await login(recipientContext, "user");
    const reviewer = await login(reviewerContext, "reviewer");
    await page.goto("/admin/billing");
    await expect(page.getByRole("heading", { name: "计费管理", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "兑换码", exact: true }).click();
    await page.getByLabel("批次名称", { exact: true }).fill("E2E campaign");
    await page.getByLabel("兑换码数量（1–100）", { exact: true }).fill("2");
    await page.getByLabel("每个码的积分", { exact: true }).fill("30");
    await page.getByRole("button", { name: "生成兑换码", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("60 积分");
    await page.getByRole("button", { name: "确认并生成", exact: true }).click();
    const output = page.getByRole("textbox", { name: "本次生成的兑换码" });
    await expect(output).toBeVisible();
    const codes = (await output.inputValue()).split("\n");
    expect(codes).toHaveLength(2);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载 TXT" }).click();
    expect((await download).suggestedFilename()).toMatch(/^riic-codes-.*\.txt$/);
    const recipientPage = await recipientContext.newPage();
    const balancePage = await recipientContext.newPage();
    await balancePage.goto("/agent");
    await balancePage.addLocatorHandler(balancePage.locator("[data-release-dialog]"), async () => {
      await balancePage.getByRole("button", { name: "知道了", exact: true }).click();
    });
    await expect(balancePage.getByRole("heading", { name: "补充积分，开始对话" })).toBeVisible({ timeout: 30_000 });
    await recipientPage.addLocatorHandler(recipientPage.locator("[data-release-dialog]"), async () => {
      await recipientPage.getByRole("button", { name: "知道了", exact: true }).click();
    });
    await recipientPage.goto(`/billing#redeem=${codes[0]}`);
    await expect(recipientPage.getByRole("textbox", { name: "积分兑换码" })).toHaveValue(codes[0], { timeout: 30_000 });
    expect(recipientPage.url()).not.toContain(codes[0]);
    expect((await pool.query('select count(*)::int as count from app.billing_ledger where user_id=$1', [recipient.id])).rows[0].count).toBe(0);
    await expect(recipientPage.getByRole("link", { name: "管理积分兑换码" })).toHaveCount(0);
    await recipientPage.getByRole("button", { name: "核销并入账" }).click();
    await expect(recipientPage.getByRole("status")).toContainText("已到账 30 永久积分");
    await expect(recipientPage.getByRole("region", { name: "积分余额" })).toContainText("30");
    await expect(recipientPage.locator("[data-billing-ledger]")).toContainText("兑换码到账");
    await expect(balancePage.locator("[data-agent-credit-balance]")).toHaveAttribute("aria-label", "剩余积分 30", { timeout: 15_000 });
    await expect(balancePage.getByRole("heading", { name: "补充积分，开始对话" })).toHaveCount(0);
    await recipientPage.getByRole("textbox", { name: "积分兑换码" }).fill(codes[0]);
    await recipientPage.getByRole("button", { name: "核销并入账" }).click();
    await expect(recipientPage.locator("[data-billing-prototype]").getByRole("alert")).toContainText("不能重复兑换");
    await page.getByRole("button", { name: "刷新记录" }).click();
    await expect(page.getByRole("button", { name: "作废整批", exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: "作废整批", exact: true }).click();
    await page.getByLabel("作废原因", { exact: true }).fill("E2E campaign ended");
    await page.getByRole("button", { name: "确认作废", exact: true }).click();
    await expect(page.getByRole("region", { name: "最近发放记录" }).getByRole("status")).toContainText("已作废 1 个");
    await recipientPage.getByRole("textbox", { name: "积分兑换码" }).fill(codes[1]);
    await recipientPage.getByRole("button", { name: "核销并入账" }).click();
    await expect(recipientPage.locator("[data-billing-prototype]").getByRole("alert")).toContainText("已作废");
    for (const account of [recipient, reviewer]) {
      expect((await context.request.get("/api/admin/billing/cdk", { headers: account.headers })).status()).toBe(403);
      expect((await context.request.patch("/api/admin/billing/cdk", { headers: account.headers, data: { batchId: randomUUID(), reason: "forbidden" } })).status()).toBe(403);
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByRole("heading", { name: "计费管理", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await recipientContext.close();
    await reviewerContext.close();
    await pool.query('delete from public."user" where id=any($1::text[])', [users]);
    await pool.end();
  }
});
