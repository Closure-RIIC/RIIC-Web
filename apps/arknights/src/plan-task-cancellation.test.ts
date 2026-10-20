import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PLAN_TASK_POLL_BACKOFF_MS,
  planTaskCancellationDecision,
  planTaskPollDelayMs,
  planTaskPollErrorDecision,
  planTaskPollResponseDecision,
  runPlanTaskPollAttempt,
} from "./plan-task-cancellation.ts";

test("pending cancellation clears the task only after server confirmation", () => {
  assert.deepEqual(planTaskCancellationDecision({ cancelled: true, reason: null }), {
    clearTask: true,
    message: null,
  });
});

test("running and unavailable cancellation responses preserve polling", () => {
  const running = planTaskCancellationDecision({ cancelled: false, reason: "running" });
  const unavailable = planTaskCancellationDecision({ cancelled: false, reason: "unavailable" });
  assert.equal(running.clearTask, false);
  assert.match(running.message ?? "", /完成后仍会保留结果/);
  assert.equal(unavailable.clearTask, false);
  assert.match(unavailable.message ?? "", /重新查询/);
});

test("buffered and pending tasks stay visibly queued during continuous polling", async () => {
  const source = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
  assert.match(source, /queued: progressionAdjustmentActivity\.active[\s\S]*progressionAdjustmentTask\.status === "buffered"[\s\S]*progressionAdjustmentTask\.status === "pending"/);
  assert.match(source, /: loading && \([\s\S]*planTask\.status === "buffered"[\s\S]*planTask\.status === "pending"[\s\S]*planTask\.pollStopped/);
});

test("plan task polling backs off only for failures and polls active states responsively", async () => {
  const source = await readFile(new URL("./hooks/use-plan-task.ts", import.meta.url), "utf8");
  const policy = await readFile(new URL("./plan-task-cancellation.ts", import.meta.url), "utf8");
  assert.deepEqual(PLAN_TASK_POLL_BACKOFF_MS, [2_000, 4_000, 8_000, 16_000, 32_000]);
  assert.match(policy, /const RUNNING_POLL_MS = 1_000/);
  assert.match(policy, /const BUFFERED_POLL_MS = 30_000/);
  assert.match(policy, /const JITTER_RATIO = 0\.1/);
  assert.match(policy, /status === "running"[\s\S]+RUNNING_POLL_MS/);
  assert.match(policy, /status === "buffered"[\s\S]+BUFFERED_POLL_MS/);
  assert.match(source, /runPlanTaskPollAttempt\(taskId, attempt/);
  assert.match(source, /schedule: schedulePoll/);
  assert.doesNotMatch(source, /STEADY_POLL_MS|60_000/);
});

test("plan task polling follows queue distance with bounded jitter", () => {
  const noJitter = () => 0.5;
  assert.equal(planTaskPollDelayMs({ status: "running" }, noJitter), 1_000);
  assert.equal(planTaskPollDelayMs({ status: "pending", queuePosition: 8 }, noJitter), 2_000);
  assert.equal(planTaskPollDelayMs({ status: "pending", queuePosition: 40 }, noJitter), 5_000);
  assert.equal(planTaskPollDelayMs({ status: "pending", queuePosition: 41 }, noJitter), 15_000);
  assert.equal(planTaskPollDelayMs({ status: "buffered" }, noJitter), 30_000);
  assert.equal(planTaskPollDelayMs({ status: "running" }, () => 0), 900);
  assert.equal(planTaskPollDelayMs({ status: "running" }, () => 1), 1_100);
});

test("poll decisions drive pending to running to done and clear only terminal storage", () => {
  const noJitter = () => 0.5;
  const pending = planTaskPollResponseDecision({
    taskId: "task-1",
    status: "pending",
    queuePosition: 8,
    etaSeconds: 10,
  }, noJitter);
  const running = planTaskPollResponseDecision({ taskId: "task-1", status: "running" }, noJitter);
  const result = { diagnosticId: "result-1", durationMs: 1 } as never;
  const done = planTaskPollResponseDecision({ taskId: "task-1", status: "done", result });

  assert.deepEqual(pending, {
    kind: "continue",
    status: "pending",
    queuePosition: 8,
    etaSeconds: 10,
    delayMs: 2_000,
  });
  assert.deepEqual(running, {
    kind: "continue",
    status: "running",
    queuePosition: undefined,
    etaSeconds: undefined,
    delayMs: 1_000,
  });
  assert.deepEqual(done, { kind: "done", result, clearStoredTask: true });
});

test("poll failures back off, preserve resumable storage, and clear expired tasks", () => {
  assert.deepEqual(planTaskPollErrorDecision(null, 0), {
    kind: "retry",
    delayMs: 2_000,
    nextAttempt: 1,
    clearStoredTask: false,
  });
  assert.deepEqual(planTaskPollErrorDecision(null, 4), {
    kind: "retry",
    delayMs: 32_000,
    nextAttempt: 5,
    clearStoredTask: false,
  });
  assert.deepEqual(planTaskPollErrorDecision(null, 5), {
    kind: "stopped",
    message: "网络异常，请点击查询进度。",
    clearStoredTask: false,
  });
  assert.equal(planTaskPollErrorDecision("AIC-AUTH-2001", 0).clearStoredTask, false);
  assert.equal(planTaskPollErrorDecision("AIC-AUTH-2008", 0).kind, "pause");
  assert.equal(planTaskPollErrorDecision("AIC-AUTH-2008", 5).clearStoredTask, false);
  assert.equal(planTaskPollErrorDecision("AIC-REQ-1001", 0).clearStoredTask, true);
});

test("server Retry-After is a minimum for every scheduled retry, including exhausted backoff", () => {
  assert.equal((planTaskPollErrorDecision("AIC-RATE-6001", 0, 10_000) as { delayMs: number }).delayMs, 10_000);
  assert.equal((planTaskPollErrorDecision("AIC-RATE-6001", 5, 40_000) as { delayMs: number }).delayMs, 40_000);
  assert.equal(planTaskPollErrorDecision("AIC-AUTH-2001", 0, 10_000).kind, "pause");
});

function pollingHarness(outcomes: Array<unknown>) {
  let currentTaskId: string | null = "task-1";
  let storedTaskId: string | null = "task-1";
  let state = "pending";
  const timers: Array<{ taskId: string; attempt: number; delayMs: number }> = [];
  const done: unknown[] = [];
  const failures: string[] = [];
  const effects = {
    poll: async () => {
      const outcome = outcomes.shift();
      if (outcome instanceof Error) throw outcome;
      return outcome as never;
    },
    isCurrent: (taskId: string) => currentTaskId === taskId,
    errorCode: (error: unknown) => error instanceof Error && "code" in error
      ? String((error as Error & { code: unknown }).code)
      : null,
    finishDone: (result: unknown) => {
      done.push(result);
      state = "done";
      storedTaskId = null;
      currentTaskId = null;
      timers.length = 0;
    },
    finishTerminal: (status: "failed" | "cancelled", message: string, notifyFailure: boolean) => {
      state = status;
      storedTaskId = null;
      currentTaskId = null;
      timers.length = 0;
      if (notifyFailure) failures.push(message);
    },
    continueActive: (decision: { status: string }) => { state = decision.status; },
    schedule: (taskId: string, attempt: number, delayMs: number) => {
      timers.splice(0, timers.length, { taskId, attempt, delayMs });
    },
    pause: () => { state = "paused"; timers.length = 0; },
    stop: () => { state = "stopped"; timers.length = 0; },
  };
  return {
    effects,
    timers,
    done,
    failures,
    state: () => state,
    storedTaskId: () => storedTaskId,
  };
}

test("poll attempt wiring drives pending to running to done with one timer and terminal storage cleanup", async () => {
  const result = { diagnosticId: "result-1", durationMs: 1 } as never;
  const harness = pollingHarness([
    { taskId: "task-1", status: "pending", queuePosition: 3 },
    { taskId: "task-1", status: "running" },
    { taskId: "task-1", status: "done", result },
  ]);

  await runPlanTaskPollAttempt("task-1", 0, harness.effects);
  assert.equal(harness.state(), "pending");
  assert.equal(harness.timers.length, 1);
  assert.equal(harness.storedTaskId(), "task-1");

  await runPlanTaskPollAttempt("task-1", harness.timers[0].attempt, harness.effects);
  assert.equal(harness.state(), "running");
  assert.equal(harness.timers.length, 1);

  await runPlanTaskPollAttempt("task-1", harness.timers[0].attempt, harness.effects);
  assert.equal(harness.state(), "done");
  assert.equal(harness.timers.length, 0);
  assert.equal(harness.storedTaskId(), null);
  assert.deepEqual(harness.done, [result]);
});

test("poll attempt wiring handles failed and cancelled terminal responses", async () => {
  const failed = pollingHarness([{ taskId: "task-1", status: "failed", error: "solver failed" }]);
  await runPlanTaskPollAttempt("task-1", 0, failed.effects);
  assert.equal(failed.state(), "failed");
  assert.equal(failed.storedTaskId(), null);
  assert.deepEqual(failed.failures, ["solver failed"]);

  const cancelled = pollingHarness([{ taskId: "task-1", status: "cancelled" }]);
  await runPlanTaskPollAttempt("task-1", 0, cancelled.effects);
  assert.equal(cancelled.state(), "cancelled");
  assert.equal(cancelled.storedTaskId(), null);
  assert.deepEqual(cancelled.failures, []);
});

test("poll attempt wiring preserves resumable tasks for login and network failures but clears invalid auth", async () => {
  const codedError = (code: string) => Object.assign(new Error(code), { code });
  const paused = pollingHarness([codedError("AIC-AUTH-2001")]);
  await runPlanTaskPollAttempt("task-1", 0, paused.effects);
  assert.equal(paused.state(), "paused");
  assert.equal(paused.storedTaskId(), "task-1");

  const retrying = pollingHarness([new Error("network")]);
  await runPlanTaskPollAttempt("task-1", 0, retrying.effects);
  assert.equal(retrying.timers.length, 1);
  assert.equal(retrying.timers[0].attempt, 1);
  assert.equal(retrying.storedTaskId(), "task-1");

  const stopped = pollingHarness([new Error("network")]);
  await runPlanTaskPollAttempt("task-1", PLAN_TASK_POLL_BACKOFF_MS.length, stopped.effects);
  assert.equal(stopped.state(), "stopped");
  assert.equal(stopped.storedTaskId(), "task-1");

  const invalid = pollingHarness([codedError("AIC-AUTH-2002")]);
  await runPlanTaskPollAttempt("task-1", 0, invalid.effects);
  assert.equal(invalid.state(), "failed");
  assert.equal(invalid.storedTaskId(), null);
});
