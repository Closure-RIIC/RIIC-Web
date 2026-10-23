import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";

register("../../../../scripts/ts-path-loader.mjs", import.meta.url);

test("password reset keeps account existence private and preserves request guards", async t => {
  const environment = { ...process.env };
  t.after(() => { process.env = environment; });
  const origin = "https://audit.invalid";
  process.env.NODE_ENV = "production";
  process.env.APP_DEPLOYMENT_ENV = "production";
  process.env.BETA_PUBLIC_ORIGIN = origin;
  process.env.BETA_TRUST_PROXY_HEADERS = "1";
  delete process.env.PLATFORM_PUBLIC_ORIGINS;
  delete process.env.AUTH_COOKIE_DOMAIN;
  const email = "registered@example.invalid";
  let sent = 0;
  const auth = betterAuth({
    baseURL: origin,
    secret: "isolated-test-secret-with-at-least-thirty-two-characters",
    trustedOrigins: [origin],
    logger: { disabled: true },
    database: memoryAdapter({
      user: [{ id: "fixture", email, name: "Fixture", emailVerified: true, createdAt: new Date(), updatedAt: new Date() }],
      account: [], session: [], verification: [], rateLimit: [],
    }),
    emailAndPassword: { enabled: true, sendResetPassword: async () => { sent++; } },
    rateLimit: { enabled: true, storage: "database" },
  });
  await t.mock.module(new URL("./index.ts", import.meta.url), { namedExports: {
    getAuth: () => auth,
    websiteSession: async () => null,
  } });
  // Any extra account lookup or unrelated production storage access must fail.
  await t.mock.module(new URL("../db/index.ts", import.meta.url), { namedExports: {
    getDatabase: () => { throw new Error("Unexpected production database access"); },
  } });
  await t.mock.module(new URL("../plan-cache.ts", import.meta.url), { namedExports: {
    evictPlanCacheKeys: async () => {}, userPlanCacheKeys: async () => [],
  } });
  const { POST } = await import("../http/auth/[...all]/route.ts");
  const { __resetRequestGuardsForTests } = await import("../api-contract.ts");
  __resetRequestGuardsForTests();
  const request = (address: string, redirectTo: string, ip: string, extra: Record<string, string> = {}) => new Request(`${origin}/api/auth/request-password-reset`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", "x-real-ip": ip, "x-forwarded-for": ip, ...extra },
    body: JSON.stringify({ email: address, redirectTo }),
  });
  for (const [redirect, status, ip] of [
    ["https://untrusted.invalid/reset", 403, "192.0.2.1"],
    [`${origin}/reset`, 200, "192.0.2.2"],
  ] as const) {
    const missing = await POST(request("missing@example.invalid", redirect, ip));
    const existing = await POST(request(email, redirect, ip));
    assert.equal(missing.status, status);
    assert.equal(existing.status, status);
    assert.equal(existing.headers.get("cache-control"), "private, no-store");
    assert.equal(missing.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await missing.json(), await existing.json());
    assert.equal(sent, status === 200 ? 1 : 0);
  }
  assert.equal((await POST(request(email, `${origin}/reset`, "192.0.2.3", { origin: "https://untrusted.invalid" }))).status, 403);
  assert.equal((await POST(request(email, "x".repeat(8192), "192.0.2.4", { "content-length": "9000" }))).status, 413);
  await t.test("oversized cloned body without Content-Length rejects promptly", { timeout: 2000 }, async () => {
    assert.equal((await POST(request(email, "x".repeat(8192), "192.0.2.5"))).status, 413);
  });
  // Better Auth may enforce a stricter limit before our outer guard does.
  for (let i = 0; i < 5; i++) assert.ok([403, 429].includes((await POST(request("missing@example.invalid", "https://untrusted.invalid/reset", "192.0.2.6"))).status));
  const limited = await POST(request("missing@example.invalid", "https://untrusted.invalid/reset", "192.0.2.6"));
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).code, "AIC-RATE-6001");
});
