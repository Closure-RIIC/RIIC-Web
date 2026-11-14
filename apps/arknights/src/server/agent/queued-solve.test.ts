import assert from "node:assert/strict";
import test from "node:test";
import { waitForQueuedSolve, type QueuedSolveDependencies } from "./queued-solve.ts";
import type { PublicPlanData } from "@riic/arknights-domain/types";
const result = { diagnosticId: "test" } as PublicPlanData;
function fixture(read: QueuedSolveDependencies["read"]) {
  const cancelled: string[] = [];
  let submissions = 0;
  const deps: QueuedSolveDependencies = { submit: async () => { submissions++; return { status: "pending", taskId: "task-1" }; }, read, cancel: async id => { cancelled.push(id); } };
  return { deps, cancelled, count: () => submissions };
}
test("one submission waits through buffered/pending/running and returns the queue result", async () => {
  const states = ["buffered", "pending", "running", "done"];
  const f = fixture(async () => ({ status: states.shift()!, result, error: null }));
  assert.equal(await waitForQueuedSolve(f.deps, { pollMs: 1 }), result);
  assert.equal(f.count(), 1); assert.deepEqual(f.cancelled, []);
});
test("cache hits do not poll or cancel a task", async () => {
  const f = fixture(async () => { throw Error("unexpected poll"); });
  f.deps.submit = async () => ({ status: "done", result });
  assert.equal(await waitForQueuedSolve(f.deps), result); assert.deepEqual(f.cancelled, []);
});
test("pre-cancelled calls never submit", async () => {
  const f = fixture(async () => null);
  await assert.rejects(waitForQueuedSolve(f.deps, { signal: AbortSignal.abort() }), { name: "AbortError" });
  assert.equal(f.count(), 0);
});
test("cancellation during admission still cleans up the returned task ID", async () => {
  const c = new AbortController(); const f = fixture(async () => null);
  f.deps.submit = async () => { c.abort(); return { taskId: "late-task", status: "buffered" }; };
  await assert.rejects(waitForQueuedSolve(f.deps, { signal: c.signal }), { name: "AbortError" });
  assert.deepEqual(f.cancelled, ["late-task"]);
});
for (const status of ["buffered", "running"]) test(`request cancellation stops a ${status} task`, async () => {
  const c = new AbortController(); const f = fixture(async () => { c.abort(); return { status, result: null, error: null }; });
  await assert.rejects(waitForQueuedSolve(f.deps, { signal: c.signal }), { name: "AbortError" });
  assert.deepEqual(f.cancelled, ["task-1"]);
});
test("queue timeout cancels without resubmission", async () => {
  const f = fixture(async () => ({ status: "running", result: null, error: null }));
  await assert.rejects(waitForQueuedSolve(f.deps, { timeoutMs: 5, pollMs: 1 }));
  assert.deepEqual(f.cancelled, ["task-1"]); assert.equal(f.count(), 1);
});
for (const status of ["failed", "cancelled"]) test(`queue ${status} rejects instead of delivering a successful solve`, async () => {
  const f = fixture(async () => ({ status, result: null, error: "solver failed" }));
  await assert.rejects(waitForQueuedSolve(f.deps)); assert.equal(f.count(), 1);
});
test("cleanup retries transient failures without creating a new solve", async () => {
  const f = fixture(async () => { throw Error("read failed"); }); let attempts = 0;
  f.deps.cancel = async () => { if (++attempts < 2) throw Error("db unavailable"); };
  await assert.rejects(waitForQueuedSolve(f.deps), /read failed/); assert.equal(attempts, 2);
});

test("cancellation does not wait for a stalled status read", async () => {
  const c = new AbortController();
  const f = fixture(async () => { c.abort(); return new Promise(() => {}); });
  await assert.rejects(waitForQueuedSolve(f.deps, { signal: c.signal }), { name: "AbortError" });
  assert.deepEqual(f.cancelled, ["task-1"]);
});
