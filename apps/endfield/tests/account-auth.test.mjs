import test from "node:test";
import assert from "node:assert/strict";
import { authenticateAccount } from "../src/server/account-auth.ts";
import { readAccountFeatureAccess } from "../src/server/account-feature-access.ts";

const origin = "https://endfield.example.test";
function usePlatform(t) {
  const previous = process.env.PLATFORM_API_ORIGIN;
  process.env.PLATFORM_API_ORIGIN = "https://platform.example.test";
  t.after(() => {
    if (previous === undefined) delete process.env.PLATFORM_API_ORIGIN;
    else process.env.PLATFORM_API_ORIGIN = previous;
  });
}
const request = (path, body = {}, extra = {}) => new Request(`${origin}/api/auth/${path}`, {
  method: "POST", headers: { origin, "content-type": "application/json", cookie: "unrelated=private; better-auth.session_token=session-fixture", ...extra }, body: JSON.stringify(body),
});

test("dialog auth forwards only allowed actions and compatible auth cookies, without returning tokens", async t => {
  usePlatform(t);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: String(url), init });
    const headers = new Headers();
    headers.append("Set-Cookie", "better-auth.session_token=new-session; Path=/; HttpOnly; Secure; Domain=example.test");
    headers.append("Set-Cookie", "unrelated=private; Path=/");
    headers.append("Set-Cookie", "better-auth.session_token=wrong-domain; Domain=elsewhere.test");
    return Response.json({ token: "never-return", user: { id: "user", private: "hidden" } }, { headers });
  });
  const response = await authenticateAccount(request("sign-in/email", { email: "fixture@example.test", password: "fixture-only-password", callbackURL: `${origin}/settings` }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(response.headers.getSetCookie().length, 1);
  assert.match(response.headers.getSetCookie()[0], /new-session/);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(calls[0].url, "https://platform.example.test/api/auth/sign-in/email");
  assert.equal(calls[0].init.headers.get("cookie"), "better-auth.session_token=session-fixture");
  assert.equal(calls[0].init.headers.get("origin"), origin);
  assert.equal(calls[0].init.headers.get("x-forwarded-host"), "endfield.example.test");
  assert.equal(calls[0].init.redirect, "manual");
  for (const path of ["admin/create-user", "delete-user", "revoke-sessions", "sign-out", "unknown"]) {
    assert.equal((await authenticateAccount(request(path))).status, 404);
  }
  assert.equal((await authenticateAccount(request("sign-in/email", {}, { origin: "https://untrusted.test" }))).status, 403);
  assert.equal((await authenticateAccount(request("request-password-reset", { redirectTo: "https://untrusted.test" }))).status, 400);
  assert.equal((await authenticateAccount(request("sign-up/email", { name: "x".repeat(17_000) }))).status, 413);
  assert.equal(calls.length, 1);
});

test("reset email callbacks stay on the requesting app and failures remain retryable", async t => {
  usePlatform(t);
  let destination = `${origin}/?auth=reset-password&token=fixture-token`;
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 302, headers: { Location: destination } }));
  const callback = () => new Request(`${origin}/api/auth/reset-password/fixture-token?callbackURL=${encodeURIComponent(`${origin}/?auth=reset-password`)}`);
  assert.equal((await authenticateAccount(callback())).headers.get("location"), destination);
  destination = "https://untrusted.test/";
  assert.equal((await authenticateAccount(callback())).status, 502);
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: "INVALID_PASSWORD", message: "Invalid password", token: "hidden" }, { status: 401 }));
  const failure = await authenticateAccount(request("sign-in/email"));
  assert.equal(failure.status, 401);
  assert.deepEqual(await failure.json(), { code: "INVALID_PASSWORD", message: "Invalid password" });
});

test("Endfield uses the primary app's feature decision, filtering credentials and failing closed", async t => {
  let seen;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    seen = { url: String(url), init };
    return Response.json({ billing: true, agent: "true", private: "hidden" }, { headers: { "Set-Cookie": "unrelated=hidden" } });
  });
  const req = new Request(`${origin}/api/account/feature-access`, { headers: { cookie: "unrelated=private; better-auth.session_token=fixture" } });
  const response = await readAccountFeatureAccess(req, "https://arknights.example.test");
  assert.deepEqual(await response.json(), { billing: true, agent: false });
  assert.equal(seen.url, "https://arknights.example.test/api/account/feature-access");
  assert.equal(seen.init.headers.cookie, "better-auth.session_token=fixture");
  assert.equal(seen.init.redirect, "error");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal((await readAccountFeatureAccess(req, origin)).status, 503);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  const unavailable = await readAccountFeatureAccess(req, "https://arknights.example.test");
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { agent: false, billing: false });
});
