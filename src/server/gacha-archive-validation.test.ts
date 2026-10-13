import assert from "node:assert/strict";
import test from "node:test";
import { validateGachaImport } from "./gacha-archive-validation.ts";
import { gachaAccountOptions } from "../gacha-accounts.ts";

test("legacy import rejects mismatched ownership and malformed data without trusting record IDs", () => {
  const record = { id: "spoofed", category: "normal", poolId: "p", poolName: "Pool", charId: "char_1", charName: "One", stars: 6, isNew: true, timestamp: Date.now() - 1000, pos: 0 };
  const history = { uid: "10001", records: [record, { ...record, id: "different" }] };
  const result = validateGachaImport(history, "10001");
  assert.equal(result.length, 1);
  assert.notEqual(result[0].id, "spoofed");
  assert.throws(() => validateGachaImport(history, "10002"));
  for (const change of [{ stars: 7 }, { timestamp: Date.now() + 86400001 }, { pos: -1 }, { category: "x".repeat(100) }, { charName: {} }, { isNew: "true" }, { stars: "6" }]) {
    assert.throws(() => validateGachaImport({ ...history, records: [{ ...record, ...change }] }, "10001"));
  }
  assert.throws(() => validateGachaImport({ ...history, records: Array(50_001).fill(record) }, "10001"));
});

test("account options retain multiple Skland accounts and archives after all credentials expire", () => {
  const role = (uid: string) => ({ uid, nickname: uid, channelName: "official", isDefault: true });
  const accounts = ["10001", "10002"].map((uid) => ({ accountId: `skland-${uid}`, selectedUid: uid, roles: [role(uid)] }));
  const archives = [role("10001"), role("10003")];
  const result = gachaAccountOptions(accounts, archives, [role("10002")]);
  assert.equal(result.accounts.length, 3);
  assert.deepEqual(result.authorizedUids, ["10002"]);
  assert.deepEqual(result.roles.map((entry) => entry.uid), ["10001", "10002", "10003"]);
  assert.deepEqual(gachaAccountOptions([], archives, []).roles.map((entry) => entry.uid), ["10001", "10003"]);
  assert.equal(accounts.length, 2);
});
