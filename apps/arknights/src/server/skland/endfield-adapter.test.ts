import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);

test("Endfield reads require current role AND server membership; QR owners are isolated", async context => {
  const calls: unknown[] = [];
  await context.mock.module(new URL("./adapter.ts", import.meta.url), { namedExports: {
    withSklandSession: async () => { throw new Error("not used"); },
    withSklandCredential: async () => { throw new Error("not used"); },
    startScan: async (...args: unknown[]) => { calls.push(args); return {}; },
    consumeScan: (...args: unknown[]) => { calls.push(args); },
    pollSklandIdentity: async () => ({ status: "expired" }),
  } });
  const { readEndfieldSnapshot, startEndfieldScan, consumeEndfieldScan } = await import("./endfield-adapter.ts");
  let reads = 0, inventoryReads = 0, returnedId = "role";
  const client = {
    storage: { getItem: async () => "fixture" },
    $fetch: async () => { inventoryReads++; throw new Error("inventory temporarily unavailable"); },
    collections: { player: {
    getBinding: async () => ({ list: [{ appCode: "endfield", bindingList: [{ uid: "uid", roles: [{ roleId: "role", serverId: "server" }] }] }] }),
    getEndfieldDetails: async (selected: { roleId: string; serverId: string }) => {
      reads++; assert.deepEqual(selected, { roleId: "role", serverId: "server" });
      return { detail: { base: { roleId: returnedId, name: "Test", charNum: 1 }, chars: [{ id: "char", charData: { name: "Operator" }, evolvePhase: 0, level: 1 }] } };
    },
  } } };
  await assert.rejects(readEndfieldSnapshot(client, { roleId: "someone-else", serverId: "server" }), /不属于/);
  await assert.rejects(readEndfieldSnapshot(client, { roleId: "role", serverId: "another-server" }), /不属于/);
  assert.equal(reads, 0);
  assert.equal(inventoryReads, 0, "Unowned roles must never trigger inventory reads");
  const snapshot = await readEndfieldSnapshot(client, { roleId: "role", serverId: "server" });
  assert.equal(snapshot.role.roleId, "role");
  assert.equal(snapshot.inventory.status, "unavailable", "Inventory failure must not block the character dashboard");
  assert.equal(inventoryReads, 2);
  returnedId = "wrong-role";
  await assert.rejects(readEndfieldSnapshot(client, { roleId: "role", serverId: "server" }), /不一致/);
  const { TERMS_VERSION, PRIVACY_VERSION } = await import("../../../../../packages/platform/legal-policy.ts");
  await startEndfieldScan("website-user", "local", { termsAccepted: true, privacyAccepted: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION });
  consumeEndfieldScan("scan", "website-user");
  assert.equal((calls[0] as string[])[0], "endfield:website-user");
  assert.deepEqual(calls[1], ["scan", "endfield:website-user"]);
});
