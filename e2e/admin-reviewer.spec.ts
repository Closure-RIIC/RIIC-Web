import { createHmac, randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { Pool } from "pg";

test("reviewer routes remain protected and user management displays roles without duplicate grants", async ({ page, context, baseURL }) => {
  const url = process.env.AUTH_INTEGRATION_DATABASE_URL;
  test.skip(!url || !process.env.BETTER_AUTH_SECRET, "Requires an isolated database and the server's test session secret.");
  if (!new URL(url!).pathname.endsWith("_test")) throw new Error("Only an isolated *_test database is allowed.");
  test.setTimeout(180_000);
  const pool = new Pool({ connectionString: url, max: 1 });
  const id = `e2e-reviewer-${randomUUID()}`;
  const token = randomUUID();
  try {
    await pool.query('INSERT INTO "user" (id,name,email,email_verified,role) VALUES ($1,$2,$3,true,$4)', [id, "Reviewer browser test", `${id}@example.test`, "reviewer"]);
    await pool.query("INSERT INTO public.session (id,user_id,token,expires_at) VALUES ($1,$2,$3,now()+interval '1 hour')", [randomUUID(), id, token]);
    const signedToken = encodeURIComponent(`${token}.${createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(token).digest("base64")}`);
    await context.addCookies([{ name: "better-auth.session_token", value: signedToken, domain: new URL(baseURL!).hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
    // Exercise the real session lookup and authorization without creating credentials.
    const apiHeaders = { cookie: `better-auth.session_token=${signedToken}`, origin: baseURL! };
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
      expect(response!.status()).toBe(404);
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
    // Assignment is covered by reviewer-role.integration and the four-role browser script.
    // Even a response advertising role-management permission must not add controls here.
    await pool.query('UPDATE "user" SET role=$1 WHERE id=$2', ["admin", id]);
    let verifiedUsers = 45549;
    await page.route("**/api/admin/users**", async route => {
      expect(route.request().method()).toBe("GET");
      await route.fulfill({ json: { success: true, data: {
        permissions: { canManageAdminRoles: true },
        summary: { verifiedUsers },
        users: [{ id: "role-control-test", name: "Role control test", email: "reviewer@example.test",
          emailVerified: true, banned: false, banReason: null, createdAt: new Date().toISOString(),
          isAdmin: false, isReviewer: true, isBootstrapAdmin: false, isSuperAdmin: false, canModerate: true,
          paidPoints: 0, monthlyPoints: 0, monthlyExpiresAt: null, totalPoints: 0,
          sklandBindingCount: 0, sklandActiveBindingCount: 0, sklandRenewalDueCount: 0 }],
      } } });
    });
    await context.addCookies([{ name: "aic_locale", value: "zh-CN", domain: new URL(baseURL!).hostname, path: "/" }]);
    await page.goto("/admin/users");
    await expect(page.locator("[data-admin-verified-users]")).toContainText("45,549");
    await expect(page.getByRole("cell", { name: /^(审阅人|Reviewer)$/ })).toBeVisible();
    await page.getByRole("button", { name: /管理账户|Manage account/, exact: true }).click();
    await expect(page.getByRole("button", { name: /^(设为管理员|取消管理员|设为审阅人|撤销审阅人|Grant admin|Revoke admin|Grant reviewer|Revoke reviewer)$/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^(查看 Session|View sessions)$/ })).toBeVisible();
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
