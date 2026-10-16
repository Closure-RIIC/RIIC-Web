import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type { SklandSessionPayload } from "./session.ts";
register("../../../scripts/ts-path-loader.mjs", import.meta.url);

test("SDK integration signs once, detects already-signed days, preserves expiry and rejects foreign roles", async t => {
  let signed = false, writes = 0, fail = false;
  const now = Date.now(), ts = String(Math.floor(now / 1000));
  await t.mock.module(new URL("./normalize.ts", import.meta.url), { namedExports: {
    rolesFromBinding: (binding: { list: Array<{ bindingList: Array<{ uid: string }> }> }) => binding.list[0]!.bindingList,
    snapshotFromPlayerInfo: () => ({}), snapshotsFromPlayerInfo: () => ({}),
  } });
  await t.mock.module(new URL("./layout-suggestion.ts", import.meta.url), { namedExports: { sklandLayoutSuggestion: () => ({}) } });
  await t.mock.module(new URL("./operator-snapshot-store.ts", import.meta.url), { namedExports: { persistOperatorSnapshot: () => {} } });
  const status = () => ({ currentTs: ts, records: signed ? [{ ts, resourceId: "lmd", count: 500 }] : [], resourceInfoMap: { lmd: { name: "龙门币" } } });
  await t.mock.module("skland-kit", { namedExports: {
    STORAGE_CREDENTIAL_KEY: "cred", STORAGE_DID_KEY: "did", STORAGE_OAUTH_TOKEN_KEY: "token", STORAGE_USER_ID_KEY: "user",
    createClient: () => ({ storage: { setItems: async () => {}, setItem: async () => {} }, collections: {
      player: { getBinding: async () => ({ list: [{ appCode: "arknights", bindingList: [{ uid: "uid", nickName: "test" }] }] }) },
      game: { getAttendanceStatus: async () => status(), attendance: async () => { writes++; if (fail) throw new Error("provider failure"); signed = true; return { ts: Number(ts), awards: [{ resource: { name: "龙门币" }, count: 500 }] }; } },
    } }),
  } });
  const { sklandAttendance } = await import("./adapter.ts");
  const payload = { version: 3, cred: "fake-test-cred", token: "fake-test-token", dId: "test", userId: "test", selectedUid: "uid", refreshedAt: now, expiresAt: now + 60000, policyConsent: {} } as SklandSessionPayload;
  const [first, concurrent] = await Promise.all([sklandAttendance(payload, "uid", true), sklandAttendance(payload, "uid", true)]);
  assert.equal(writes, 1); assert.equal(first.attendance.hasToday, true); assert.equal(concurrent.attendance.signedNow, true);
  assert.equal(first.session.expiresAt, payload.expiresAt);
  assert.equal((await sklandAttendance(payload, "uid", true)).attendance.signedNow, false); assert.equal(writes, 1);
  await assert.rejects(sklandAttendance(payload, "foreign", true)); assert.equal(writes, 1);
  signed = false; fail = true;
  await assert.rejects(sklandAttendance(payload, "uid", true));
});
