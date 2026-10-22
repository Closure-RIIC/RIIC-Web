import assert from "node:assert/strict";
import test from "node:test";

import { planCacheRetryDelayMs, waitForPlanCache } from "./plan-cache-wait.ts";

function clock() {
  let time = 0;
  const delays: number[] = [];
  return { now: () => time, sleep: async (ms: number) => { delays.push(ms); time += ms; }, random: () => 0.5, delays };
}

test("retry delays back off to two seconds with bounded jitter", () => {
  assert.deepEqual([0, 1, 2, 20].map((attempt) => planCacheRetryDelayMs(attempt, () => 0.5)), [500, 1000, 2000, 2000]);
  assert.equal(planCacheRetryDelayMs(2, () => 0), 1800);
  assert.equal(planCacheRetryDelayMs(2, () => 1), 2200);
});

test("an existing valid lease is read without any acquisition writes", async () => {
  const time = clock();
  let writes = 0;
  const hit = { kind: "hit" };
  const result = await waitForPlanCache({
    ...time, timeoutMs: 200_000,
    read: async () => ({ hit: time.now() >= 3500 ? hit : null, leased: true }),
    acquire: async () => { writes++; return null; },
  });
  assert.equal(result, hit);
  assert.equal(writes, 0);
  assert.deepEqual(time.delays, [500, 1000, 2000]);
});

test("an expired or released lease can be acquired on the next read", async () => {
  const time = clock();
  let writes = 0;
  const lease = { kind: "lease" };
  const result = await waitForPlanCache({
    ...time, timeoutMs: 200_000,
    read: async () => ({ hit: null, leased: time.now() < 1500 }),
    acquire: async () => { writes++; return lease; },
  });
  assert.equal(result, lease);
  assert.equal(writes, 1);
});

test("a lost acquisition race reads the winner rather than immediately retrying writes", async () => {
  const time = clock();
  let writes = 0;
  const hit = { kind: "hit" };
  const result = await waitForPlanCache({
    ...time, timeoutMs: 200_000,
    read: async () => ({ hit: time.now() >= 1500 ? hit : null, leased: writes > 0 }),
    acquire: async () => { writes++; return null; },
  });
  assert.equal(result, hit);
  assert.equal(writes, 1);
});

test("wait is bounded by the overall deadline, including the last sleep", async () => {
  const time = clock();
  assert.equal(await waitForPlanCache({
    ...time, timeoutMs: 1800,
    read: async () => ({ hit: null, leased: true }),
    acquire: async () => assert.fail("valid lease must not be updated"),
  }), null);
  assert.deepEqual(time.delays, [500, 1000, 300]);
  assert.equal(time.now(), 1800);
});

test("database errors propagate to the caller's existing bypass handling", async () => {
  await assert.rejects(waitForPlanCache({
    timeoutMs: 200_000,
    read: async () => { throw new Error("database unavailable"); },
    acquire: async () => null,
  }), /database unavailable/);
});
