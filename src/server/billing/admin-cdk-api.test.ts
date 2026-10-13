import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import test from "node:test";
import { CdkValidationError } from "./cdk.ts";

register("../../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) {
  return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context);
} });

test("admin code endpoints require administrator access, origin checks and rate limits before granting", async (t) => {
  let role = "guest";
  let originAllowed = true;
  let rateAllowed = true;
  let invalidInput = false;
  const calls: string[] = [];
  class PublicApiError extends Error {}
  await t.mock.module(new URL("../api-contract.ts", import.meta.url), { namedExports: {
    PublicApiError,
    createRequestId: () => "request-id",
    assertSameOrigin: () => { calls.push("origin"); if (!originAllowed) throw new Error("origin denied"); },
    enforceRateLimit: () => { calls.push("rate"); if (!rateAllowed) throw new Error("rate limited"); },
    readJsonBody: (request: Request) => request.json(),
    successResponse: (data: unknown, requestId: string, status = 200) => Response.json({ success: true, data, requestId }, { status }),
    failureResponse: (error: Error) => Response.json({ error: error.message }, { status: error instanceof PublicApiError ? 400 : 403 }),
  } });
  await t.mock.module(new URL("../auth/authorization.ts", import.meta.url), { namedExports: {
    requireWebsiteAdmin: async () => { calls.push("auth"); if (role !== "admin") throw new Error("access denied"); return { session: { user: { id: "authenticated-admin" } } }; },
  } });
  await t.mock.module(new URL("./admin-cdk.ts", import.meta.url), { namedExports: {
    listAdminCdks: async () => { calls.push("list"); return []; },
    issueAdminCdks: async (issuer: string, input: unknown) => { calls.push("issue"); assert.equal(issuer, "authenticated-admin"); assert.ok(input); if (invalidInput) throw new CdkValidationError("invalid"); return { codes: ["PROMOTION-30"], points: 30 }; },
    revokeAdminCdks: async (issuer: string) => { calls.push("revoke"); assert.equal(issuer, "authenticated-admin"); return { revoked: 1 }; },
  } });
  const { GET, POST, PATCH } = await import("../../app/api/admin/billing/cdk/route.ts");
  const request = () => new Request("https://riic.test/api/admin/billing/cdk", { method: "POST", body: JSON.stringify({ issuerUserId: "forged", count: 20, points: 30 }) });
  for (role of ["guest", "user", "reviewer"]) {
    assert.equal((await PATCH(new Request(request(), { method: "PATCH" }))).status, 403);
    calls.length = 0;
    assert.equal((await POST(request())).status, 403);
    assert.deepEqual(calls, ["auth"]);
    calls.length = 0;
    assert.equal((await GET(new Request("https://riic.test/api/admin/billing/cdk"))).status, 403);
    assert.deepEqual(calls, ["auth"]);
  }
  role = "admin";
  originAllowed = false;
  calls.length = 0;
  assert.equal((await POST(request())).status, 403);
  assert.deepEqual(calls, ["auth", "origin"]);
  originAllowed = true;
  rateAllowed = false;
  calls.length = 0;
  assert.equal((await POST(request())).status, 403);
  assert.deepEqual(calls, ["auth", "origin", "rate"]);
  rateAllowed = true;
  calls.length = 0;
  const response = await POST(request());
  assert.equal(response.status, 201);
  assert.match(response.headers.get("Cache-Control")!, /private, no-store/);
  assert.deepEqual(calls, ["auth", "origin", "rate", "issue"]);
  invalidInput = true;
  const invalid = await POST(request());
  assert.equal(invalid.status, 400);
  assert.match(invalid.headers.get("Cache-Control")!, /no-store/);
  calls.length = 0;
  assert.equal((await GET(new Request("https://riic.test/api/admin/billing/cdk"))).status, 200);
  assert.deepEqual(calls, ["auth", "list"]);
  calls.length = 0;
  assert.equal((await PATCH(new Request(request(), { method: "PATCH" }))).status, 200);
  assert.deepEqual(calls, ["auth", "origin", "rate", "revoke"]);
});
