import assert from "node:assert/strict";
import test from "node:test";
import { forwardEndfieldSkland } from "../src/server/skland-proxy.ts";

test("Skland proxy constrains destinations, origin, body, cookies and methods", async () => {
  const oldEnv = process.env.NODE_ENV, oldOrigin = process.env.ENDFIELD_ACCOUNT_ORIGIN, oldFetch = globalThis.fetch;
  process.env.NODE_ENV = "development"; process.env.ENDFIELD_ACCOUNT_ORIGIN = "http://127.0.0.1:5175";
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const headers = new Headers({ "content-type": "application/json" });
    headers.append("set-cookie", "skland_endfield_v1=sealed; HttpOnly; Path=/; SameSite=Lax");
    headers.append("set-cookie", "skland_endfield_account_v1_12345678=sealed; HttpOnly; Path=/; SameSite=Lax");
    headers.append("set-cookie", "better-auth.session_token=bad; Path=/");
    headers.append("set-cookie", "unrelated=bad; Path=/");
    headers.append("set-cookie", "skland_account_v3_12345678=bad; Domain=riic.autos");
    return new Response('{"success":true,"data":{}}', { headers });
  };
  const request = (changes = {}) => new Request("http://127.0.0.1:5176/api/skland/sync", {
    method: "POST", headers: { origin: "http://127.0.0.1:5176", "content-type": "application/json",
      cookie: "private=hidden; better-auth.session_token=fixture; skland_accounts_v3=owned; skland_account_v3_12345678=sealed; skland_endfield_v1=direct; skland_endfield_account_v1_12345678=second" },
    body: "{}", ...changes,
  });
  try {
    const response = await forwardEndfieldSkland(request(), "sync");
    assert.equal(response.status, 200);
    assert.equal(calls[0].url, "http://127.0.0.1:5175/api/endfield/skland/sync");
    assert.equal(calls[0].init.redirect, "error");
    assert.equal(calls[0].init.headers.origin, "http://127.0.0.1:5175");
    assert.doesNotMatch(calls[0].init.headers.cookie, /private|hidden/);
    assert.equal(response.headers.getSetCookie().length, 2);
    assert.match(calls[0].init.headers.cookie, /skland_endfield_account_v1_12345678=second/);
    assert.match(response.headers.get("set-cookie"), /^skland_endfield_v1=/);
    assert.match(response.headers.get("cache-control"), /private, no-store/);
    for (const [req, action, status] of [
      [request(), "../auth/sign-out", 404],
      [request({ headers: { origin: "https://evil.invalid" } }), "sync", 403],
      [request({ headers: { origin: "http://127.0.0.1:5176" } }), "sync", 401],
      [request({ body: "x".repeat(17000) }), "credential", 413],
    ]) assert.equal((await forwardEndfieldSkland(req, action)).status, status);
    assert.equal(calls.length, 1, "Rejected requests never reach upstream");
    const broken = new ReadableStream({ start(controller) { controller.error(new Error("aborted")); } });
    assert.equal((await forwardEndfieldSkland(request({ body: broken, duplex: "half" }), "sync")).status, 400);
    globalThis.fetch = async () => { throw new Error("secret upstream detail"); };
    const unavailable = await forwardEndfieldSkland(request(), "roles");
    assert.equal(unavailable.status, 502);
    assert.doesNotMatch(await unavailable.text(), /secret/);
    process.env.NODE_ENV = "production";
    assert.equal((await forwardEndfieldSkland(request(), "sync")).status, 503);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv;
    if (oldOrigin === undefined) delete process.env.ENDFIELD_ACCOUNT_ORIGIN; else process.env.ENDFIELD_ACCOUNT_ORIGIN = oldOrigin;
  }
});
