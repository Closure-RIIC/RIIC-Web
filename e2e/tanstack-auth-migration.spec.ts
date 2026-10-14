import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { hashPassword } from "better-auth/crypto";

const databaseUrl = process.env.AUTH_INTEGRATION_DATABASE_URL;
test.skip(!databaseUrl, "Requires an explicitly isolated PostgreSQL test database");
const password = "Migration-Session-2026!";
const ids = new Map<string, string>();
let pool: Pool;

test.beforeAll(async () => {
  if (!databaseUrl) return;
  const target = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1"].includes(target.hostname) || !/test|integration/i.test(target.pathname)) {
    throw new Error("Migration e2e requires a local, isolated test database");
  }
  pool = new Pool({ connectionString: databaseUrl });
  const hash = await hashPassword(password);
  for (const role of ["user", "reviewer", "admin"]) {
    const id = randomUUID();
    ids.set(role, id);
    await pool.query('INSERT INTO "user" (id,name,email,email_verified,role) VALUES ($1,$2,$3,true,$4)', [id, role, id + "@example.test", role]);
    await pool.query("INSERT INTO account (id,account_id,provider_id,user_id,password) VALUES ($1,$2,'credential',$2,$3)", [randomUUID(), id, hash]);
  }
});
test.afterAll(async () => {
  if (!pool) return;
  try {
    for (const id of ids.values()) await pool.query('DELETE FROM "user" WHERE id=$1', [id]);
  } finally { await pool.end(); }
});

test("real session cookies cross Start API and SSR boundaries and enforce reviewer/admin access", async ({ browser }) => {
  for (const role of ["user", "reviewer", "admin"]) {
    const context = await browser.newContext();
    try {
      const origin = "http://127.0.0.1:5195";
      const login = await context.request.post(origin + "/api/auth/sign-in/email", {
        headers: { origin }, data: { email: ids.get(role) + "@example.test", password },
      });
      expect(login.status(), await login.text()).toBe(200);
      expect(login.headersArray().some(({ name }) => name.toLowerCase() === "set-cookie")).toBe(true);
      const session = await context.request.get(origin + "/api/auth/get-session");
      expect((await session.json()).user.id).toBe(ids.get(role));
      for (const [pathname, permitted] of [
        ["/admin", role !== "user"], ["/admin/wishes", role !== "user"], ["/admin/issues", role !== "user"], ["/admin/quality", role !== "user"],
        ["/admin/agent", role === "admin"], ["/admin/billing", role === "admin"], ["/agent", role === "admin"], ["/billing", role === "admin"], ["/admin/users", role === "admin"], ["/admin/changelog", role === "admin"],
      ] as const) {
        expect((await context.request.get(origin + pathname)).status(), role + ":" + pathname).toBe(permitted ? 200 : 404);
      }
      const releases = await context.request.get(origin + "/api/admin/releases");
      expect(releases.status()).toBe(role === "admin" ? 200 : 403);
      expect((await context.request.get(origin + "/api/auth/admin/list-users")).status()).toBe(404);
      if (role === "admin") {
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(origin + "/admin/users");
        await expect(page.getByRole("heading", { name: "用户管理", exact: true })).toBeVisible();
        await page.reload();
        await expect(page.getByRole("heading", { name: "用户管理", exact: true })).toBeVisible();
        await expect(page.locator('[data-slot="sidebar-content"]')).toHaveAttribute("data-overlayscrollbars-viewport", /scrollbarHidden/);
        expect(errors).toEqual([]);
      }
      const forbiddenOrigin = await context.request.post(origin + "/api/auth/sign-out", { headers: { origin: "https://untrusted.example" }, data: {} });
      expect(forbiddenOrigin.status()).toBe(403);
      const logout = await context.request.post(origin + "/api/auth/sign-out", { headers: { origin }, data: {} });
      expect(logout.status()).toBe(200);
      expect(await (await context.request.get(origin + "/api/auth/get-session")).json()).toBeNull();
      expect((await context.request.get(origin + "/admin/issues")).status()).toBe(404);
    } finally { await context.close(); }
  }
});
