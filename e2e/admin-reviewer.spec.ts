import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { Pool } from "pg";
import { attachLoopbackSession } from "./loopback-session";

test("reviewer sees only overview and issues, and direct admin routes remain protected", async ({ page, context, request, baseURL, browserName }) => {
  test.skip(!process.env.AUTH_INTEGRATION_DATABASE_URL, "Requires an isolated authentication test database.");
  test.setTimeout(180_000);
  const pool = new Pool({ connectionString: process.env.AUTH_INTEGRATION_DATABASE_URL, max: 1 });
  const id = `e2e-reviewer-${randomUUID()}`;
  const password = "Reviewer-Browser-Test-2026!";
  try {
    await pool.query('INSERT INTO "user" (id,name,email,email_verified,role) VALUES ($1,$2,$3,true,$4)', [id, "Reviewer browser test", `${id}@example.test`, "reviewer"]);
    await pool.query("INSERT INTO account (id,account_id,provider_id,user_id,password) VALUES ($1,$2,'credential',$2,$3)", [randomUUID(), id, await hashPassword(password)]);
    const login = await request.post("/api/auth/sign-in/email", {
      headers: { origin: process.env.BETTER_AUTH_URL ?? baseURL! },
      data: { email: `${id}@example.test`, password },
    });
    expect(login.status(), await login.text()).toBe(200);
    const sessionCookies: string[] = [];
    for (const header of login.headersArray().filter(header => header.name.toLowerCase() === "set-cookie")) {
      const pair = header.value.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (!pair.slice(0, separator).endsWith("session_token")) continue;
      sessionCookies.push(pair);
      await context.addCookies([{
        name: pair.slice(0, separator), value: pair.slice(separator + 1),
        domain: new URL(baseURL!).hostname, path: "/", httpOnly: true,
        secure: header.value.toLowerCase().includes("; secure"), sameSite: "Lax",
      }]);
    }
    // APIRequestContext does not send Secure cookies over CI's HTTP loopback URL,
    // while Chromium treats loopback as trustworthy. Use the same real session
    // explicitly for API assertions so they test authorization, not missing login.
    expect(sessionCookies).toHaveLength(1);
    await attachLoopbackSession(context, baseURL!, browserName, sessionCookies);
    const apiHeaders = { cookie: sessionCookies.join("; ") };
    await page.goto("/admin");
    const nav = page.locator("nav").filter({ has: page.locator('a[href="/admin/issues"]') });
    await expect(nav.locator('a[href="/admin"]')).toBeVisible();
    await expect(nav.locator('a[href="/admin/issues"]')).toBeVisible();
    for (const path of ["/admin/users", "/admin/skills", "/admin/changelog"]) {
      await expect(nav.locator(`a[href="${path}"]`)).toHaveCount(0);
    }
    await nav.locator('a[href="/admin/issues"]').click();
    await expect(page).toHaveURL(/\/admin\/issues$/, { timeout: 30_000 });
    await expect(page.locator("h1")).toBeVisible();
    for (const path of ["/admin/users", "/admin/skills", "/admin/changelog"]) {
      const response = await page.goto(path);
      // Next may stream a not-found boundary with HTTP 200.
      expect([200, 404]).toContain(response!.status());
      await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
      await expect(page.locator("[data-admin-user-management]")).toHaveCount(0);
    }
    for (const path of ["/api/admin/users", "/api/admin/users/test/sessions", "/api/admin/skill-annotations", "/api/admin/releases"]) {
      expect((await context.request.get(path, { headers: apiHeaders })).status()).toBe(403);
    }
    expect((await context.request.patch(`/api/admin/users/${id}`, { headers: apiHeaders, data: { isAdmin: true } })).status()).toBe(403);
    for (const path of ["/api/admin/solver-metrics", "/api/admin/feedback", "/api/admin/plan-runs"]) {
      const response = await context.request.get(path, { headers: apiHeaders });
      expect([200, 503]).toContain(response.status());
      if (response.status() === 503) expect((await response.json()).error.code).toBe("AIC-DATA-8002");
    }
    expect((await context.request.get("/api/admin/diagnostics", { headers: apiHeaders })).status()).toBe(200);
    // The real API assignment lifecycle is covered by reviewer-role.integration;
    // exercise the role controls here with a bootstrap user's response.
    await pool.query('UPDATE "user" SET role=$1 WHERE id=$2', ["admin", id]);
    let isReviewer = false;
    let verifiedUsers = 45549;
    await page.route("**/api/admin/users**", async route => {
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON();
        expect(Object.keys(body)).toEqual(["isReviewer"]);
        isReviewer = body.isReviewer;
        await route.fulfill({ json: { success: true, data: { updated: true } } });
      } else {
        await route.fulfill({ json: { success: true, data: {
          permissions: { canManageAdminRoles: true },
          summary: { verifiedUsers },
          users: [{ id: "role-control-test", name: "Role control test", email: "reviewer@example.test",
            emailVerified: true, banned: false, banReason: null, createdAt: new Date().toISOString(),
            isAdmin: false, isReviewer, isBootstrapAdmin: false,
            sklandBindingCount: 0, sklandActiveBindingCount: 0, sklandRenewalDueCount: 0 }],
        } } });
      }
    });
    await context.addCookies([{ name: "riic-locale", value: "zh", domain: new URL(baseURL!).hostname, path: "/" }]);
    await page.goto("/admin/users");
    await expect(page.locator("[data-admin-verified-users]")).toContainText("45,549");
    await page.getByRole("button", { name: /管理账户|Manage account/, exact: true }).click();
    await page.getByRole("button", { name: /设为审阅人|Grant reviewer/, exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: /确认设为审阅人|Confirm reviewer/, exact: true }).click();
    await expect(page.getByRole("button", { name: /撤销审阅人|Revoke reviewer/, exact: true })).toBeVisible();
    expect(isReviewer).toBe(true);
    await page.getByRole("button", { name: /撤销审阅人|Revoke reviewer/, exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: /确认取消|Confirm revocation/, exact: true }).click();
    await expect(page.getByRole("button", { name: /设为审阅人|Grant reviewer/, exact: true })).toBeVisible();
    expect(isReviewer).toBe(false);
    verifiedUsers = 0;
    await page.getByRole("search").getByRole("button", { name: /^(搜索|Search)$/ }).click();
    await expect(page.locator("[data-admin-verified-users] dd").first()).toHaveText("0");
    await pool.query('UPDATE "user" SET role=$1 WHERE id=$2', ["user", id]);
    expect((await context.request.get("/api/admin/solver-metrics", { headers: apiHeaders })).status()).toBe(403);
    await page.goto("/admin");
    await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
  } finally {
    await pool.query('DELETE FROM "user" WHERE id=$1', [id]);
    await pool.end();
  }
});
