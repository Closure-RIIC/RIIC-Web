import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildAdminSolverMetricsData } from "./solver-metrics.ts";

function metricInput(overrides: Partial<Parameters<typeof buildAdminSolverMetricsData>[0]> = {}) {
  return {
    generatedAt: new Date("2026-09-01T08:02:00.000Z"),
    cacheEnabled: true,
    successCount: 18,
    failureCount: 2,
    averageDurationMs: 1_240,
    p95DurationMs: 2_890,
    averageSolverDurationMs: 900,
    p95SolverDurationMs: 1_800,
    averageWorkerDurationMs: 1_100,
    maaCount: 12,
    sklandCount: 5,
    sampleCount: 3,
    bufferedTaskCount: 3,
    pendingTaskCount: 2,
    runningTaskCount: 1,
    averageWaitMs: 340,
    p95WaitMs: 810,
    trend: [
      { bucketStartedAt: new Date("2026-09-01T07:56:00.000Z"), successCount: 4, failureCount: 1, averageDurationMs: 1_100 },
      { bucketStartedAt: new Date("2026-09-01T08:00:00.000Z"), successCount: 2, failureCount: 0, averageDurationMs: 900 },
    ],
    cacheHitCount: 8,
    cacheMissCount: 2,
    readyCacheEntryCount: 2,
    fillingCacheEntryCount: 1,
    ...overrides,
  };
}

test("admin solver metrics calculate errors, latency, throughput, queue, and active-cache hit rate", () => {
  const metrics = buildAdminSolverMetricsData(metricInput());

  assert.deepEqual(metrics.solver.sourceCounts, { maa: 12, skland: 5, sample: 3 });
  assert.equal(metrics.solver.windowMinutes, 15);
  assert.equal(metrics.solver.trendWindowMinutes, 60);
  assert.equal(metrics.solver.trendBucketMinutes, 5);
  assert.equal(metrics.solver.completedCount, 20);
  assert.equal(metrics.solver.errorRate, 0.1);
  assert.equal(metrics.solver.throughputPerMinute, 1.33);
  assert.equal(metrics.solver.averageDurationMs, 1_240);
  assert.equal(metrics.solver.p95DurationMs, 2_890);
  assert.equal(metrics.solver.averageSolverDurationMs, 900);
  assert.equal(metrics.solver.p95SolverDurationMs, 1_800);
  assert.equal(metrics.solver.averageWorkerDurationMs, 1_100);
  assert.deepEqual(metrics.queue, {
    bufferedCount: 3,
    pendingCount: 2,
    runningCount: 1,
    averageWaitMs: 340,
    p95WaitMs: 810,
  });
  assert.deepEqual(metrics.cache, {
    enabled: true,
    hitCount: 8,
    missCount: 2,
    lookupCount: 10,
    hitRate: 0.8,
    readyEntryCount: 2,
    fillingEntryCount: 1,
  });
});

test("admin solver metrics fill missing five-minute trend buckets", () => {
  const metrics = buildAdminSolverMetricsData(metricInput());

  assert.equal(metrics.solver.trend.length, 12);
  assert.equal(metrics.solver.trend[0]?.bucketStartedAt, "2026-09-01T07:05:00.000Z");
  assert.deepEqual(metrics.solver.trend.at(-2), {
    bucketStartedAt: "2026-09-01T07:55:00.000Z",
    successCount: 4,
    failureCount: 1,
    completedCount: 5,
    errorRate: 0.2,
    averageDurationMs: 1_100,
  });
  assert.equal(metrics.solver.trend.at(-1)?.completedCount, 2);
});

test("admin solver metrics report unavailable rates and durations without samples", () => {
  const metrics = buildAdminSolverMetricsData(metricInput({
    cacheEnabled: false,
    successCount: 0,
    failureCount: 0,
    averageDurationMs: null,
    p95DurationMs: null,
    averageWaitMs: null,
    p95WaitMs: null,
    trend: [],
    cacheHitCount: 0,
    cacheMissCount: 0,
    readyCacheEntryCount: 0,
    fillingCacheEntryCount: 0,
  }));

  assert.equal(metrics.solver.errorRate, null);
  assert.equal(metrics.solver.averageDurationMs, null);
  assert.equal(metrics.cache.hitRate, null);
  assert.equal(metrics.solver.completedCount, 0);
  assert.equal(metrics.cache.lookupCount, 0);
  assert.equal(metrics.solver.trend.every((point) => point.completedCount === 0), true);
});

