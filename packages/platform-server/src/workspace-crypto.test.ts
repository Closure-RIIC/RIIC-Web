import assert from "node:assert/strict";
import test from "node:test";

import {
  decryptPlanTaskPayload,
  decryptOperboxSnapshot,
  encryptPlanTaskPayload,
  encryptOperboxSnapshot,
  planOperboxContentHmac,
  verifyPlanOperboxContentHmac,
} from "./workspace-crypto.ts";

const key = Buffer.alloc(32, 7);
const keys = new Map([["v1", key]]);

test("plan task envelope round-trips with a task-specific authenticated domain", () => {
  const envelope = encryptPlanTaskPayload({
    userId: "user-a",
    taskId: "task-a",
    plaintext: '{"operbox":[{"id":"char_1"}]}',
    activeVersion: "v1",
    masterKey: key,
  });
  assert.equal(
    decryptPlanTaskPayload({ userId: "user-a", taskId: "task-a", envelope, keys }),
    '{"operbox":[{"id":"char_1"}]}',
  );
  assert.throws(() => decryptPlanTaskPayload({ userId: "user-b", taskId: "task-a", envelope, keys }));
  assert.throws(() => decryptPlanTaskPayload({ userId: "user-a", taskId: "task-b", envelope, keys }));
  assert.throws(() => decryptPlanTaskPayload({
    userId: "user-a",
    taskId: "task-a",
    envelope: { ...envelope, schemaVersion: 2 },
    keys,
  }));
});

test("operbox envelope round-trips and binds ciphertext to user, record and schema", () => {
  const envelope = encryptOperboxSnapshot({
    userId: "user-a",
    snapshotId: "snapshot-a",
    plaintext: '[{"id":"char_1"}]',
    activeVersion: "v1",
    masterKey: key,
  });
  assert.equal(decryptOperboxSnapshot({ userId: "user-a", snapshotId: "snapshot-a", envelope, keys }), '[{"id":"char_1"}]');
  assert.throws(() => decryptOperboxSnapshot({ userId: "user-b", snapshotId: "snapshot-a", envelope, keys }));
  assert.throws(() => decryptOperboxSnapshot({ userId: "user-a", snapshotId: "snapshot-b", envelope, keys }));
  assert.throws(() => decryptOperboxSnapshot({ userId: "user-a", snapshotId: "snapshot-a", envelope: { ...envelope, schemaVersion: 2 }, keys }));
});

test("operbox envelope fails closed for tampering and missing key versions", () => {
  const envelope = encryptOperboxSnapshot({
    userId: "user-a",
    snapshotId: "snapshot-a",
    plaintext: "sensitive-box",
    activeVersion: "v1",
    masterKey: key,
  });
  const tampered = Buffer.from(envelope.encryptedPayload, "base64");
  tampered[0] ^= 1;
  assert.throws(() => decryptOperboxSnapshot({
    userId: "user-a",
    snapshotId: "snapshot-a",
    envelope: { ...envelope, encryptedPayload: tampered.toString("base64") },
    keys,
  }));
  assert.throws(() => decryptOperboxSnapshot({ userId: "user-a", snapshotId: "snapshot-a", envelope, keys: new Map() }));
});

test("operbox content HMAC cannot correlate equal boxes across website users", () => {
  const first = encryptOperboxSnapshot({
    userId: "user-a",
    snapshotId: "snapshot-a",
    plaintext: "same-box",
    activeVersion: "v1",
    masterKey: key,
  });
  const second = encryptOperboxSnapshot({
    userId: "user-b",
    snapshotId: "snapshot-b",
    plaintext: "same-box",
    activeVersion: "v1",
    masterKey: key,
  });
  assert.notEqual(first.contentHmac, second.contentHmac);
});

test("saved plan Box HMAC is order-independent and bound to user and content", () => {
  const first = { id: "char_1", name: "测试一", elite: 2, level: 80, own: true, potential: 1, rarity: 6 };
  const second = { id: "char_2", name: "测试二", elite: 1, level: 60, own: true, potential: 2, rarity: 5 };
  const original = planOperboxContentHmac({ userId: "user-a", operbox: [first, second], masterKey: key });
  assert.equal(original, planOperboxContentHmac({ userId: "user-a", operbox: [second, first], masterKey: key }));
  assert.notEqual(original, planOperboxContentHmac({ userId: "user-b", operbox: [first, second], masterKey: key }));
  assert.notEqual(original, planOperboxContentHmac({ userId: "user-a", operbox: [{ ...first, level: 79 }, second], masterKey: key }));
  assert.equal(verifyPlanOperboxContentHmac({ userId: "user-a", operbox: [second, first], masterKey: key, expected: original }), true);
  assert.equal(verifyPlanOperboxContentHmac({ userId: "user-a", operbox: [first, second], masterKey: key, expected: "0".repeat(64) }), false);
  assert.equal(verifyPlanOperboxContentHmac({ userId: "user-a", operbox: [first, second], masterKey: key, expected: "invalid" }), false);
});
