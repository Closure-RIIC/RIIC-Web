import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import test from "node:test";
register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) { return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context); } });

test("pending order deletion checks origin, authentication, rate limit and owner", async t => {
  const calls: string[] = [];
  let allowed = true, authenticated = true, pending = true;
  class PublicApiError extends Error {}
  await t.mock.module(new URL("../api-contract.ts", import.meta.url), { namedExports: {
    PublicApiError, createRequestId: () => "test",
    assertSameOrigin: () => { calls.push("origin"); if (!allowed) throw new Error("origin"); },
    enforceRateLimit: () => { calls.push("rate"); },
    successResponse: (data: unknown) => Response.json({ data }),
    failureResponse: () => Response.json({ error: "denied" }, { status: 403 }),
  } });
  await t.mock.module(new URL("../auth/feature-access.ts", import.meta.url), { namedExports: {
    requireFeatureSession: () => { calls.push("auth"); if (!authenticated) throw new Error("guest"); return { user: { id: "owner" } }; },
  } });
  await t.mock.module(new URL("./service.ts", import.meta.url), { namedExports: {
    getOrder: () => null, getWallet: () => ({}),
    hidePendingOrder: (owner: string, id: string) => { calls.push("hide"); assert.equal(owner, "owner"); assert.equal(id, "order"); return pending; },
  } });
  const { DELETE } = await import("../../app/api/billing/orders/[id]/route.ts");
  const request = () => new Request("https://riic.test/api/billing/orders/order", { method: "DELETE" });
  const context = { params: Promise.resolve({ id: "order" }) };
  allowed = false;
  assert.equal((await DELETE(request(), context)).status, 403);
  assert.deepEqual(calls.splice(0), ["origin"]);
  allowed = true; authenticated = false;
  assert.equal((await DELETE(request(), context)).status, 403);
  assert.deepEqual(calls.splice(0), ["origin", "auth"]);
  authenticated = true;
  assert.equal((await DELETE(request(), context)).status, 200);
  assert.deepEqual(calls.splice(0), ["origin", "auth", "rate", "hide"]);
  pending = false;
  assert.equal((await DELETE(request(), context)).status, 403);
});