test("admin solver metrics normalize invalid database values before exposing them", () => {
  const metrics = buildAdminSolverMetricsData(metricInput({
    successCount: Number.NaN,
    failureCount: -1,
    averageDurationMs: Number.POSITIVE_INFINITY,
    p95DurationMs: -4,
    maaCount: -2,
    bufferedTaskCount: Number.POSITIVE_INFINITY,
    pendingTaskCount: Number.NaN,
    averageWaitMs: -20,
    trend: [{ bucketStartedAt: new Date("invalid"), successCount: 4, failureCount: 1, averageDurationMs: 10 }],
    cacheHitCount: 1.9,
    cacheMissCount: 0,
    readyCacheEntryCount: -2,
    fillingCacheEntryCount: Number.POSITIVE_INFINITY,
  }));

  assert.equal(metrics.solver.completedCount, 0);
  assert.equal(metrics.solver.averageDurationMs, null);
  assert.equal(metrics.solver.p95DurationMs, 0);
  assert.equal(metrics.solver.sourceCounts.maa, 0);
  assert.equal(metrics.queue.bufferedCount, 0);
  assert.equal(metrics.queue.pendingCount, 0);
  assert.equal(metrics.queue.averageWaitMs, 0);
  assert.equal(metrics.cache.hitCount, 1);
  assert.equal(metrics.cache.lookupCount, 1);
  assert.equal(metrics.cache.hitRate, 1);
  assert.equal(metrics.cache.fillingEntryCount, 0);
});

test("admin solver metrics authenticate before querying and disable response caching", async () => {
  const source = await readFile(new URL("../../../apps/arknights/src/server/admin-solver-metrics-api.ts", import.meta.url), "utf8");
  const authorization = source.indexOf("await requireWebsiteReviewer(request)");
  const query = source.indexOf("await queryAdminSolverMetrics()");

  assert.equal(authorization > 0, true);
  assert.equal(query > authorization, true);
  assert.equal(source.includes('response.headers.set("Cache-Control", "private, no-store, max-age=0")'), true);
  assert.equal(source.match(/noStore\(/g)?.length, 3);
});

test("admin solver metrics polling deduplicates requests and pauses in hidden tabs", async () => {
  const source = await readFile(new URL("../../../apps/arknights/src/app/admin/users/solver-metrics-client.tsx", import.meta.url), "utf8");

  assert.equal(source.includes("if (requestRef.current) return"), true);
  assert.equal(source.includes('document.visibilityState === "visible"'), true);
  assert.equal(source.includes('document.addEventListener("visibilitychange", refreshWhenVisible)'), true);
  assert.equal(source.includes('cache: "no-store"'), true);
  assert.equal(source.includes("activeRequest?.abort()"), true);
});

test("admin routes split overview, issue triage, and users while keeping the accessible metrics chart", async () => {
  const [page, issuesPage, usersPage, chartClient, chart] = await Promise.all([
    readFile(new URL("../../../apps/arknights/src/app/admin/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../apps/arknights/src/routes/admin.issues.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../apps/arknights/src/app/admin/users/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../apps/arknights/src/app/admin/users/solver-metrics-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../apps/arknights/src/app/admin/users/solver-metrics-chart.tsx", import.meta.url), "utf8"),
  ]);

  assert.equal(page.includes("<SolverVersion"), true);
  assert.equal(page.includes("<AdminSolverMetrics"), true);
  assert.equal(page.includes("<AdminUserManagement"), false);
  assert.equal(issuesPage.includes("<AdminIssues"), true);
  assert.equal(usersPage.includes("<AdminUserManagement"), true);
  assert.equal(chartClient.includes("lazy("), true);
  assert.equal(chartClient.includes("<ClientOnly"), true);
  assert.equal(chart.includes("<AreaChart accessibilityLayer"), true);
  assert.equal(chart.match(/<Area/g)?.length, 3);
});
