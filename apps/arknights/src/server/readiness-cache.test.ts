import assert from "node:assert/strict";
import test from "node:test";
import { createReadinessCache } from "./readiness-cache.ts";
import type { PublicHealthData } from "../types.ts";

const healthy: PublicHealthData = {
  status: "ready", plannerReady: true,
  taskQueue: { enabled: true, ready: true, releaseMatched: true },
  features: { debugTools: false, rateLimit: true },
};

test("readiness coalesces concurrent probes and expires five seconds after completion", async () => {
  let calls = 0;
  let now = 0;
  let finish!: (data: PublicHealthData) => void;
  const read = createReadinessCache(() => {
    calls++;
    return new Promise((resolve) => { finish = resolve; });
  }, () => "release-a", () => now);
  const first = read();
  assert.equal(read(), first);
  await Promise.resolve();
  assert.equal(calls, 1);
  now = 10_000;
  assert.equal(read(), first, "in-flight probe must not expire");
  finish(healthy);
  await first;
  now = 14_999;
  assert.equal(read(), first);
  now = 15_000;
  const second = read();
  assert.notEqual(second, first);
  await Promise.resolve();
  finish(healthy);
  await second;
  assert.equal(calls, 2);
});

test("unhealthy and rejected probes retry after one second", async () => {
  let now = 0;
  let calls = 0;
  const read = createReadinessCache(async () => {
    calls++;
    if (calls === 1) return { ...healthy, plannerReady: false, status: "unavailable" };
    if (calls === 2) throw new Error("probe failed");
    return healthy;
  }, () => "release-a", () => now);
  assert.equal((await read()).plannerReady, false);
  now = 999;
  assert.equal((await read()).plannerReady, false);
  now = 1_000;
  await assert.rejects(read(), /probe failed/);
  now = 1_999;
  await assert.rejects(read(), /probe failed/);
  assert.equal(calls, 2);
  now = 2_000;
  assert.equal((await read()).plannerReady, true);
});

test("a release change invalidates cache and old in-flight completions cannot refill it", async () => {
  let key = "a";
  let calls = 0;
  const pending: ((data: PublicHealthData) => void)[] = [];
  const read = createReadinessCache(() => {
    calls++;
    return new Promise((resolve) => pending.push(resolve));
  }, () => key);
  const old = read();
  await Promise.resolve();
  key = "b";
  const current = read();
  await Promise.resolve();
  pending[1](healthy);
  await current;
  pending[0]({ ...healthy, plannerReady: false });
  await old;
  assert.equal(read(), current);
  assert.equal(calls, 2);
});
