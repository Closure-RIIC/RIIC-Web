import assert from "node:assert/strict";
import test from "node:test";
import { localTestAuthResponse, localTestSession } from "./local-test-account.ts";

test("local test auth is loopback-only, disabled in production and never returns passwords", async () => {
  const previous = { ...process.env };
  try {
    process.env.APP_DEPLOYMENT_ENV = "local";
    process.env.NODE_ENV = "development";
    const headers = { host: "localhost:5174", cookie: "aic_local_test_account=enabled" };
    const request = () => new Request("http://localhost:5174/api/auth/get-session", { headers });
    assert.equal(localTestSession(request())?.session.id, "local-test-session");
    assert.equal(localTestSession(new Headers({ ...headers, host: "example.com" })), null);
    assert.equal(localTestSession(new Headers({ ...headers, host: "[invalid" })), null);
    process.env.NODE_ENV = "production";
    assert.equal(localTestSession(request()), null);
    process.env.NODE_ENV = "development";
    process.env.APP_DEPLOYMENT_ENV = "development";
    assert.equal(localTestSession(request()), null);
    process.env.APP_DEPLOYMENT_ENV = "local";
    const signIn = (origin: string) => new Request("http://localhost:5174/api/auth/sign-in/email", {
      method: "POST", headers: { ...headers, origin, "content-type": "application/json" },
      body: JSON.stringify({ email: process.env.LOCAL_TEST_ACCOUNT_EMAIL ?? "codex.test@local.dev", password: process.env.LOCAL_TEST_ACCOUNT_PASSWORD ?? "CodexTest-5174-Local!" }),
    });
    assert.equal((await localTestAuthResponse(signIn("http://example.com")))?.status, 403);
    const response = await localTestAuthResponse(signIn("http://localhost:5174"));
    assert.equal(response?.status, 200);
    assert.equal("password" in (await response!.json()).user, false);
    assert.match(response!.headers.get("set-cookie")!, /HttpOnly/);
    const logout = await localTestAuthResponse(new Request("http://localhost:5174/api/auth/sign-out", { method: "POST", headers }));
    assert.match(logout!.headers.get("set-cookie")!, /Max-Age=0/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
