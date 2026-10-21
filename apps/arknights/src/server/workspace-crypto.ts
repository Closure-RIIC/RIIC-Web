import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { OperBoxEntry } from "../types.ts";

const AUTH_TAG_BYTES = 16;
export const OPERBOX_ENVELOPE_SCHEMA_VERSION = 1;
export const PLAN_TASK_ENVELOPE_SCHEMA_VERSION = 1;

export type OperboxEnvelope = {
  contentHmac: string;
  encryptedPayload: string;
  payloadIv: string;
  wrappedDataKey: string;
  wrappedKeyIv: string;
  keyVersion: string;
  schemaVersion: number;
};

export type PlanTaskEnvelope = Omit<OperboxEnvelope, "contentHmac">;

function seal(plaintext: Buffer, key: Buffer, iv: Buffer, aad: Buffer): string {
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]).toString("base64");
}

function open(encoded: string, key: Buffer, iv: Buffer, aad: Buffer): Buffer {
  const sealed = Buffer.from(encoded, "base64");
  if (sealed.byteLength <= AUTH_TAG_BYTES) throw new Error("Encrypted workspace value is truncated.");
  const ciphertext = sealed.subarray(0, -AUTH_TAG_BYTES);
  const tag = sealed.subarray(-AUTH_TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function aad(userId: string, snapshotId: string, schemaVersion: number, purpose: "payload" | "key"): Buffer {
  return Buffer.from(`${userId}\0${snapshotId}\0${schemaVersion}\0${purpose}`, "utf8");
}

function planTaskAad(userId: string, taskId: string, schemaVersion: number, purpose: "payload" | "key"): Buffer {
  return Buffer.from(`plan-task\0${userId}\0${taskId}\0${schemaVersion}\0${purpose}`, "utf8");
}

function contentHmacKey(masterKey: Buffer): Buffer {
  return createHmac("sha256", masterKey).update("arknights-infra-workspace-operbox-hmac-v1").digest();
}

function planOperboxHmacKey(masterKey: Buffer): Buffer {
  return createHmac("sha256", masterKey).update("arknights-infra-saved-plan-operbox-hmac-v1").digest();
}

export function planOperboxContentHmac(input: {
  userId: string;
  operbox: readonly OperBoxEntry[];
  masterKey: Buffer;
}): string {
  if (input.masterKey.byteLength !== 32) throw new Error("Workspace master key must contain exactly 32 bytes.");
  const canonical = [...input.operbox]
    .sort((left, right) => left.id.localeCompare(right.id) || left.name.localeCompare(right.name))
    .map(({ id, name, elite, level, own, potential, rarity }) => ({ id, name, elite, level, own, potential, rarity }));
  return createHmac("sha256", planOperboxHmacKey(input.masterKey))
    .update(input.userId, "utf8")
    .update("\0", "utf8")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}

export function verifyPlanOperboxContentHmac(input: {
  userId: string;
  operbox: readonly OperBoxEntry[];
  masterKey: Buffer;
  expected: unknown;
}): boolean {
  if (typeof input.expected !== "string" || !/^[a-f0-9]{64}$/.test(input.expected)) return false;
  const actual = planOperboxContentHmac(input);
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(input.expected, "hex"));
}

export function encryptOperboxSnapshot(input: {
  userId: string;
  snapshotId: string;
  plaintext: string;
  activeVersion: string;
  masterKey: Buffer;
}): OperboxEnvelope {
  if (input.masterKey.byteLength !== 32) throw new Error("Workspace master key must contain exactly 32 bytes.");
  const schemaVersion = OPERBOX_ENVELOPE_SCHEMA_VERSION;
  const dataKey = randomBytes(32);
  const payloadIv = randomBytes(12);
  const wrappedKeyIv = randomBytes(12);
  const plaintext = Buffer.from(input.plaintext, "utf8");
  return {
    contentHmac: createHmac("sha256", contentHmacKey(input.masterKey))
      .update(input.userId, "utf8")
      .update("\0", "utf8")
      .update(plaintext)
      .digest("hex"),
    encryptedPayload: seal(plaintext, dataKey, payloadIv, aad(input.userId, input.snapshotId, schemaVersion, "payload")),
    payloadIv: payloadIv.toString("base64"),
    wrappedDataKey: seal(dataKey, input.masterKey, wrappedKeyIv, aad(input.userId, input.snapshotId, schemaVersion, "key")),
    wrappedKeyIv: wrappedKeyIv.toString("base64"),
    keyVersion: input.activeVersion,
    schemaVersion,
  };
}

export function decryptOperboxSnapshot(input: {
  userId: string;
  snapshotId: string;
  envelope: OperboxEnvelope;
  keys: Map<string, Buffer>;
}): string {
  const masterKey = input.keys.get(input.envelope.keyVersion);
  if (!masterKey) throw new Error(`Workspace key version ${input.envelope.keyVersion} is unavailable.`);
  if (masterKey.byteLength !== 32) throw new Error("Workspace master key must contain exactly 32 bytes.");
  const payloadIv = Buffer.from(input.envelope.payloadIv, "base64");
  const wrappedKeyIv = Buffer.from(input.envelope.wrappedKeyIv, "base64");
  if (payloadIv.byteLength !== 12 || wrappedKeyIv.byteLength !== 12) throw new Error("Workspace envelope IV is invalid.");
  const dataKey = open(
    input.envelope.wrappedDataKey,
    masterKey,
    wrappedKeyIv,
    aad(input.userId, input.snapshotId, input.envelope.schemaVersion, "key"),
  );
  if (dataKey.byteLength !== 32) throw new Error("Workspace data key is invalid.");
  return open(
    input.envelope.encryptedPayload,
    dataKey,
    payloadIv,
    aad(input.userId, input.snapshotId, input.envelope.schemaVersion, "payload"),
  ).toString("utf8");
}

export function encryptPlanTaskPayload(input: {
  userId: string;
  taskId: string;
  plaintext: string;
  activeVersion: string;
  masterKey: Buffer;
}): PlanTaskEnvelope {
  if (input.masterKey.byteLength !== 32) throw new Error("Workspace master key must contain exactly 32 bytes.");
  const schemaVersion = PLAN_TASK_ENVELOPE_SCHEMA_VERSION;
  const dataKey = randomBytes(32);
  const payloadIv = randomBytes(12);
  const wrappedKeyIv = randomBytes(12);
  return {
    encryptedPayload: seal(
      Buffer.from(input.plaintext, "utf8"),
      dataKey,
      payloadIv,
      planTaskAad(input.userId, input.taskId, schemaVersion, "payload"),
    ),
    payloadIv: payloadIv.toString("base64"),
    wrappedDataKey: seal(
      dataKey,
      input.masterKey,
      wrappedKeyIv,
      planTaskAad(input.userId, input.taskId, schemaVersion, "key"),
    ),
    wrappedKeyIv: wrappedKeyIv.toString("base64"),
    keyVersion: input.activeVersion,
    schemaVersion,
  };
}

export function decryptPlanTaskPayload(input: {
  userId: string;
  taskId: string;
  envelope: PlanTaskEnvelope;
  keys: Map<string, Buffer>;
}): string {
  const masterKey = input.keys.get(input.envelope.keyVersion);
  if (!masterKey) throw new Error(`Workspace key version ${input.envelope.keyVersion} is unavailable.`);
  if (masterKey.byteLength !== 32) throw new Error("Workspace master key must contain exactly 32 bytes.");
  if (input.envelope.schemaVersion !== PLAN_TASK_ENVELOPE_SCHEMA_VERSION) {
    throw new Error(`Unsupported plan task envelope schema ${input.envelope.schemaVersion}.`);
  }
  const payloadIv = Buffer.from(input.envelope.payloadIv, "base64");
  const wrappedKeyIv = Buffer.from(input.envelope.wrappedKeyIv, "base64");
  if (payloadIv.byteLength !== 12 || wrappedKeyIv.byteLength !== 12) throw new Error("Plan task envelope IV is invalid.");
  const dataKey = open(
    input.envelope.wrappedDataKey,
    masterKey,
    wrappedKeyIv,
    planTaskAad(input.userId, input.taskId, input.envelope.schemaVersion, "key"),
  );
  if (dataKey.byteLength !== 32) throw new Error("Plan task data key is invalid.");
  return open(
    input.envelope.encryptedPayload,
    dataKey,
    payloadIv,
    planTaskAad(input.userId, input.taskId, input.envelope.schemaVersion, "payload"),
  ).toString("utf8");
}
