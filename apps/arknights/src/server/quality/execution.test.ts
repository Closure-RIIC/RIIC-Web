import test from "node:test";
import assert from "node:assert/strict";
import { boundedExecution } from "./execution.ts";

test("an unresponsive transport cannot outlive the execution deadline", async () => {
  let stopped = 0;
  await assert.rejects(boundedExecution(() => new Promise(() => {}), async () => { stopped++; }, { timeoutMs: 20, cancelled: async () => false }), /timed out/);
  assert.equal(stopped, 1);
});
test("cancellation and lost sources reap the process; successful work also reaps it", async () => {
  let stopped = 0;
  const stop = async () => { stopped++; };
  await assert.rejects(boundedExecution(() => new Promise(() => {}), stop, { timeoutMs: 1000, pollMs: 5, cancelled: async () => true }), /cancelled/);
  await assert.rejects(boundedExecution(() => new Promise(() => {}), stop, { timeoutMs: 1000, pollMs: 5, cancelled: async () => { throw new Error("Expired source"); } }), /source unavailable/);
  assert.equal(await boundedExecution(async () => 42, stop, { timeoutMs: 1000, cancelled: async () => false }), 42);
  assert.equal(stopped, 3);
});
