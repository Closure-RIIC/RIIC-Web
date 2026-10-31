import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("../../../../scripts/ts-path-loader.mjs", import.meta.url);

test("Skland HTTP errors retain the safe message, combined Retry-After and terminal retry policy", async context => {
  context.mock.method(console, "error", () => {});
  await context.mock.module(new URL("../auth/index.ts", import.meta.url), { namedExports: { websiteSession: async () => null } });
  await context.mock.module(new URL("./bindings.ts", import.meta.url), { namedExports: { SklandBindingConflictError: class extends Error {} } });
  await context.mock.module(new URL("./operator-snapshot-store.ts", import.meta.url), { namedExports: { persistOperatorSnapshot: async () => {} } });
  await context.mock.module(new URL("./layout-suggestion.ts", import.meta.url), { namedExports: { sklandLayoutSuggestion: () => ({}) } });
  await context.mock.module(new URL("../request-diagnostics.ts", import.meta.url), { namedExports: { makeDiagnostic: () => ({}), persistDiagnostic: () => {} } });
  const { SklandServiceError } = await import("./adapter.ts");
  const { sklandErrorResponse } = await import("./http.ts");
  const message = "二维码申请过于频繁，请等待 560 秒后重试。";
  const limited = sklandErrorResponse(new SklandServiceError("RATE_LIMITED", message, 429, 560), "fixture-request", "/fixture", performance.now());
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("Retry-After"), "560");
  assert.deepEqual((await limited.json()).error, {
    code: "AIC-RATE-6001", message, requestId: "fixture-request", retryable: true, retryAfterSeconds: 560,
  });
  const failed = sklandErrorResponse(new SklandServiceError("UNAVAILABLE", "森空岛登录处理超时，请重新生成二维码后重试。", 504, undefined, false), "fixture-request", "/fixture", performance.now());
  const failure = (await failed.json()).error;
  assert.equal(failure.retryable, false);
  assert.match(failure.message, /处理超时/);
  assert.equal(failed.headers.get("Retry-After"), null);
});
