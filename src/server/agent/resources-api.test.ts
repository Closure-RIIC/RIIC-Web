import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import test from "node:test";
register("../../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) { return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context); } });
test("resources reject unauthenticated, non-admin and cross-origin reads/writes before private access", async t => {
  let role = "guest"; let sameOrigin = true; const calls: string[] = [];
  class PublicApiError extends Error {} class BillingAdminError extends Error {}
  await t.mock.module(new URL("../api-contract.ts", import.meta.url), { namedExports: {
    PublicApiError, createRequestId: () => "test", assertSameOrigin: () => { calls.push("origin"); if (!sameOrigin) throw new Error("cross-origin"); }, enforceRateLimit: () => {},
    readJsonBody: (request: Request) => request.json(), successResponse: (data: unknown) => Response.json({ data }), failureResponse: () => Response.json({ error: "denied" }, { status: 403 }),
  } });
  await t.mock.module(new URL("../auth/authorization.ts", import.meta.url), { namedExports: { requireWebsiteAdmin: async () => { calls.push("auth"); if (role !== "admin") throw new Error("denied"); return { session: { user: { id: "verified-admin" } } }; } } });
  await t.mock.module(new URL("../db/index.ts", import.meta.url), { namedExports: { getDatabasePool: () => ({ query: async () => { calls.push("read"); return { rows: [] }; } }) } });
  await t.mock.module(new URL("./resources.ts", import.meta.url), { namedExports: { importAgentResources: () => { calls.push("import"); return {}; } } });
  await t.mock.module(new URL("../billing/admin.ts", import.meta.url), { namedExports: { BillingAdminError, changeAgentPolicy: (actor: string, body: { kind: string }) => { assert.equal(actor, "verified-admin"); assert.equal(body.kind, "resources"); calls.push("write"); return {}; } } });
  const { GET, POST } = await import("../../app/api/admin/agent/resources/route.ts");
  const post = (action = "draft") => new Request("https://riic.test/api/admin/agent/resources", { method: "POST", body: JSON.stringify({ action, actor: "forged", kind: "rates" }) });
  for (role of ["guest", "user", "reviewer"]) {
    calls.length = 0; assert.equal((await GET(new Request("https://riic.test/api/admin/agent/resources"))).status, 403);
    assert.equal((await POST(post("import"))).status, 403); assert.deepEqual(calls, ["auth", "auth"]);
  }
  role = "admin"; sameOrigin = false; calls.length = 0;
  assert.equal((await POST(post())).status, 403); assert.deepEqual(calls, ["auth", "origin"]);
  sameOrigin = true; calls.length = 0;
  const response = await POST(post()); assert.equal(response.status, 200); assert.deepEqual(calls, ["auth", "origin", "write"]); assert.equal(response.headers.get("cache-control"), "no-store");
  calls.length = 0; await POST(post("import")); assert.deepEqual(calls, ["auth", "origin", "import"]);
});
