import assert from "node:assert/strict";
import test from "node:test";
import { isPlatformPath, platformOrigin, platformForwardHeaders } from "./proxy.ts";

test("platform routing is limited to shared endpoints and explicit destinations", () => {
  assert.equal(isPlatformPath("/api/workspace"), true);
  assert.equal(isPlatformPath("/api/endfield/skland/sync"), true);
  assert.equal(isPlatformPath("/api/plan"), false);
  assert.equal(isPlatformPath("/api/admin/users"), false);
  assert.equal(platformOrigin("http://127.0.0.1:5177").port, "5177");
  for (const value of ["https://user:password@host.test", "https://host.test/path", "http://host.test", "https://host.test?url=other"]) assert.throws(() => platformOrigin(value));
});

test("proxy preserves browser origin and replaces spoofed forwarding headers", () => {
  const request = new Request("https://endfield.riic.test/api/skland/sync", { headers: { origin: "https://endfield.riic.test", "x-forwarded-host": "evil.test", "x-forwarded-proto": "http", cookie: "better-auth.session_token=fixture" } });
  const headers = platformForwardHeaders(request);
  assert.equal(headers.get("origin"), "https://endfield.riic.test");
  assert.equal(headers.get("x-forwarded-host"), "endfield.riic.test");
  assert.equal(headers.get("x-forwarded-proto"), "https");
  assert.equal(headers.get("cookie"), "better-auth.session_token=fixture");
});
