import assert from "node:assert/strict";
import test from "node:test";
import process from "node:process";
import { authIpAddressConfiguration } from "./ip-address.ts";
import { platformForwardHeaders } from "../proxy.ts";

const { Headers, Request, URL } = globalThis;
process.env.NODE_ENV = "production";
const { getIP } = await import("@better-auth/core/utils/ip");
// Exercise the installed limiter, including its login-specific 3-per-10s rule.
const { onRequestRateLimit } = await import(new URL("./api/rate-limiter/index.mjs", import.meta.resolve("better-auth")));

test("trusted proxy login buckets separate visitors but still throttle one IP", async () => {
  const previous = process.env.BETA_TRUST_PROXY_HEADERS;
  process.env.BETA_TRUST_PROXY_HEADERS = "1";
  try {
    const options = { advanced: { ipAddress: authIpAddressConfiguration() }, plugins: [] };
    const context = { baseURL: "https://riic.test/api/auth", options,
      rateLimit: { enabled: true, storage: "memory", window: 10, max: 100 }, logger: { warn: message => assert.fail(message) } };
    const request = ip => new Request("https://riic.test/api/auth/sign-in/email", { method: "POST",
      headers: platformForwardHeaders(new Request("https://dj.riic.test/api/auth/sign-in/email", { headers: { "x-real-ip": ip } })) });
    for (let index = 1; index <= 20; index++) {
      const current = request('198.51.100.' + index);
      assert.equal(getIP(current, options), '198.51.100.' + index);
      assert.equal(await onRequestRateLimit(current, context), undefined);
    }
    for (let index = 0; index < 2; index++) assert.equal(await onRequestRateLimit(request("198.51.100.1"), context), undefined);
    assert.equal((await onRequestRateLimit(request("198.51.100.1"), context)).status, 429);
    assert.equal(getIP(new Headers({ "x-real-ip": "198.51.100.1", "x-forwarded-for": "203.0.113.1", "cf-connecting-ip": "203.0.113.2" }), options), "198.51.100.1");
    assert.equal(getIP(new Headers({ "x-forwarded-for": "203.0.113.1" }), options), null);
  } finally {
    if (previous === undefined) delete process.env.BETA_TRUST_PROXY_HEADERS;
    else process.env.BETA_TRUST_PROXY_HEADERS = previous;
  }
});

test("an untrusted connection cannot choose a bucket using spoofed forwarding headers", () => {
  const headers = new Headers({ "x-real-ip": "198.51.100.30", "x-forwarded-for": "203.0.113.1", "cf-connecting-ip": "203.0.113.2" });
  assert.equal(getIP(headers, { advanced: { ipAddress: authIpAddressConfiguration(false) } }), null);
});
