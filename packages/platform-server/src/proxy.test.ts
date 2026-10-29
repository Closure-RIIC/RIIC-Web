import assert from "node:assert/strict";
import test from "node:test";
import { isPlatformPath, platformOrigin, platformForwardHeaders } from "./proxy.ts";
import { endfieldWriteOriginAllowed } from "./releases/origin.ts";

test("platform routing is limited to shared endpoints and explicit destinations", () => {
  assert.equal(isPlatformPath("/api/workspace"), true);
  assert.equal(isPlatformPath("/api/endfield/skland/sync"), true);
  for (const path of ["/api/endfield/releases", "/api/endfield/admin/releases", "/api/endfield/admin/releases/id", "/api/endfield/admin/access"]) assert.equal(isPlatformPath(path), true);
  for (const path of ["/api/endfield/admin/users", "/api/endfield/releases/id", "/api/endfield/admin/releases/id/more"]) assert.equal(isPlatformPath(path), false);
  assert.equal(isPlatformPath("/api/plan"), false);
  assert.equal(isPlatformPath("/api/admin/users"), false);
  assert.equal(platformOrigin("http://127.0.0.1:5177").port, "5177");
  for (const field of ["username", "password"] as const) {
    const destination = new URL("https://host.test");
    destination[field] = "fixture";
    assert.throws(() => platformOrigin(destination.href));
  }
  for (const value of ["https://host.test/path", "http://host.test", "https://host.test?url=other"]) assert.throws(() => platformOrigin(value));
});

test("proxy preserves browser origin and replaces spoofed forwarding headers", () => {
  const request = new Request("https://endfield.riic.test/api/skland/sync", { headers: { origin: "https://endfield.riic.test", "x-forwarded-host": "evil.test", "x-forwarded-proto": "http", cookie: "better-auth.session_token=fixture" } });
  const headers = platformForwardHeaders(request);
  assert.equal(headers.get("origin"), "https://endfield.riic.test");
  assert.equal(headers.get("x-forwarded-host"), "endfield.riic.test");
  assert.equal(headers.get("x-forwarded-proto"), "https");
  assert.equal(headers.get("cookie"), "better-auth.session_token=fixture");
});

test("Endfield release writes use the browser origin through a trusted compatibility host", () => {
  const make = (headers: HeadersInit) => new Request("http://127.0.0.1:4175/api/endfield/admin/releases", { method: "POST", headers });
  const forwarded = { origin: "https://dj.riic.autos", "x-forwarded-host": "dj.riic.autos", "x-forwarded-proto": "https" };
  assert.equal(endfieldWriteOriginAllowed(make(forwarded), true), true);
  assert.equal(endfieldWriteOriginAllowed(make(forwarded), false), false, "untrusted forwarded headers cannot change the origin");
  for (const headers of [{}, { ...forwarded, origin: "https://evil.test" }, { ...forwarded, "x-forwarded-proto": "javascript" },
    { ...forwarded, "x-forwarded-host": "evil.test@dj.riic.autos" }, { origin: forwarded.origin, "x-forwarded-host": forwarded["x-forwarded-host"] }]) {
    assert.equal(endfieldWriteOriginAllowed(make(headers), true), false);
  }
  assert.equal(endfieldWriteOriginAllowed(new Request("https://dj.riic.autos/api/endfield/admin/releases", { method: "POST", headers: { origin: "https://dj.riic.autos" } }), false), true);
});
