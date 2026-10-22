import assert from "node:assert/strict";
import test from "node:test";
import { cdkAvailability, hashCdk, normalizeCdk, parseAdminCdkInput, parseCdkRevocation, randomCdk, validCdk } from "./cdk.ts";

const batchId = "ccdc31bf-3dc0-4d65-9fb9-6b55eabf5678";

test("validity boundaries and terminal states determine redeemability", () => {
  const now = new Date("2030-01-01T00:00:00Z");
  assert.equal(cdkAvailability({ status: "issued", startsAt: now }, now), "issued");
  assert.equal(cdkAvailability({ status: "issued", expiresAt: now }, now), "expired");
  assert.equal(cdkAvailability({ status: "issued", startsAt: new Date(now.getTime() + 1) }, now), "scheduled");
  for (const status of ["revoked", "redeemed"]) assert.equal(cdkAvailability({ status, expiresAt: now }, now), status);
  assert.equal(cdkAvailability({ status: "issued" }, now), "issued", "legacy codes have no expiry");
  const input = { batchId, count: 1, points: 30 };
  for (const dates of [{ expiresAt: "2000-01-01T00:00:00Z" }, { startsAt: "2030-01-01T00:00" }, { startsAt: "2030-01-02T00:00:00Z", expiresAt: "2030-01-01T00:00:00Z" }]) assert.throws(() => parseAdminCdkInput({ ...input, ...dates }));
  assert.equal(parseAdminCdkInput({ ...input, batchLabel: " campaign ", expiresAt: "2099-01-01T00:00:00Z" }).batchLabel, "campaign");
});

test("revocation accepts one promotional target and requires an audit reason", () => {
  assert.deepEqual(parseCdkRevocation({ batchId, reason: " stop " }), { batchId, reason: "stop" });
  const id = `admin:${batchId}:0`;
  assert.deepEqual(parseCdkRevocation({ id, reason: "stop" }), { id, reason: "stop" });
  for (const value of [{ id: "user-gift", reason: "stop" }, { id, batchId, reason: "stop" }, { batchId, reason: " " }, { batchId, reason: "x".repeat(201) }, { batchId: "invalid", reason: "stop" }]) assert.throws(() => parseCdkRevocation(value));
});

test("admin batch accepts 20 codes with 30 points, bounded positive integer amounts only", () => {
  assert.deepEqual(parseAdminCdkInput({ batchId, count: 20, points: 30 }), { batchId, count: 20, points: 30 });
  for (const count of [0, -1, 101, 1.5, "20", NaN, Infinity]) {
    assert.throws(() => parseAdminCdkInput({ batchId, count, points: 30 }));
  }
  for (const points of [0, -30, 100001, 0.5, "30", NaN, Infinity]) {
    assert.throws(() => parseAdminCdkInput({ batchId, count: 20, points }));
  }
  for (const bad of [null, [], {}, { batchId: "invalid", count: 20, points: 30 }]) assert.throws(() => parseAdminCdkInput(bad));
});

test("custom codes normalize case, require matching quantity and reject duplicates", () => {
  assert.deepEqual(parseAdminCdkInput({ batchId, count: 2, points: 30, codes: [" welcome-30 ", "EVENT_002"] }).codes, ["WELCOME-30", "EVENT_002"]);
  for (const codes of [["WELCOME-30"], ["WELCOME-30", "welcome-30"], ["short", "EVENT_002"], [null, "EVENT_002"], ["A".repeat(65), "EVENT_002"], ["bad code", "EVENT_002"]]) {
    assert.throws(() => parseAdminCdkInput({ batchId, count: 2, points: 30, codes }));
  }
});

test("random codes retain legacy redeemability and hashes normalize identically", () => {
  const codes = Array.from({ length: 100 }, randomCdk);
  assert.equal(new Set(codes).size, 100);
  for (const code of codes) {
    assert.match(code, /^RIIC-[A-F0-9]{36}$/);
    assert.equal(validCdk(code), true);
    assert.equal(hashCdk(` ${code.toLowerCase()} `), hashCdk(code));
    assert.match(hashCdk(code), /^[a-f0-9]{64}$/);
  }
  assert.equal(normalizeCdk(" riic-gift_30 "), "RIIC-GIFT_30");
  for (const code of ["", "RIIC-1", "a b c d e", "<script>", "-12345678"]) assert.equal(validCdk(code), false);
});
