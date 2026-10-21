import test from "node:test";
import assert from "node:assert/strict";
import { readAccountSession } from "../src/server/account-session.ts";

test("account bridge is read-only, strips unrelated cookies and returns only a session view", async () => {
  const oldEnv = process.env.NODE_ENV;
  const oldOrigin = process.env.ENDFIELD_ACCOUNT_ORIGIN;
  const oldFetch = globalThis.fetch;
  process.env.NODE_ENV = "development";
  process.env.ENDFIELD_ACCOUNT_ORIGIN = "http://127.0.0.1:5175";
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { url: String(url), init };
    return Response.json({ user: { id: "test-user", name: "Test", email: "test@example.invalid", privateField: "hidden" }, session: { expiresAt: "2099-01-01", token: "not-for-client" } }, { headers: { "set-cookie": "do-not-copy=secret" } });
  };
  try {
    const response = await readAccountSession(new Request("http://127.0.0.1:5176/api/auth/get-session", { headers: { cookie: "unrelated=private; better-auth.session_token=test-session; riic-locale=zh" } }));
    assert.equal(response.status, 200);
    assert.equal(seen.init.headers.cookie, "better-auth.session_token=test-session");
    assert.equal(seen.init.redirect, "error");
    assert.equal(seen.url, "http://127.0.0.1:5175/api/auth/get-session?disableCookieCache=true&disableRefresh=true");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.deepEqual(await response.json(), { user: { id: "test-user", name: "Test", email: "test@example.invalid" }, session: { expiresAt: "2099-01-01" } });
    process.env.NODE_ENV = "production";
    delete process.env.ENDFIELD_ACCOUNT_ORIGIN;
    assert.equal((await readAccountSession(new Request("https://endfield.riic.autos/api/auth/get-session"))).status, 503);
    process.env.ENDFIELD_ACCOUNT_ORIGIN = "http://127.0.0.1:5175";
    assert.equal((await readAccountSession(new Request("https://endfield.riic.autos/api/auth/get-session"))).status, 503);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv;
    if (oldOrigin === undefined) delete process.env.ENDFIELD_ACCOUNT_ORIGIN; else process.env.ENDFIELD_ACCOUNT_ORIGIN = oldOrigin;
  }
});
