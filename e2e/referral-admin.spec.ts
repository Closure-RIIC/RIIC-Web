import { createHmac, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, test, type BrowserContext } from "@playwright/test";

test("referral campaign requires super-admin permissions and preserves audit and public visibility", async ({ page, context, browser, baseURL }, testInfo) => {
  const url = process.env.AUTH_INTEGRATION_DATABASE_URL;
  test.skip(!url || !process.env.BETTER_AUTH_SECRET, "Requires an isolated database and the server's test session secret.");
  if (!new URL(url!).pathname.endsWith("_test")) throw new Error("Only an isolated *_test database is allowed.");
  test.setTimeout(120_000);
  const pool = new Pool({ connectionString: url, max: 2 });
  const users: string[] = [];
  const visitor = await browser.newContext({ baseURL });
  const regular = await browser.newContext({ baseURL });
  const ordinaryAdmin = await browser.newContext({ baseURL });
  let previous: { enabled: boolean; rewardPoints: number; inviteePoints: number; rewardLimit: number; updatedAt: string } | undefined;
  async function session(target: BrowserContext, role: string, id = `referral-browser-${randomUUID()}`) {
    const token = randomUUID();
    await pool.query('INSERT INTO public."user" (id,name,email,email_verified,role) VALUES ($1,$2,$3,true,$4)', [id, "Referral browser", `${id}@example.test`, role]);
    users.push(id);
    await pool.query('INSERT INTO public.session (id,user_id,token,expires_at) VALUES ($1,$2,$3,now()+interval \'1 hour\')', [randomUUID(), id, token]);
    const value = encodeURIComponent(`${token}.${createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(token).digest("base64")}`);
    await target.addCookies([{ name: "better-auth.session_token", value, domain: new URL(baseURL!).hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
    return id;
  }
  try {
    // This ID is configured only in playwright.config.ts's test server environment.
    const adminId = await session(context, "user", "e2e-referral-super-admin");
    await session(regular, "user");
    await session(ordinaryAdmin, "admin");
    const previousResponse = await context.request.get("/api/admin/billing?section=referral");
    expect(previousResponse.status()).toBe(200);
    previous = (await previousResponse.json()).data;
    expect((await ordinaryAdmin.request.get("/api/admin/billing?section=referral")).status()).toBe(403);
    const deniedAdmin = await ordinaryAdmin.request.post("/api/admin/billing?section=referral", { headers: { origin: baseURL! }, data: {
      enabled: true, expectedUpdatedAt: previous!.updatedAt, reason: "Ordinary admin must be denied", idempotencyKey: randomUUID(),
    } });
    expect(deniedAdmin.status()).toBe(403);
    const adminPage = await ordinaryAdmin.newPage();
    await adminPage.goto("/admin/billing");
    await expect(adminPage.getByRole("columnheader", { name: "邮箱", exact: true })).toBeVisible();
    await expect(adminPage.getByRole("button", { name: "邀请活动", exact: true })).toHaveCount(0);
    const reset = await context.request.post("/api/admin/billing?section=referral", { headers: { origin: baseURL! }, data: { enabled: false, expectedUpdatedAt: previous!.updatedAt, reason: "Browser validation initial state", idempotencyKey: randomUUID() } });
    expect(reset.status()).toBe(200);
    const guestState = await visitor.request.get("/api/referral");
    expect((await guestState.json()).data).toMatchObject({ enabled: false, account: null });
    await page.goto("/admin/billing");
    await page.getByRole("button", { name: "邀请活动", exact: true }).click();
    const campaign = page.locator("[data-billing-referral]");
    await expect(campaign).toContainText("活动已关闭");
    const save = campaign.getByRole("button", { name: "保存活动设置" });
    await expect(save).toBeDisabled();
    await campaign.getByRole("checkbox", { name: "开启活动" }).check();
    await campaign.getByLabel("邀请人每次所得积分").fill("14");
    await campaign.getByLabel("受邀新人所得积分").fill("8");
    await campaign.getByLabel("每位邀请人累计奖励人数上限").fill("3");
    await campaign.getByLabel("操作原因（记录至审计）").fill("Browser validation enabled");
    await save.click();
    await expect(campaign).toContainText("活动已开启");
    await page.screenshot({ path: testInfo.outputPath("referral-admin.png"), fullPage: true });
    const active = (await (await visitor.request.get("/api/referral")).json()).data;
    expect(active).toMatchObject({ enabled: true, rewardPoints: 14, inviteePoints: 8, rewardLimit: 3, maxPoints: 42, account: null });
    const accountState = (await (await regular.request.get("/api/referral")).json()).data;
    expect(accountState.account.code).toMatch(/^[A-F0-9]{24}$/);
    expect(accountState.account.earnedPoints).toBe(0);
    const denied = await regular.request.post("/api/admin/billing?section=referral", { headers: { origin: baseURL! }, data: { enabled: false, expectedUpdatedAt: active.updatedAt, reason: "forged", idempotencyKey: randomUUID() } });
    expect(denied.status()).toBe(403);
    const audits = await pool.query("SELECT count(*)::int AS total FROM app.billing_admin_audit WHERE actor_id=$1 AND reason=$2", [adminId, "Browser validation enabled"]);
    expect(audits.rows[0].total).toBe(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(campaign).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await campaign.getByLabel("操作原因（记录至审计）").fill("Browser validation disabled");
    await campaign.getByRole("checkbox", { name: "开启活动" }).uncheck();
    await save.click();
    await expect(campaign).toContainText("活动已关闭");
    expect((await (await visitor.request.get("/api/referral")).json()).data.enabled).toBe(false);
  } finally {
    if (previous) {
      const endpoint = "/api/admin/billing?section=referral";
      const current = (await (await context.request.get(endpoint)).json()).data;
      const restored = await context.request.post(endpoint, { headers: { origin: baseURL! }, data: {
        ...previous, expectedUpdatedAt: current.updatedAt, reason: "Restore test configuration", idempotencyKey: randomUUID(),
      } });
      expect(restored.status()).toBe(200);
    }
    await visitor.close(); await regular.close(); await ordinaryAdmin.close();
    await pool.query('DELETE FROM public."user" WHERE id=any($1::text[])', [users]);
    await pool.end();
  }
});
