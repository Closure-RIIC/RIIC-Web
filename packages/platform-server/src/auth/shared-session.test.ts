import assert from "node:assert/strict";
import test from "node:test";
import { sharedSessionConfiguration } from "./shared-session.ts";

test("cross-subdomain sessions require explicit trusted HTTPS origins", () => {
  assert.deepEqual(sharedSessionConfiguration({}), { origins: [], domain: undefined });
  const valid = { NODE_ENV: "production", AUTH_COOKIE_DOMAIN: ".riic.test", PLATFORM_PUBLIC_ORIGINS: "https://riic.test,https://endfield.riic.test" };
  assert.equal(sharedSessionConfiguration(valid).domain, "riic.test");
  for (const origins of ["https://evil.test,https://riic.test", "https://riic.test/path,https://endfield.riic.test", "http://riic.test,https://endfield.riic.test", "https://riic.test"]) {
    assert.throws(() => sharedSessionConfiguration({ ...valid, PLATFORM_PUBLIC_ORIGINS: origins }));
  }
  assert.throws(() => sharedSessionConfiguration({ ...valid, AUTH_COOKIE_DOMAIN: "com" }));
});
