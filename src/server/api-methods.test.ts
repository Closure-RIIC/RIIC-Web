import assert from "node:assert/strict";
import test from "node:test";
import { fallbackApiMethod } from "./api-methods.ts";

test("unsupported API methods return 405 without an HTML body", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const response = fallbackApiMethod(new Request("https://example.test/api/status", { method }), ["GET"]);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, HEAD, OPTIONS");
    assert.equal(await response.text(), "");
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("OPTIONS advertises explicit methods and only adds HEAD for GET routes", () => {
  const request = new Request("https://example.test/api/action", { method: "OPTIONS" });
  const response = fallbackApiMethod(request, ["POST", "DELETE"]);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("allow"), "DELETE, OPTIONS, POST");
});
