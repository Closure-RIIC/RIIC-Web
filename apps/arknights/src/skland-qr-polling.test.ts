import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

import {
  nextSklandQrPollDelay,
  remainingSklandQrPollDelay,
  SKLAND_QR_MAX_BACKOFF_MS,
  SKLAND_QR_POLL_INTERVAL_MS,
} from "@riic/platform/skland-qr-polling";

const now = 1_000_000;
const expiresAt = now + 10 * 60_000;

test("Skland QR polling uses bounded exponential backoff for transient failures", () => {
  assert.equal(nextSklandQrPollDelay({ failedAttempts: 0, expiresAt, now }), SKLAND_QR_POLL_INTERVAL_MS);
  assert.equal(nextSklandQrPollDelay({ failedAttempts: 1, expiresAt, now }), 12_000);
  assert.equal(nextSklandQrPollDelay({ failedAttempts: 2, expiresAt, now }), 24_000);
  assert.equal(nextSklandQrPollDelay({ failedAttempts: 3, expiresAt, now }), SKLAND_QR_MAX_BACKOFF_MS);
  assert.equal(nextSklandQrPollDelay({ failedAttempts: 10, expiresAt, now }), SKLAND_QR_MAX_BACKOFF_MS);
});

test("Skland QR polling honors Retry-After without polling at or beyond expiration", () => {
  assert.equal(nextSklandQrPollDelay({
    failedAttempts: 1,
    expiresAt,
    now,
    retryAfterSeconds: 30,
  }), 30_000);
  assert.equal(nextSklandQrPollDelay({
    failedAttempts: 10,
    expiresAt,
    now,
    retryAfterSeconds: 90,
  }), 90_000);
  assert.equal(nextSklandQrPollDelay({
    failedAttempts: 1,
    expiresAt: now + 30_000,
    now,
    retryAfterSeconds: 30,
  }), null);
  assert.equal(nextSklandQrPollDelay({ failedAttempts: 0, expiresAt: now, now }), null);
});

test("Skland QR polling preserves a pending backoff deadline across pause and resume", () => {
  assert.equal(remainingSklandQrPollDelay({
    nextPollAt: now + 30_000,
    expiresAt,
    now: now + 5_000,
  }), 25_000);
  assert.equal(remainingSklandQrPollDelay({
    nextPollAt: now + 5_000,
    expiresAt,
    now: now + 10_000,
  }), 0);
  assert.equal(remainingSklandQrPollDelay({ nextPollAt: null, expiresAt, now }), 0);
  assert.equal(remainingSklandQrPollDelay({
    nextPollAt: expiresAt,
    expiresAt,
    now,
  }), null);
});

test("Skland QR polling keeps callback updates stable and aborts in-flight requests on cleanup", async () => {
  const component = await readFile(new URL("./skland-components.tsx", import.meta.url), "utf8");
  const api = await readFile(new URL("./api.ts", import.meta.url), "utf8");

  assert.match(component, /useEffectEvent\(onAuthenticated\)/);
  assert.match(component, /pollSklandQr\(scanId, controller\.signal\)/);
  assert.match(component, /activePollController\?\.abort\(\)/);
  assert.match(component, /\}, \[authMethod, scanExpiresAt, scanId\]\);/);
  assert.match(api, /pollSklandQr\(scanId: string, signal\?: AbortSignal\)/);
  assert.match(api, /body: JSON\.stringify\(\{ scanId \}\),\s+signal,/);
});
