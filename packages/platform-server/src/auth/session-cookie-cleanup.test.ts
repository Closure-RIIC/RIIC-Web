import assert from "node:assert/strict";
import test from "node:test";
import { responseWithClearedSklandCookies, responseWithLegacyAuthCookieCleanup, sklandCookieNames } from "./session-cookie-cleanup.ts";

test("selects only Skland cookies for website-account cleanup", () => {
  assert.deepEqual(sklandCookieNames("better-auth.session_token=keep; skland_accounts_v3=a; skland_account_v3_id=b; preference=keep"), ["skland_accounts_v3", "skland_account_v3_id"]);
});

test("shared-cookie renewal expires only the old host-only copy", context => {
  const originalDomain = process.env.AUTH_COOKIE_DOMAIN, originalOrigins = process.env.PLATFORM_PUBLIC_ORIGINS;
  process.env.AUTH_COOKIE_DOMAIN = "riic.test";
  process.env.PLATFORM_PUBLIC_ORIGINS = "https://riic.test,https://endfield.riic.test";
  context.after(() => {
    if (originalDomain === undefined) delete process.env.AUTH_COOKIE_DOMAIN; else process.env.AUTH_COOKIE_DOMAIN = originalDomain;
    if (originalOrigins === undefined) delete process.env.PLATFORM_PUBLIC_ORIGINS; else process.env.PLATFORM_PUBLIC_ORIGINS = originalOrigins;
  });
  const response = responseWithLegacyAuthCookieCleanup(new Response(null, { headers: { "set-cookie": "__Secure-better-auth.session_token=renewed; Domain=riic.test; Path=/; HttpOnly; Secure" } }), new Request("https://riic.test/api/auth/sign-in/email"));
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  assert.match(cookies[0], /session_token=renewed; Domain=riic.test/);
  assert.match(cookies[1], /session_token=; Path=\/; Max-Age=0/);
  assert.doesNotMatch(cookies[1], /Domain=/);
});

test("preserves the auth response and expires owned cookies after a successful action", async () => {
  const request = new Request("https://example.test/api/auth/sign-out", { headers: { cookie: "skland_accounts_v3=a; unrelated=b" } });
  const response = responseWithClearedSklandCookies(Response.json({ success: true }), request);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.match(response.headers.get("set-cookie") ?? "", /skland_accounts_v3=; Path=\/; Max-Age=0; HttpOnly; SameSite=Lax; Secure/);
  assert.doesNotMatch(response.headers.get("set-cookie") ?? "", /unrelated/);
});
