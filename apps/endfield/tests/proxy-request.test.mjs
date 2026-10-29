import test from "node:test";
import assert from "node:assert/strict";
import { restoreHttpsProxyRequest } from "../src/server/proxy-request.ts";

function proxiedRequest(peer, proto = "https") {
  const request = new Request("http://endfield.example.test/api/auth/sign-in/email?source=dialog", {
    method: "POST", headers: { "x-forwarded-proto": proto, "x-forwarded-host": "untrusted.example", "x-forwarded-for": "127.0.0.1", origin: "https://endfield.example.test", "content-type": "application/json" },
    body: JSON.stringify({ email: "fixture@example.test", password: "fixture-only-password" }),
  });
  if (peer) Object.assign(request, { runtime: { node: { req: { socket: { remoteAddress: peer } } } } });
  return request;
}

test("local TLS ingress restores HTTPS while preserving the host, path, body and cancellation", async () => {
  for (const peer of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    const original = proxiedRequest(peer);
    const controller = new AbortController();
    const request = new Request(original, { signal: controller.signal });
    Object.assign(request, { runtime: original.runtime });
    const restored = restoreHttpsProxyRequest(request);
    assert.equal(restored.url, "https://endfield.example.test/api/auth/sign-in/email?source=dialog");
    assert.equal(restored.method, "POST");
    assert.equal(restored.headers.get("origin"), "https://endfield.example.test");
    assert.deepEqual(await restored.json(), { email: "fixture@example.test", password: "fixture-only-password" });
    controller.abort();
    assert.equal(restored.signal.aborted, true);
  }
});

test("forwarded headers cannot establish trust or supply an invalid protocol", () => {
  for (const request of [proxiedRequest(), proxiedRequest("203.0.113.10"), proxiedRequest("127.0.0.1", "https, http"), proxiedRequest("127.0.0.1", "javascript"), proxiedRequest("127.0.0.1", "http")]) {
    assert.equal(restoreHttpsProxyRequest(request), request);
    assert.match(request.url, /^http:/);
  }
});
