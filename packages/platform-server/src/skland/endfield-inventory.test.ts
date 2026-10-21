import assert from "node:assert/strict";
import test from "node:test";
import { STORAGE_CREDENTIAL_KEY, STORAGE_DID_KEY, STORAGE_OAUTH_TOKEN_KEY } from "skland-kit";
import { createSklandRequestSignature } from "./credential.ts";
import { ENDFIELD_MATERIAL_LIST_PATH, ENDFIELD_USER_GAME_DATA_PATH, readEndfieldInventory, readEndfieldCalculatorData, type EndfieldInventoryClient } from "./endfield-inventory.ts";

const selected = { roleId: "role", serverId: "server" };
const catalog = { code: 0, data: { materials: { gold: { id: "gold", name: "Gold" } } } };
const storage = { getItem: async (key: string) =>
  ({ [STORAGE_CREDENTIAL_KEY]: "test-cred", [STORAGE_OAUTH_TOKEN_KEY]: "current-token", [STORAGE_DID_KEY]: "device-id" }[key] ?? null) };

test("both inventory reads use the refreshed credential, path signature and selected role header", async () => {
  const paths: string[] = [];
  const client: EndfieldInventoryClient = { storage, $fetch: async (url, options) => {
    const path = new URL(url).pathname;
    paths.push(path);
    assert.equal(new URL(url).origin, "https://zonai.skland.com");
    assert.equal(new URL(url).search, "");
    assert.equal(options.method, "GET");
    assert.equal(options.retry, 0);
    assert.equal(options.redirect, "error");
    assert.equal(options.timeout, 12_000);
    assert.equal(options.headers.cred, "test-cred");
    assert.equal(options.headers["sk-game-role"], "3_role_server");
    const { timestamp } = options.headers;
    assert.equal(options.headers.sign, createSklandRequestSignature({
      token: "current-token", path, timestamp,
      headers: { platform: "3", timestamp, dId: "device-id", vName: "1.0.0" },
    }));
    return path === ENDFIELD_MATERIAL_LIST_PATH ? catalog : { code: 0, data: { userGameData: { ...selected, itemCount: { gold: 0 } } } };
  } };
  const result = await readEndfieldInventory(client, selected);
  assert.deepEqual(paths.sort(), [ENDFIELD_MATERIAL_LIST_PATH, ENDFIELD_USER_GAME_DATA_PATH].sort());
  assert.equal(result.status, "ready");
  assert.equal(result.items[0].count, 0);
  assert.doesNotMatch(JSON.stringify(result), /test-cred|current-token|device-id/);
});

test("one upstream failure retains available catalog and never leaks request details", async () => {
  const result = await readEndfieldInventory({ storage, $fetch: async url => {
    if (url.endsWith("material-list")) return catalog;
    throw new Error("timeout: cred=test-cred");
  } }, selected);
  assert.equal(result.status, "partial");
  assert.equal(result.issue, "counts");
  assert.equal(result.items[0].count, null);
  assert.doesNotMatch(JSON.stringify(result), /test-cred|timeout/);
});

test("missing credentials do not issue upstream reads", async () => {
  const result = await readEndfieldInventory({ storage: { getItem: async () => null }, $fetch: async () => {
    assert.fail("no upstream request without credentials");
  } }, selected);
  assert.deepEqual(result, { status: "unavailable", items: [] });
});

test("weapon state and stock reuse the same two calculator requests", async () => {
  let calls = 0;
  const result = await readEndfieldCalculatorData({ storage, $fetch: async url => {
    calls++;
    return url.endsWith("material-list") ? catalog : { code: 0, data: { userGameData: { ...selected,
      itemCount: { gold: 3 }, userWeapons: [{ weaponId: "wpn_sword_0003", level: 50, refineLevel: 0 }],
      unusedCategory: { token: "not-forwarded" },
    } } };
  } }, selected);
  assert.equal(calls, 2);
  assert.equal(result.inventory.items[0].count, 3);
  assert.equal(result.weapons.items[0].level, 50);
  assert.doesNotMatch(JSON.stringify(result), /unusedCategory|not-forwarded/);
});
