import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { registerProcessCleanup, type ProcessCleanupTarget } from "./process-cleanup.ts";

test("process cleanup leaves SIGINT and SIGTERM entirely to the HTTP runtime", () => {
  const target = new EventEmitter();
  const reasons: string[] = [];
  registerProcessCleanup(target as ProcessCleanupTarget, (reason) => reasons.push(reason));

  assert.equal(target.listenerCount("SIGINT"), 0);
  assert.equal(target.listenerCount("SIGTERM"), 0);
  assert.equal(target.emit("SIGINT"), false);
  assert.equal(target.emit("SIGTERM"), false);
  assert.deepEqual(reasons, []);
});

test("process cleanup releases the Worker only after the HTTP runtime reaches process exit", () => {
  const target = new EventEmitter();
  const reasons: string[] = [];
  const unregister = registerProcessCleanup(target as ProcessCleanupTarget, (reason) => reasons.push(reason));

  assert.equal(target.emit("exit"), true);
  assert.deepEqual(reasons, ["进程退出，正在关闭 infra-cli serve。"]);

  unregister();
  assert.equal(target.listenerCount("exit"), 0);
});
