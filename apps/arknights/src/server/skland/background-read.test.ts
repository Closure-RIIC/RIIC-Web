import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import test from "node:test";

register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);
const hook = registerHooks({ resolve(specifier, context, next) {
  return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context);
} });
process.once("exit", () => hook.deregister());

test("background training and inventory reads cannot write selection cookies, including late responses", async context => {
  const account = { accountId: "account-a", session: { selectedUid: "role-a" } };
  let release: (() => void) | undefined;
  let waiting: Promise<void> = Promise.resolve();
  let role = "role-a";
  await context.mock.module(new URL("../../../../../packages/platform-server/src/api-contract.ts", import.meta.url), { namedExports: {
    assertEmptyBody: async () => undefined, assertSameOrigin: () => undefined,
    createRequestId: () => "request-id", enforceRateLimit: () => undefined, requestClientIp: () => "127.0.0.1",
    successResponse: (data: unknown) => Response.json({ success: true, data }),
  } });
  await context.mock.module(new URL("../../../../../packages/platform-server/src/auth/authorization.ts", import.meta.url), { namedExports: {
    requireWebsiteSession: async () => ({ user: { id: "verified-user" } }),
  } });
  await context.mock.module(new URL("../../../../../packages/platform-server/src/skland/http.ts", import.meta.url), { namedExports: {
    assertSklandFeatureEnabled: () => undefined, assertSklandAvailable: () => undefined,
    readSklandAccountStore: async (id: string) => {
      assert.equal(id, "verified-user");
      return { accounts: [account], activeAccountId: account.accountId };
    },
    activeSklandAccount: () => account,
    sklandAccountSummaries: () => [{ accountId: account.accountId, selectedUid: "role-a" }],
    setSklandAccountStoreCookies: () => { throw new Error("A background read must never write selection cookies"); },
    sklandErrorResponse: () => Response.json({ success: false }, { status: 409 }),
  } });
  await context.mock.module(new URL("../../../../../packages/platform-server/src/skland/adapter.ts", import.meta.url), { namedExports: {
    SklandServiceError: Error,
    syncSessionSnapshot: async () => {
      await waiting;
      return { session: { selectedUid: role }, snapshot: { operbox: [] }, statusSnapshot: {} };
    },
    loadInventorySnapshot: async () => {
      await waiting;
      return { session: account.session, inventory: { items: [], fetchedAt: "2026-09-23" } };
    },
  } });
  const { POST } = await import("@riic/platform-server/http/skland/training-sync/route");
  const { handleGetSklandInventory } = await import("@riic/platform-server/skland/inventory-api");
  waiting = new Promise<void>(resolve => { release = resolve; });
  const training = POST(new Request("https://riic.test/api/skland/training-sync", { method: "POST" }));
  const inventory = handleGetSklandInventory(new Request("https://riic.test/api/skland/inventory"), "/api/skland/inventory");
  release!();
  for (const response of await Promise.all([training, inventory])) {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  role = "other-role";
  const rejected = await POST(new Request("https://riic.test/api/skland/training-sync", { method: "POST" }));
  assert.equal(rejected.status, 409);
  assert.equal(rejected.headers.get("set-cookie"), null);
});
