import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { Pool } from "pg";
import { mockAnonymousWebsiteSession, mockApis } from "./production-readiness.fixture";

test("wish wall reports unauthenticated submissions and keeps the form", async ({ page }) => {
  await mockApis(page);
  await page.route("**/api/wishes", route => route.fulfill({
    status: route.request().method() === "POST" ? 401 : 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { items: [], donation: { enabled: false, imageUrl: null } } }),
  }));
  await page.goto("/wishes");
  await expect(page.locator('body[data-app-hydrated="true"]')).toBeVisible();
  await page.locator("#wish-title").fill("测试许愿");
  await page.locator("#wish-content").fill("需要登录才能提交");
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByText("请先登录后提交许愿。")).toBeVisible();
  await expect(page.locator("#wish-title")).toHaveValue("测试许愿");
});

test("settings opens account sign-in in a dialog for signed out users", async ({ page }) => {
  await mockApis(page);
  await mockAnonymousWebsiteSession(page);
  await page.goto("/settings");
  await expect(page.locator('[data-workbench-hydrated="true"]')).toBeVisible();
  await expect(page.locator("[data-website-account-panel]")).toHaveCount(0);
  await page.locator("[data-website-account-sign-in-prompt]").getByRole("button", { name: "登录", exact: true }).click();
  const account = page.getByRole("dialog", { name: "登录网站账号", exact: true }).locator("[data-website-account-panel]");
  await expect(account.getByRole("textbox", { name: "邮箱", exact: true })).toBeVisible();
  await expect(account.getByLabel("密码", { exact: true })).toBeVisible();
  await expect(account.getByRole("button", { name: "登录", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/settings$/);
});

test("session renewal and wish submission enforce real authentication", async ({ request, baseURL }) => {
  const databaseUrl = process.env.AUTH_INTEGRATION_DATABASE_URL;
  test.skip(!databaseUrl, "Requires isolated authentication database");
  if (!new URL(databaseUrl!).pathname.endsWith("_test")) throw new Error("Isolated *_test database required");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const id = "e2e-wish-" + randomUUID();
  const password = "Wish-Browser-Test-2026!";
  const headers = { origin: baseURL! };
  try {
    const denied = await request.post("/api/wishes", { headers, data: { title: "x", content: "x" } });
    expect(denied.status()).toBe(401);
    const missing = await request.post("/api/auth/request-password-reset", { headers, data: { email: id + "@example.test", redirectTo: baseURL + "/account/reset-password" } });
    expect(missing.status()).toBe(200);
    expect(await missing.json()).toEqual({ status: true, message: "If this email exists in our system, check your email for the reset link" });
    expect(missing.headers()["cache-control"]).toContain("no-store");
    const invalidRedirect = { email: id + "@example.test", redirectTo: "https://untrusted.invalid/reset" };
    const unknownRedirect = await request.post("/api/auth/request-password-reset", { headers, data: invalidRedirect });
    expect(unknownRedirect.status()).toBe(403);
    const unknownRedirectBody = await unknownRedirect.json();
    expect(unknownRedirectBody.code).toBe("INVALID_REDIRECT_URL");
    await pool.query('INSERT INTO public."user" (id,name,email,email_verified,role) VALUES ($1,$1,$2,true,\'user\')', [id, id + "@example.test"]);
    await pool.query("INSERT INTO account (id,account_id,provider_id,user_id,password) VALUES ($1,$2,'credential',$2,$3)", [randomUUID(), id, await hashPassword(password)]);
    // Reject the same untrusted redirect identically after registration, without sending email.
    const existingRedirect = await request.post("/api/auth/request-password-reset", { headers, data: invalidRedirect });
    expect(existingRedirect.status()).toBe(unknownRedirect.status());
    expect(await existingRedirect.json()).toEqual(unknownRedirectBody);
    expect(existingRedirect.headers()["cache-control"]).toContain("no-store");
    const login = await request.post("/api/auth/sign-in/email", { headers, data: { email: id + "@example.test", password } });
    expect(login.status(), await login.text()).toBe(200);
    const cookie = login.headersArray().filter(item => item.name.toLowerCase() === "set-cookie").map(item => item.value.split(";", 1)[0]).join("; ");
    const authenticatedHeaders = { ...headers, cookie };
    await pool.query("UPDATE session SET expires_at=now()+interval '1 day' WHERE user_id=$1", [id]);
    const renewed = await request.post("/api/account/session/extend", { headers: authenticatedHeaders });
    expect(renewed.status(), await renewed.text()).toBe(200);
    expect(new Date((await renewed.json()).data.expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(renewed.headers()["set-cookie"]).toContain("Max-Age=2592000");
    const submitted = await request.post("/api/wishes", { headers: authenticatedHeaders, data: { title: id, content: "await moderation" } });
    expect(submitted.status(), await submitted.text()).toBe(200);
    const wish = (await submitted.json()).data.wish;
    expect(wish.status).toBe("pending");
    const publicItems = (await (await request.get("/api/wishes")).json()).data.items;
    expect(publicItems.some((item: { id: string }) => item.id === wish.id)).toBe(false);
    const forbidden = await request.patch("/api/admin/wishes", { headers: authenticatedHeaders, data: { id: wish.id, status: "approved" } });
    expect(forbidden.status()).toBe(403);
  } finally {
    await pool.query('DELETE FROM public."user" WHERE id=$1', [id]);
    await pool.end();
  }
});
