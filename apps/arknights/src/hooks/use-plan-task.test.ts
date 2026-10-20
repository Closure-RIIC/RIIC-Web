import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

register("../../../../scripts/ts-path-loader.mjs", import.meta.url);

type PollOutcome = {
  taskId: string;
  status: "buffered" | "pending" | "running" | "done" | "failed" | "cancelled";
  queuePosition?: number;
  result?: { diagnosticId: string; durationMs: number };
  error?: string;
} | Error;

test("usePlanTask owns polling timers and resumable storage across terminal and recoverable states", async (context) => {
  const pollOutcomes: Array<PollOutcome | Promise<PollOutcome>> = [];
  let pollCalls = 0;
  class MockApiClientError extends Error {
    readonly code: string;
    readonly retryAfterSeconds?: number;

    constructor(code: string, retryAfterSeconds?: number) {
      super(code);
      this.code = code;
      this.retryAfterSeconds = retryAfterSeconds;
    }
  }
  await context.mock.module(new URL("../api.ts", import.meta.url), {
    namedExports: {
      ApiClientError: MockApiClientError,
      cancelPlanTask: async () => ({ cancelled: true, reason: null }),
      pollPlanTask: async () => {
        pollCalls++;
        const outcome = await pollOutcomes.shift();
        if (outcome instanceof Error) throw outcome;
        if (!outcome) throw new Error("missing poll fixture");
        return outcome;
      },
    },
  });

  const windowMock = new EventTarget();
  const documentMock = Object.assign(new EventTarget(), { visibilityState: "visible" });
  for (const [key, value] of [["window", windowMock], ["document", documentMock]] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    context.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  let now = 100_000;
  context.mock.method(Date, "now", () => now);

  const storage = new Map<string, string>();
  const localStorageMock = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  };
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: localStorageMock });
  context.after(() => {
    if (localStorageDescriptor) Object.defineProperty(globalThis, "localStorage", localStorageDescriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });

  let nextTimerId = 1;
  const timeouts = new Map<number, () => void>();
  const intervals = new Map<number, () => void>();
  context.mock.method(globalThis, "setTimeout", ((callback: () => void) => {
    const id = nextTimerId;
    nextTimerId += 1;
    timeouts.set(id, callback);
    return id;
  }) as typeof setTimeout);
  context.mock.method(globalThis, "clearTimeout", ((id: number) => { timeouts.delete(id); }) as typeof clearTimeout);
  context.mock.method(globalThis, "setInterval", ((callback: () => void) => {
    const id = nextTimerId;
    nextTimerId += 1;
    intervals.set(id, callback);
    return id;
  }) as typeof setInterval);
  context.mock.method(globalThis, "clearInterval", ((id: number) => { intervals.delete(id); }) as typeof clearInterval);

  const { usePlanTask } = await import("./use-plan-task.ts");
  const doneResults: unknown[] = [];
  const failureMessages: string[] = [];
  let hookStorageKey: string | null | undefined = undefined;
  let hook: ReturnType<typeof usePlanTask> | null = null;
  function Harness() {
    hook = usePlanTask({
      onDone: (result) => doneResults.push(result),
      onFailed: (message) => failureMessages.push(message),
      ...(hookStorageKey === null ? { storageKey: null } : {}),
    });
    return null;
  }

  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(React.createElement(Harness)); });
  const current = () => {
    assert.ok(hook);
    return hook;
  };
  const begin = async (taskId: string, outcomes: PollOutcome[]) => {
    pollOutcomes.push(...outcomes);
    await act(async () => { current().begin(taskId); });
  };
  const fireNextPoll = async () => {
    assert.equal(timeouts.size, 1);
    const [id, callback] = [...timeouts.entries()][0];
    timeouts.delete(id);
    await act(async () => { callback(); });
  };

  const result = { diagnosticId: "result-1", durationMs: 1 };
  await begin("task-done", [
    { taskId: "task-done", status: "pending", queuePosition: 3 },
    { taskId: "task-done", status: "running" },
    { taskId: "task-done", status: "done", result },
  ]);
  assert.equal(timeouts.size, 1);
  assert.ok(storage.has("aic-plan-task-v1"));
  await fireNextPoll();
  assert.equal(timeouts.size, 1);
  await fireNextPoll();
  assert.equal(timeouts.size, 0);
  assert.equal(storage.has("aic-plan-task-v1"), false);
  assert.deepEqual(doneResults, [result]);

  pollOutcomes.push({ taskId: "task-awaited", status: "done", result });
  let awaitedResult: unknown;
  await act(async () => {
    awaitedResult = await current().run({ taskId: "task-awaited", status: "pending", queuePosition: 1 });
  });
  assert.equal((awaitedResult as typeof result).diagnosticId, result.diagnosticId);
  assert.deepEqual(doneResults, [result, result]);

  await begin("task-failed", [{ taskId: "task-failed", status: "failed", error: "solver failed" }]);
  assert.equal(storage.has("aic-plan-task-v1"), false);
  assert.equal(timeouts.size, 0);
  assert.deepEqual(failureMessages, ["solver failed"]);

  await begin("task-cancelled", [{ taskId: "task-cancelled", status: "cancelled" }]);
  assert.equal(storage.has("aic-plan-task-v1"), false);
  assert.equal(timeouts.size, 0);
  assert.deepEqual(failureMessages, ["solver failed"]);

  await begin("task-login", [new MockApiClientError("AIC-AUTH-2001")]);
  assert.ok(storage.has("aic-plan-task-v1"));
  assert.equal(timeouts.size, 0);
  await act(async () => {
    windowMock.dispatchEvent(new Event("online"));
    documentMock.dispatchEvent(new Event("visibilitychange"));
  });
  assert.equal(timeouts.size, 0, "login pauses must not automatically retry");

  await begin("task-website-login", [new MockApiClientError("AIC-AUTH-2008")]);
  const beforeWebsiteLoginRecovery = pollCalls;
  await act(async () => {
    windowMock.dispatchEvent(new Event("online"));
    documentMock.dispatchEvent(new Event("visibilitychange"));
  });
  assert.equal(timeouts.size, 0, "website session expiry pauses without network backoff");
  assert.equal(pollCalls, beforeWebsiteLoginRecovery);
  assert.ok(storage.has("aic-plan-task-v1"));

  await begin("task-retry", [new Error("network")]);
  assert.ok(storage.has("aic-plan-task-v1"));
  assert.equal(timeouts.size, 1);

  await begin("task-stopped", Array.from({ length: 6 }, () => new Error("network")));
  for (let attempt = 0; attempt < 5; attempt += 1) await fireNextPoll();
  assert.ok(storage.has("aic-plan-task-v1"));
  assert.equal(timeouts.size, 0);
  assert.equal(current().pollStopped, true);
  assert.equal(intervals.size, 0, "network recovery has no extra 30-second lock");
  assert.equal(current().resumeDisabled, false);
  pollOutcomes.push({ taskId: "task-stopped", status: "running" });
  await act(async () => {
    windowMock.dispatchEvent(new Event("online"));
    documentMock.dispatchEvent(new Event("visibilitychange"));
    current().resume();
  });
  assert.equal(current().pollStopped, false);
  assert.equal(pollOutcomes.length, 0);
  assert.equal(timeouts.size, 1, "simultaneous recovery and manual triggers use one poll");
  await act(async () => { current().resume(); });
  assert.equal(timeouts.size, 1, "manual queries inside one second cannot replace the timer");

  now += 1_000;
  await begin("task-limited", [new MockApiClientError("AIC-RATE-6001", 10)]);
  assert.equal(current().resumeCountdown, 10);
  assert.equal(timeouts.size, 1);
  await act(async () => { current().resume(); });
  assert.equal(timeouts.size, 1);
  now += 9_999;
  await act(async () => { current().resume(); });
  assert.equal(timeouts.size, 1);
  now += 1;
  pollOutcomes.push({ taskId: "task-limited", status: "done", result });
  await act(async () => { current().resume(); });
  assert.equal(current().status, "done");
  assert.equal(timeouts.size, 0);

  let resolveSlow!: (value: PollOutcome) => void;
  pollOutcomes.push(new Promise<PollOutcome>((resolve) => { resolveSlow = resolve; }));
  await act(async () => { current().begin("task-slow"); });
  const callsBefore = pollCalls;
  now += 2_000;
  await act(async () => { current().resume(); current().resume(); });
  assert.equal(pollCalls, callsBefore, "in-flight query blocks duplicates even after the one-second interval");
  await act(async () => { await current().cancel(); });
  assert.equal(current().status, "cancelled");
  const completedBefore = doneResults.length;
  await act(async () => { resolveSlow({ taskId: "task-slow", status: "done", result }); });
  assert.equal(current().status, "cancelled", "late query response cannot undo confirmed cancellation");
  assert.equal(doneResults.length, completedBefore);
  assert.equal(timeouts.size, 0);

  await act(async () => { renderer.unmount(); });
  assert.equal(timeouts.size, 0);
  assert.equal(intervals.size, 0);

  storage.clear();
  hook = null;
  await act(async () => { renderer = create(React.createElement(Harness)); });

  await begin("task-invalid", [new MockApiClientError("AIC-AUTH-2002")]);
  assert.equal(storage.has("aic-plan-task-v1"), false);
  assert.equal(timeouts.size, 0);

  await begin("task-unmount", [{ taskId: "task-unmount", status: "pending" }]);
  assert.equal(timeouts.size, 1);
  await act(async () => { renderer.unmount(); });
  assert.equal(timeouts.size, 0);
  assert.equal(intervals.size, 0);

  storage.clear();
  hookStorageKey = null;
  hook = null;
  await act(async () => { renderer = create(React.createElement(Harness)); });
  await begin("task-nonpersistent", [{ taskId: "task-nonpersistent", status: "pending", queuePosition: 2 }]);
  assert.equal(storage.size, 0);
  assert.equal(timeouts.size, 1);
  await act(async () => { renderer.unmount(); });
  assert.equal(timeouts.size, 0);
  hookStorageKey = undefined;
  storage.set("aic-plan-task-v1", JSON.stringify({ taskId: "task-strict-restore" }));
  pollOutcomes.push({ taskId: "task-strict-restore", status: "pending" });
  const beforeStrictRestore = pollCalls;
  await act(async () => { renderer = create(React.createElement(React.StrictMode, null, React.createElement(Harness))); });
  assert.equal(pollCalls, beforeStrictRestore + 1, "StrictMode effect replay restores the task exactly once");
  assert.equal(current().taskId, "task-strict-restore");
  assert.equal(timeouts.size, 1, "StrictMode cleanup does not lose the restored polling loop");
  pollOutcomes.push({ taskId: "task-strict-restore", status: "done", result });
  await fireNextPoll();
  assert.equal(current().status, "done");
  assert.equal(storage.has("aic-plan-task-v1"), false);
  await act(async () => { renderer.unmount(); });
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});
