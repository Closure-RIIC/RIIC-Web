import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import {
  MAX_BUFFERED_PLAN_TASKS,
  PLAN_TASK_WORKER_CONCURRENCY,
  planTaskAdmissionStatus,
  planTaskBufferIsFull,
  planTaskEtaSeconds,
  planTaskIpHmac,
  listenForPlanTaskAvailability,
} from "./plan-task.ts";

test("plan task IP admission keys are deterministic, secret-bound and never contain the address", () => {
  const firstKey = Buffer.alloc(32, 1);
  const secondKey = Buffer.alloc(32, 2);
  const first = planTaskIpHmac("203.0.113.10", firstKey);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, planTaskIpHmac("203.0.113.10", firstKey));
  assert.notEqual(first, planTaskIpHmac("203.0.113.11", firstKey));
  assert.notEqual(first, planTaskIpHmac("203.0.113.10", secondKey));
  assert.equal(first.includes("203.0.113.10"), false);
});

test("plan task admission uses 1000 global slots, 600 new-account slots, and a bounded candidate pool", () => {
  assert.equal(MAX_BUFFERED_PLAN_TASKS, 2_000);
  assert.equal(PLAN_TASK_WORKER_CONCURRENCY, 4);
  assert.equal(planTaskAdmissionStatus({
    activeTotal: 999,
    activeNewAccounts: 600,
    accountClass: "established",
  }), "pending");
  assert.equal(planTaskAdmissionStatus({
    activeTotal: 1_000,
    activeNewAccounts: 0,
    accountClass: "established",
  }), "buffered");
  assert.equal(planTaskAdmissionStatus({
    activeTotal: 599,
    activeNewAccounts: 599,
    accountClass: "new",
  }), "pending");
  assert.equal(planTaskAdmissionStatus({
    activeTotal: 600,
    activeNewAccounts: 600,
    accountClass: "new",
  }), "buffered");
});

test("plan task ETA reflects four solver lanes", () => {
  assert.equal(planTaskEtaSeconds(1), 3);
  assert.equal(planTaskEtaSeconds(4), 3);
  assert.equal(planTaskEtaSeconds(5), 6);
  assert.equal(planTaskEtaSeconds(5, { solverLanes: 4, inFlight: 3, serviceTimeEwmaMs: 4_200 }), 10);
  assert.equal(planTaskEtaSeconds(1, { solverLanes: 4, inFlight: 0, serviceTimeEwmaMs: 4_200 }), 5);
});

test("status polling projects public columns while ordinary claims avoid the promotion lock", async () => {
  const source = await readFile(new URL("./plan-task.ts", import.meta.url), "utf8");
  assert.match(source, /getPlanTask[\s\S]*select\(publicPlanTaskColumns\)/);
  assert.doesNotMatch(source.match(/async function claimPendingPlanTask[\s\S]*?async function promoteBufferedPlanTask/)?.[0] ?? "", /pg_advisory_xact_lock/);
  assert.match(source, /async function promoteBufferedPlanTask[\s\S]*pg_advisory_xact_lock/);
  assert.match(source, /listenForPlanTaskAvailability[\s\S]*LISTEN/);
});

test("task notifications reconnect after a checked-out PostgreSQL client fails", async () => {
  const connections = Array.from({ length: 2 }, () => {
    const client = new EventEmitter() as EventEmitter & {
      queries: string[];
      releasedWith: unknown[];
      query: (sql: string) => Promise<void>;
      release: (error?: unknown) => void;
    };
    client.queries = [];
    client.releasedWith = [];
    client.query = async (sql) => { client.queries.push(sql); };
    client.release = (error) => { client.releasedWith.push(error); };
    return client;
  });
  let connectCount = 0;
  let notifications = 0;
  const stop = await listenForPlanTaskAvailability(() => { notifications += 1; }, {
    connect: async () => connections[connectCount++] as never,
    reconnectDelayMs: 0,
  });

  connections[0].emit("error", new Error("socket reset"));
  await delay(20);
  connections[1].emit("notification", { channel: "plan_task_available" });
  await stop();

  assert.equal(connectCount, 2);
  assert.equal(notifications, 1);
  assert.deepEqual(connections[0].queries, ["LISTEN plan_task_available"]);
  assert.deepEqual(connections[1].queries, ["LISTEN plan_task_available", "UNLISTEN plan_task_available"]);
  assert.equal(connections[0].releasedWith[0] instanceof Error, true);
  assert.deepEqual(connections[1].releasedWith, [undefined]);
});

test("task notifications reconnect when the socket fails while LISTEN is pending", async () => {
  let finishFirstListen: (() => void) | null = null;
  const first = new EventEmitter() as EventEmitter & {
    query: (sql: string) => Promise<void>;
    release: (error?: unknown) => void;
  };
  first.query = () => new Promise<void>((resolve) => { finishFirstListen = resolve; });
  first.release = () => undefined;
  const second = new EventEmitter() as EventEmitter & {
    queries: string[];
    query: (sql: string) => Promise<void>;
    release: (error?: unknown) => void;
  };
  second.queries = [];
  second.query = async (sql) => { second.queries.push(sql); };
  second.release = () => undefined;
  let connectCount = 0;
  const listening = listenForPlanTaskAvailability(() => undefined, {
    connect: async () => (connectCount++ === 0 ? first : second) as never,
    reconnectDelayMs: 0,
  });

  await delay(0);
  first.emit("error", new Error("socket reset during LISTEN"));
  await delay(10);
  assert.equal(connectCount, 1);
  assert.ok(finishFirstListen);
  (finishFirstListen as unknown as () => void)();
  const stop = await listening;
  await delay(20);
  await stop();

  assert.equal(connectCount, 2);
  assert.deepEqual(second.queries, ["LISTEN plan_task_available", "UNLISTEN plan_task_available"]);
});

test("candidate pool rejects the exact 2000-task boundary", () => {
  assert.equal(planTaskBufferIsFull(1_999), false);
  assert.equal(planTaskBufferIsFull(2_000), true);
  assert.equal(planTaskBufferIsFull(2_001), true);
});

test("candidate promotion is durable and randomly selected", async () => {
  const [source, migration] = await Promise.all([
    readFile(new URL("./plan-task.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../../drizzle/0010_harsh_the_stranger.sql", import.meta.url), "utf8"),
  ]);
  assert.match(source, /WHERE candidate\.status = 'buffered'[\s\S]*ORDER BY random\(\)/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /active_for_ip\.request_ip_hmac = candidate\.request_ip_hmac/);
  assert.match(source, /MAX_CONCURRENT_PLAN_ACCOUNTS_PER_IP/);
  assert.match(source, /if \(row\)[\s\S]*promoteBufferedPlanTaskBestEffort\(\)/);
  assert.match(source, /plan_task_buffer_promotion_failed/);
  assert.match(migration, /'buffered', 'pending', 'running'/);
  assert.match(migration, /plan_task_payload_lifecycle_check/);
});

test("expired running tasks release the per-account reservation", async () => {
  const source = await readFile(new URL("./plan-task.ts", import.meta.url), "utf8");
  assert.match(source, /status: "failed",\s+error: "任务已过期，请重新提交。"/);
  assert.match(source, /cleanupExpiredPlanTasks[\s\S]*where\(expiredAtOrBefore\(now\)\)/);
});
