import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import test from "node:test";

register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);
const serverOnlyHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@tanstack/react-start/server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export{}" };
    }
    return nextResolve(specifier, context);
  },
});
process.once("exit", () => serverOnlyHook.deregister());

test("account-data deletion uses the verified website user and unbinds it after owned data is removed", async (context) => {
  const calls: unknown[] = [];
  const previous = {
    accounts: [
      { accountId: "account-a", session: { userId: "skland-user-a" } },
      { accountId: "account-b", session: { userId: "skland-user-b" } },
    ],
    activeAccountId: "account-a",
    migratedSnapshot: { sourceName: "Skland" },
    websiteOwnerTag: "owner-tag",
  };

  await context.mock.module(new URL("../api-contract.ts", import.meta.url), {
    namedExports: {
      assertEmptyBody: async () => calls.push("empty-body"),
      assertSameOrigin: () => calls.push("same-origin"),
      createRequestId: () => "request-id",
      enforceRateLimit: () => calls.push("rate-limit"),
      requestClientIp: () => "127.0.0.1",
      successResponse: (data: unknown, requestId: string) => Response.json({ success: true, data, requestId }),
    },
  });
  await context.mock.module(new URL("../auth/authorization.ts", import.meta.url), {
    namedExports: {
      requireWebsiteSession: async () => ({ user: { id: "website-user" } }),
    },
  });
  await context.mock.module(new URL("../infra.ts", import.meta.url), {
    namedExports: {
      deleteSklandOwnedData: async (ownerTags: string[]) => {
        calls.push(["delete-owned", ownerTags]);
        return { runs: ownerTags.length, feedback: ownerTags.length > 0 ? 1 : 0 };
      },
    },
  });
  await context.mock.module(new URL("../plan-cache.ts", import.meta.url), {
    namedExports: {
      evictSklandPlanCaches: async (userId: string) => calls.push(["evict-cache", userId]),
    },
  });
  await context.mock.module(new URL("./bindings.ts", import.meta.url), {
    namedExports: {
      removeSklandBindings: async (websiteUserId: string) => calls.push(["remove-bindings", websiteUserId]),
    },
  });
  await context.mock.module(new URL("./http.ts", import.meta.url), {
    namedExports: {
      assertSklandAvailable: () => calls.push("available"),
      assertSklandFeatureEnabled: () => calls.push("enabled"),
      readSklandAccountStore: async (websiteUserId: string) => {
        calls.push(["read-store", websiteUserId]);
        return previous;
      },
      setSklandAccountStoreCookies: (_response: Response, _request: Request, next: unknown, prior: unknown) => {
        calls.push(["set-cookies", next, prior]);
      },
      sklandErrorResponse: (error: unknown) => Response.json({ error: String(error) }, { status: 500 }),
    },
  });
  await context.mock.module(new URL("./session.ts", import.meta.url), {
    namedExports: {
      sklandDataOwnerTag: (userId: string) => `owner:${userId}`,
    },
  });

  const { handleDeleteSklandAccountData } = await import("./account-data-api.ts");
  const response = await handleDeleteSklandAccountData(
    new Request("https://riic.test/api/skland/account-data", { method: "DELETE" }),
    "/api/skland/account-data",
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    data: { deleted: true, runs: 2, feedback: 1 },
    requestId: "request-id",
  });

  const readStoreIndex = calls.findIndex((entry) => Array.isArray(entry) && entry[0] === "read-store");
  const deleteOwnedIndex = calls.findIndex((entry) => Array.isArray(entry) && entry[0] === "delete-owned");
  const removeBindingsIndex = calls.findIndex((entry) => Array.isArray(entry) && entry[0] === "remove-bindings");
  const setCookiesIndex = calls.findIndex((entry) => Array.isArray(entry) && entry[0] === "set-cookies");
  assert.ok(readStoreIndex >= 0 && deleteOwnedIndex > readStoreIndex);
  const evictCacheIndex = calls.findIndex((entry) => Array.isArray(entry) && entry[0] === "evict-cache");
  assert.ok(evictCacheIndex > readStoreIndex && evictCacheIndex < deleteOwnedIndex);
  assert.deepEqual(calls[evictCacheIndex], ["evict-cache", "website-user"]);
  assert.ok(removeBindingsIndex > deleteOwnedIndex);
  assert.ok(setCookiesIndex > removeBindingsIndex);
  assert.deepEqual(calls[readStoreIndex], ["read-store", "website-user"]);
  assert.deepEqual(calls[deleteOwnedIndex], ["delete-owned", ["owner:skland-user-a", "owner:skland-user-b"]]);
  assert.deepEqual(calls[removeBindingsIndex], ["remove-bindings", "website-user"]);
  assert.deepEqual(calls[setCookiesIndex], [
    "set-cookies",
    {
      ...previous,
      accounts: [],
      activeAccountId: null,
      migratedSnapshot: null,
    },
    previous,
  ]);

  previous.accounts = [];
  calls.length = 0;
  const emptyResponse = await handleDeleteSklandAccountData(
    new Request("https://riic.test/api/skland/account-data", { method: "DELETE" }),
    "/api/skland/account-data",
  );
  assert.deepEqual(await emptyResponse.json(), {
    success: true,
    data: { deleted: true, runs: 0, feedback: 0 },
    requestId: "request-id",
  });
  assert.deepEqual(
    calls.find((entry) => Array.isArray(entry) && entry[0] === "delete-owned"),
    ["delete-owned", []],
  );
  assert.deepEqual(
    calls.find((entry) => Array.isArray(entry) && entry[0] === "remove-bindings"),
    ["remove-bindings", "website-user"],
  );
  assert.deepEqual(
    calls.find((entry) => Array.isArray(entry) && entry[0] === "evict-cache"),
    ["evict-cache", "website-user"],
  );
});
