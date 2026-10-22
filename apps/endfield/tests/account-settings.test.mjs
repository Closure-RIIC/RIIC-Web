import test from "node:test";
import assert from "node:assert/strict";
import { accountSettings } from "../src/server/account-settings.ts";

test("account settings proxy bounds inputs and delegates only fixed current-account operations", async () => {
  const previousFetch = globalThis.fetch;
  const env = { NODE_ENV: process.env.NODE_ENV, ENDFIELD_ACCOUNT_ORIGIN: process.env.ENDFIELD_ACCOUNT_ORIGIN };
  process.env.NODE_ENV = "development";
  process.env.ENDFIELD_ACCOUNT_ORIGIN = "http://127.0.0.1:5175";
  const calls = [];
  let fail = false, verification = false;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    assert.equal(init.headers.cookie, "better-auth.session_token=fixture");
    assert.equal(init.headers.origin, "http://127.0.0.1:5175");
    assert.equal(init.redirect, "error");
    if (fail) return Response.json({ code: "INVALID_PASSWORD" }, { status: 400 });
    const path = new URL(url).pathname;
    const value = path.endsWith("/extend") ? { success: true, data: { expiresAt: "2099-01-01T00:00:00.000Z" } }
      : path.endsWith("/revoke-sessions") ? { status: true } : { success: true, message: verification ? "Verification email sent" : "User deleted" };
    const response = Response.json(value);
    response.headers.append("Set-Cookie", "better-auth.session_token=fixture; Max-Age=2592000; HttpOnly; Path=/");
    response.headers.append("Set-Cookie", "better-auth.session_token=other-account; Max-Age=2592000; HttpOnly; Path=/");
    response.headers.append("Set-Cookie", "unrelated=secret");
    response.headers.append("Set-Cookie", "better-auth.session_data=; Max-Age=0; Path=/");
    return response;
  };
  const request = (body = {}, origin = "http://127.0.0.1:5176", cookie = "better-auth.session_token=fixture; unrelated=private") => new Request("http://127.0.0.1:5176/api/account/settings/delete", {
    method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  try {
    assert.equal((await accountSettings(request(), "unknown")).status, 404);
    assert.equal((await accountSettings(request({}, "https://evil.invalid"), "revoke")).status, 403);
    assert.equal((await accountSettings(request({}, undefined, ""), "extend")).status, 401);
    assert.equal((await accountSettings(request({ password: "short" }), "delete")).status, 400);
    assert.equal((await accountSettings(request({ password: "fixture-password", userId: "another-user" }), "delete")).status, 400);
    assert.equal((await accountSettings(request({ callbackURL: "https://evil.invalid" }), "revoke")).status, 400);
    assert.equal((await accountSettings(request({ password: "x".repeat(3000) }), "delete")).status, 413);
    assert.equal(calls.length, 0);
    const extended = await accountSettings(request(), "extend");
    assert.equal(extended.status, 200);
    assert.equal(calls[0].init.body, undefined);
    assert.equal(calls[0].url, "http://127.0.0.1:5175/api/account/session/extend");
    assert.deepEqual(extended.headers.getSetCookie(), [
      "better-auth.session_token=fixture; Max-Age=2592000; HttpOnly; Path=/",
      "better-auth.session_data=; Max-Age=0; Path=/",
    ]);
    const revoked = await accountSettings(request(), "revoke");
    assert.equal(revoked.status, 200);
    assert.deepEqual(revoked.headers.getSetCookie(), ["better-auth.session_data=; Max-Age=0; Path=/"]);
    assert.equal(calls[1].url, "http://127.0.0.1:5175/api/auth/revoke-sessions");
    const deleted = await accountSettings(request({ password: "fixture-password" }), "delete");
    assert.deepEqual(await deleted.json(), { success: true });
    assert.deepEqual(JSON.parse(calls[2].init.body), { password: "fixture-password", callbackURL: "http://127.0.0.1:5175" });
    verification = true;
    assert.equal((await accountSettings(request({ password: "fixture-password" }), "delete")).status, 502, "Do not pretend that a pending verification deleted the account");
    fail = true;
    const rejected = await accountSettings(request({ password: "fixture-password" }), "delete");
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).error.code, "INVALID_PASSWORD");
    assert.equal(rejected.headers.get("set-cookie"), null);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
