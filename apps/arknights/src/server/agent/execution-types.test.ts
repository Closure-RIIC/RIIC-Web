import assert from "node:assert/strict";
import test from "node:test";
import { AgentToolError, waitForTool } from "./execution-types.ts";

test("timeout ends waiting while late success remains observable", async () => {
  let resolve!: (value: number) => void;
  const work = new Promise<number>(done => { resolve = done; });
  await assert.rejects(waitForTool(work, 5), (error: unknown) => error instanceof AgentToolError && error.code === "tool_wait_timeout");
  resolve(42);
  assert.equal(await work, 42);
});

test("cancellation does not claim the computation stopped or hide its late failure", async () => {
  const controller = new AbortController();
  let reject!: (error: Error) => void;
  const work = new Promise<never>((_, fail) => { reject = fail; });
  const waiting = waitForTool(work, 100_000, controller.signal);
  controller.abort();
  await assert.rejects(waiting, (error: unknown) => error instanceof AgentToolError && error.code === "tool_wait_cancelled");
  reject(new Error("late solver error"));
  await assert.rejects(work, /late solver error/);
});

test("completed work clears the waiting timer and abort listener", async () => {
  const controller = new AbortController();
  assert.equal(await waitForTool(Promise.resolve(7), 100_000, controller.signal), 7);
  controller.abort();
});
