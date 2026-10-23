import assert from "node:assert/strict";
import test from "node:test";
import { canAccessEndfield, endfieldNotFound } from "../src/server/admin-access.ts";

test("Endfield fails closed and only accepts the trusted account server's explicit grant", async t => {
  const environment = { ...process.env };
  const originalFetch = globalThis.fetch;
  t.after(() => { process.env = environment; globalThis.fetch = originalFetch; });
  process.env.NODE_ENV = "production";
  process.env.ENDFIELD_ACCOUNT_ORIGIN = "https://riic.autos";
  delete process.env.PLATFORM_API_ORIGIN;
  let status = 403, seen, unavailable = false;
  globalThis.fetch = async (url, options) => {
    seen = { url: String(url), options };
    if (unavailable) throw new Error("offline");
    return new Response(null, { status });
  };
  const anonymous = new Request("https://endfield.riic.autos/manual");
  assert.equal(await canAccessEndfield(anonymous), false);
  assert.equal(seen, undefined);
  const request = new Request(anonymous, { headers: {
    cookie: "unrelated=private; __Secure-better-auth.session_token=signed-token", "x-admin": "true",
  } });
  for (status of [200, 301, 401, 403, 404, 500, 503]) assert.equal(await canAccessEndfield(request), false);
  status = 204;
  assert.equal(await canAccessEndfield(request), true);
  assert.equal(seen.url, "https://riic.autos/api/platform/endfield-access");
  assert.equal(new Headers(seen.options.headers).get("cookie"), "__Secure-better-auth.session_token=signed-token");
  assert.equal(new Headers(seen.options.headers).get("x-admin"), null);
  assert.equal(seen.options.redirect, "error");
  unavailable = true;
  assert.equal(await canAccessEndfield(request), false);
  unavailable = false;
  process.env.ENDFIELD_ACCOUNT_ORIGIN = "https://endfield.riic.autos";
  assert.equal(await canAccessEndfield(request), false);
  const denied = endfieldNotFound();
  assert.equal(denied.status, 404);
  assert.match(denied.headers.get("cache-control"), /private, no-store/);
  assert.equal(denied.headers.get("vary"), "Cookie");
});
