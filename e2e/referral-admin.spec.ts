import { createHmac, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, test, type BrowserContext } from "@playwright/test";

test("referral campaign uses real admin permissions, audit and public visibility", async ({ page, context, browser, baseURL }, testInfo) => {
  const url = process.env.AUTH_INTEGRATION_DATABASE_URL;
  test.skip(!url || !process.env.BETTER_AUTH_SECRET, "Requires an isolated database and the server's test session secret.");
  if (!new URL(url!).pathname.endsWith("_test")) throw new Error("Only an isolated *_test database is allowed.");
  test.setTimeout(120_000);
  const pool = new Pool({ connectionString: url, max: 2 });
  const users: string[] = [];
  const visitor = await browser.newContext({ baseURL });
  const regular = await browser.newContext({ baseURL });
  async function session(target: BrowserContext, role: string) {
    const id = `referral-browser-${randomUUID()}`;
    const token = randomUUID();
    await pool.query('INSERT INTO public."user" (id,name,email,email_verified,role) VALUES ($1,$2,$3,true,$4)', [id, "Referral browser", `${id}@example.test`, role]);
    users.push(id);
    await pool.query('INSERT INTO public.session (id,user_id,token,expires_at) VALUES ($1,$2,$3,now()+interval \'1 hour\')', [randomUUID(), id, token]);
    const value = encodeURIComponent(`${token}.${createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(token).digest("base64")}`);
    await target.addCookies([{ name: "better-auth.session_token", value, domain: new URL(baseURL!).hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
    return id;
  }
  try {
    const adminId = await session(context, "admin");
    await session(regular, "user");
    const previousResponse = await context.request.get("/api/admin/billing?section=referral");
    expect(previousResponse.status()).toBe(200);
    const previous = (await previousResponse.json()).data;
    const reset = await context.request.post("/api/admin/billing?section=referral", { headers: { origin: baseURL! }, data: { enabled: false, expectedUpdatedAt: previous.updatedAt, reason: "Browser validation initial state", idempotencyKey: randomUUID() } });
    expect(reset.status()).toBe(200);
    const guestState = await visitor.request.get("/api/referral");
    expect((await guestState.json()).data).toMatchObject({ enabled: false, account: null });
    await page.goto("/admin/billing");
    await page.getByRole("button", { name: "邀请活动", exact: true }).click();
    const campaign = page.locator("[data-billing-referral]");
    await expect(campaign).toContainText("活动已关闭");
    await expect(campaign.getByRole("button", { name: "开启活动", exact: true })).toBeDisabled();
    await campaign.getByLabel("操作原因（记录至审计）").fill("Browser validation enabled");
    await campaign.getByRole("button", { name: "开启活动", exact: true }).click();
    await expect(campaign).toContainText("活动已开启");
    await page.screenshot({ path: testInfo.outputPath("referral-admin.png"), fullPage: true });
    const active = (await (await visitor.request.get("/api/referral")).json()).data;
    expect(active).toMatchObject({ enabled: true, rewardPoints: 10, rewardLimit: 5, maxPoints: 50, account: null });
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
    await campaign.getByRole("button", { name: "关闭活动", exact: true }).click();
    await expect(campaign).toContainText("活动已关闭");
    expect((await (await visitor.request.get("/api/referral")).json()).data.enabled).toBe(false);
  } finally {
    await visitor.close(); await regular.close();
    await pool.query('DELETE FROM public."user" WHERE id=any($1::text[])', [users]);
    await pool.end();
  }
});
