import test from "node:test";
import assert from "node:assert/strict";
import { signOutAccount } from "../src/server/account-sign-out.ts";

test("sign-out only revokes the current session, checks origin and filters cookie writes", async () => {
  const env = { NODE_ENV: process.env.NODE_ENV, ENDFIELD_ACCOUNT_ORIGIN: process.env.ENDFIELD_ACCOUNT_ORIGIN };
  const previousFetch = globalThis.fetch;
  process.env.NODE_ENV = "development";
  process.env.ENDFIELD_ACCOUNT_ORIGIN = "http://127.0.0.1:5175";
  let calls = 0;
  let fail = false;
  let malformed = false;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), "http://127.0.0.1:5175/api/auth/sign-out");
    assert.equal(init.method, "POST");
    assert.equal(init.body, "{}");
    assert.equal(init.headers.origin, "http://127.0.0.1:5175");
    assert.equal(init.headers.cookie, "better-auth.session_token=fixture");
    assert.equal(init.redirect, "error");
    if (fail) return Response.json({ error: "Unavailable" }, { status: 503 });
    if (malformed) return Response.json({ success: false });
    const response = Response.json({ success: true });
    response.headers.append("Set-Cookie", "better-auth.session_token=; Max-Age=0; Path=/; HttpOnly");
    response.headers.append("Set-Cookie", "other=; Max-Age=0");
    response.headers.append("Set-Cookie", "better-auth.session_data=unexpected; Max-Age=1000");
    response.headers.append("Set-Cookie", "better-auth.session_data=unexpected; Max-Age=1000; Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    response.headers.append("Set-Cookie", "better-auth.session_data=; Max-Age=0; Domain=unrelated.invalid");
    return response;
  };
  const request = (origin = "http://127.0.0.1:5176") => new Request("http://127.0.0.1:5176/api/auth/sign-out", {
    method: "POST", headers: { origin, cookie: "unrelated=private; better-auth.session_token=fixture" }, body: "untrusted body",
  });
  try {
    assert.equal((await signOutAccount(request("https://unrelated.invalid"))).status, 403);
    assert.equal((await signOutAccount(new Request("http://127.0.0.1:5176/api/auth/sign-out"))).status, 405);
    assert.equal(calls, 0);
    const success = await signOutAccount(request());
    assert.deepEqual(await success.json(), { success: true });
    assert.deepEqual(success.headers.getSetCookie(), ["better-auth.session_token=; Max-Age=0; Path=/; HttpOnly"]);
    assert.match(success.headers.get("cache-control"), /no-store/);
    fail = true;
    const failure = await signOutAccount(request());
    assert.equal(failure.status, 502);
    assert.equal(failure.headers.get("set-cookie"), null);
    fail = false; malformed = true;
    assert.equal((await signOutAccount(request())).status, 502);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
