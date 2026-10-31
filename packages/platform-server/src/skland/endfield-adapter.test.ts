import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type { SklandSessionPayload } from "./session.ts";
register("../../../../scripts/ts-path-loader.mjs", import.meta.url);

test("Endfield reads require current role AND server membership; QR owners are isolated", async context => {
  const calls: unknown[] = [];
  let sessionReads = 0;
  await context.mock.module(new URL("./adapter.ts", import.meta.url), { namedExports: {
    withSklandSession: async (session: SklandSessionPayload, read: (value: typeof client) => Promise<unknown>) => {
      sessionReads++;
      return { session, result: await read(client) };
    },
    SklandServiceError: class extends Error {},
    withSklandCredential: async () => { throw new Error("not used"); },
    startScan: async (...args: unknown[]) => { calls.push(args); return {}; },
    consumeScan: (...args: unknown[]) => { calls.push(args); },
    scanCompletionSignal: () => new AbortController().signal,
    pollSklandIdentity: async () => ({ status: "expired" }),
  } });
  const { readEndfieldSnapshot, startEndfieldScan, consumeEndfieldScan, endfieldSync, invalidateEndfieldSnapshots } = await import("./endfield-adapter.ts");
  let reads = 0, inventoryReads = 0, returnedId = "role";
  let inventoryWait: Promise<void> = Promise.resolve();
  let failDetails = false;
  const client = {
    storage: { getItem: async () => "fixture" },
    $fetch: async () => { inventoryReads++; await inventoryWait; throw new Error("inventory temporarily unavailable"); },
    collections: { player: {
    getBinding: async () => ({ list: [{ appCode: "endfield", bindingList: [{ uid: "uid", roles: [{ roleId: "role", serverId: "server" }] }] }] }),
    getEndfieldDetails: async (selected: { roleId: string; serverId: string }) => {
      reads++; assert.deepEqual(selected, { roleId: "role", serverId: "server" });
      if (failDetails) throw new Error("detail read failed");
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
  const { TERMS_VERSION, PRIVACY_VERSION } = await import("@riic/platform/legal-policy");
  await startEndfieldScan("website-user", "local", { termsAccepted: true, privacyAccepted: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION });
  consumeEndfieldScan("scan", "website-user");
  assert.equal((calls[0] as string[])[0], "endfield:website-user");
  assert.equal((calls[0] as string[])[3], "website-user", "Quota belongs to the website account, not the game namespace");
  assert.deepEqual(calls[1], ["scan", "endfield:website-user"]);
  returnedId = "role";
  const session: SklandSessionPayload = { version: 3, cred: "fixture", token: "fixture-token", dId: "device", userId: "skland-user",
    selectedUid: "", refreshedAt: 0, expiresAt: Date.now() + 60000, policyConsent: { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, acceptedAt: 0 } };
  const selected = { roleId: "role", serverId: "server" };
  const identity = { userId: "website-user", accountId: "account", force: true };
  await Promise.all(Array.from({ length: 20 }, () => endfieldSync(session, selected, identity)));
  assert.equal(sessionReads, 1, "credential setup/refresh must be inside the coalesced task");
  await endfieldSync(session, selected, { ...identity, force: false });
  assert.equal(sessionReads, 1);
  await endfieldSync({ ...session, token: "new-token" }, selected, identity);
  assert.equal(sessionReads, 2, "a refreshed credential must never receive an older cached session");
  invalidateEndfieldSnapshots(identity.userId);
  await endfieldSync(session, selected, identity);
  assert.equal(sessionReads, 3);
  let finishInventory!: () => void;
  inventoryWait = new Promise(resolve => { finishInventory = resolve; });
  failDetails = true;
  let settled = false;
  const failedRead = readEndfieldSnapshot(client, selected).catch(error => { settled = true; assert.match(error.message, /detail read failed/); });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, "a failing detail read cannot release capacity while calculator requests remain active");
  finishInventory();
  await failedRead;
  assert.equal(settled, true);
});
