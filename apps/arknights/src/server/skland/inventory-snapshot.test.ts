import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type { SklandSessionPayload } from "@riic/platform-server/skland/session";

register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);

test("inventory stays with the selected role, preserves zeroes, and never consults shared Mower data", async (context) => {
  await context.mock.module(new URL("../../../../../packages/platform-server/src/skland/layout-suggestion.ts", import.meta.url), { namedExports: {
    sklandLayoutSuggestion: () => null,
  } });
  await context.mock.module("skland-kit", { namedExports: {
    STORAGE_CREDENTIAL_KEY: "cred", STORAGE_DID_KEY: "did",
    STORAGE_OAUTH_TOKEN_KEY: "token", STORAGE_USER_ID_KEY: "user",
    createClient: () => ({
      storage: { setItems: async () => undefined },
      collections: { player: { getBinding: () => { throw new Error("Must not switch inventory roles"); } } },
    }),
  } });
  const requested: string[] = [];
  let items: unknown[] = [{ id: "4001", count: 0 }, { id: "30011", count: 7 }];
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    assert.equal(new URL(url).hostname, "zonai.skland.com");
    assert.equal(new URL(url).searchParams.get("uid"), "selected-role");
    return Response.json({ code: 0, data: { items } });
  });
  const { loadInventorySnapshot } = await import("@riic/platform-server/skland/adapter");
  const session = {
    version: 3, cred: "test-cred", token: "test-token", dId: "test-device",
    userId: "skland-user", selectedUid: "selected-role", refreshedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  } as SklandSessionPayload;
  const loaded = await loadInventorySnapshot(session);
  assert.equal(loaded.session.selectedUid, "selected-role");
  assert.deepEqual(loaded.inventory.items, items);
  assert.equal(requested.length, 1);
  items = [];
  assert.deepEqual((await loadInventorySnapshot(session)).inventory.items, []);
  assert.equal(requested.length, 2);
});
