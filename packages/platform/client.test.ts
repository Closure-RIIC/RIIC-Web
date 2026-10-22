import assert from "node:assert/strict";
import test from "node:test";
import { createPlatformClient, PlatformRequestError } from "./client.ts";

test("shared client confines requests to the current app and validates errors", async () => {
  const client = createPlatformClient(async (input, options) => {
    assert.equal(input, "/api/skland/sync");
    assert.equal(options?.credentials, "same-origin");
    return Response.json({ success: false, error: { code: "RATE_LIMIT", message: "Retry later" } }, { status: 429, headers: { "retry-after": "12" } });
  });
  await assert.rejects(client.request("https://other.test/api/session"), /same-origin/);
  await assert.rejects(client.request("/api/skland/sync", { body: {} }), error => {
    assert.ok(error instanceof PlatformRequestError);
    assert.equal(error.retryable, true); assert.equal(error.retryAfterSeconds, 12); assert.equal(error.code, "RATE_LIMIT");
    return true;
  });
});

test("shared client applies the caller's runtime decoder to successful data", async () => {
  const client = createPlatformClient(async () => Response.json({ success: true, data: { value: 7, private: "discard" } }));
  const result = await client.request("/api/example", { decode: value => {
    assert.ok(value && typeof value === "object" && "value" in value && typeof value.value === "number");
    return value.value;
  } });
  assert.equal(result, 7);
});
