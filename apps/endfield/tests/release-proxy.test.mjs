import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  return specifier === "@tanstack/react-start/server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context);
} });
const { forwardEndfieldReleases } = await import("../src/server/release-proxy.ts");

test("release bridge restricts origin, methods, body and credentials for both service topologies", async context => {
  const oldFetch = globalThis.fetch;
  const names = ["NODE_ENV", "ENDFIELD_ACCOUNT_ORIGIN", "PLATFORM_API_ORIGIN"];
  const previous = names.map(name => process.env[name]);
  context.after(() => {
    globalThis.fetch = oldFetch;
    names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
  });
  process.env.NODE_ENV = "development";
  process.env.ENDFIELD_ACCOUNT_ORIGIN = "http://127.0.0.1:5175";
  delete process.env.PLATFORM_API_ORIGIN;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), ...init, headers: new Headers(init.headers) });
    return Response.json({ success: true, data: { releases: [] } }, { headers: { "Set-Cookie": "secret=upstream", "X-Internal": "private" } });
  };
  const origin = "https://dj.riic.test";
  const make = (path, method = "GET", changes = {}) => new Request(origin + path, {
    method, headers: { origin, "content-type": "application/json", cookie: "private=hidden; better-auth.session_token=fixture; skland_accounts_v3=private" },
    ...(method === "GET" ? {} : { body: "{}" }), ...changes,
  });
  const publicResponse = await forwardEndfieldReleases(make("/api/endfield/releases"));
  assert.equal(publicResponse.status, 200);
  assert.equal(calls[0].headers.has("cookie"), false, "public reads never send account cookies");
  assert.equal(publicResponse.headers.get("set-cookie"), null);
  assert.equal(publicResponse.headers.get("x-internal"), null);
  const path = "/api/endfield/admin/releases";
  await forwardEndfieldReleases(make(path, "POST"));
  assert.equal(calls[1].headers.get("cookie"), "better-auth.session_token=fixture");
  assert.equal(calls[1].headers.get("origin"), "http://127.0.0.1:5175");
  assert.equal(calls[1].redirect, "error");
  for (const [req, status] of [
    [make("/api/admin/releases"), 404], [make("/api/endfield/releases", "POST"), 405],
    [make(path, "POST", { headers: { origin: "https://evil.test" } }), 403],
    [make(path, "POST", { headers: { origin } }), 401],
    [make(path, "POST", { body: "x".repeat(128 * 1024 + 1) }), 413],
    [make(path, "POST", { body: "broken" }), 400],
  ]) assert.equal((await forwardEndfieldReleases(req)).status, status);
  assert.equal(calls.length, 2, "invalid requests do not reach the account service");
  process.env.PLATFORM_API_ORIGIN = "http://127.0.0.1:5177";
  await forwardEndfieldReleases(make(path + "/id", "PATCH"));
  assert.equal(calls[2].url, "http://127.0.0.1:5177" + path + "/id");
  assert.equal(calls[2].headers.get("origin"), origin);
  assert.equal(calls[2].headers.get("x-forwarded-host"), "dj.riic.test");
  globalThis.fetch = async () => { throw new Error("private connection details"); };
  const failure = await forwardEndfieldReleases(make(path));
  assert.equal(failure.status, 502);
  assert.doesNotMatch(await failure.text(), /private connection/);
});
