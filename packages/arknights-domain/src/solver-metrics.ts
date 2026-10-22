import type { AdminSolverMetricsData } from "./types";
import {
  ADMIN_SOLVER_ERROR_WINDOW_MINUTES,
  ADMIN_SOLVER_TREND_BUCKET_MINUTES,
  ADMIN_SOLVER_TREND_WINDOW_MINUTES,
} from "./solver-metrics-config.ts";

type AdminSolverMetricTrendInput = {
  bucketStartedAt: Date;
  successCount: number;
  failureCount: number;
  averageDurationMs: number | null;
};

type AdminSolverMetricCounts = {
  generatedAt: Date;
  cacheEnabled: boolean;
  successCount: number;
  failureCount: number;
  averageDurationMs: number | null;
  p95DurationMs: number | null;
  averageSolverDurationMs: number | null;
  p95SolverDurationMs: number | null;
  averageWorkerDurationMs: number | null;
  maaCount: number;
  sklandCount: number;
  sampleCount: number;
  bufferedTaskCount: number;
  pendingTaskCount: number;
  runningTaskCount: number;
  averageWaitMs: number | null;
  p95WaitMs: number | null;
  trend: AdminSolverMetricTrendInput[];
  cacheHitCount: number;
  cacheMissCount: number;
  readyCacheEntryCount: number;
  fillingCacheEntryCount: number;
};

function count(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function duration(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
}

function floorToTrendBucket(value: Date): number {
  const bucketMs = ADMIN_SOLVER_TREND_BUCKET_MINUTES * 60_000;
  return Math.floor(value.getTime() / bucketMs) * bucketMs;
}

function buildTrend(generatedAt: Date, rows: AdminSolverMetricTrendInput[]): AdminSolverMetricsData["solver"]["trend"] {
  const bucketCount = ADMIN_SOLVER_TREND_WINDOW_MINUTES / ADMIN_SOLVER_TREND_BUCKET_MINUTES;
  const bucketMs = ADMIN_SOLVER_TREND_BUCKET_MINUTES * 60_000;
  const lastBucketAt = floorToTrendBucket(generatedAt);
  const firstBucketAt = lastBucketAt - (bucketCount - 1) * bucketMs;
  const byBucket = new Map<number, AdminSolverMetricTrendInput>();

  for (const row of rows) {
    const bucketAt = floorToTrendBucket(row.bucketStartedAt);
    if (Number.isFinite(bucketAt) && bucketAt >= firstBucketAt && bucketAt <= lastBucketAt) {
      byBucket.set(bucketAt, row);
    }
  }

  return Array.from({ length: bucketCount }, (_, index) => {
    const bucketAt = firstBucketAt + index * bucketMs;
    const row = byBucket.get(bucketAt);
    const successCount = count(row?.successCount ?? 0);
    const failureCount = count(row?.failureCount ?? 0);
    const completedCount = successCount + failureCount;
    return {
      bucketStartedAt: new Date(bucketAt).toISOString(),
      successCount,
      failureCount,
      completedCount,
      errorRate: rate(failureCount, completedCount),
      averageDurationMs: duration(row?.averageDurationMs ?? null),
    };
  });
}

export function buildAdminSolverMetricsData(input: AdminSolverMetricCounts): AdminSolverMetricsData {
  const successCount = count(input.successCount);
  const failureCount = count(input.failureCount);
  const completedCount = successCount + failureCount;
  const hitCount = count(input.cacheHitCount);
  const readyEntryCount = count(input.readyCacheEntryCount);
  const fillingEntryCount = count(input.fillingCacheEntryCount);
  const missCount = count(input.cacheMissCount);
  const lookupCount = hitCount + missCount;

  return {
    generatedAt: input.generatedAt.toISOString(),
    solver: {
      windowMinutes: ADMIN_SOLVER_ERROR_WINDOW_MINUTES,
      successCount,
      failureCount,
      completedCount,
      errorRate: rate(failureCount, completedCount),
      throughputPerMinute: Math.round((completedCount / ADMIN_SOLVER_ERROR_WINDOW_MINUTES) * 100) / 100,
      averageDurationMs: duration(input.averageDurationMs),
      p95DurationMs: duration(input.p95DurationMs),
      averageSolverDurationMs: duration(input.averageSolverDurationMs),
      p95SolverDurationMs: duration(input.p95SolverDurationMs),
      averageWorkerDurationMs: duration(input.averageWorkerDurationMs),
      trendWindowMinutes: ADMIN_SOLVER_TREND_WINDOW_MINUTES,
      trendBucketMinutes: ADMIN_SOLVER_TREND_BUCKET_MINUTES,
      sourceCounts: {
        maa: count(input.maaCount),
        skland: count(input.sklandCount),
        sample: count(input.sampleCount),
      },
      trend: buildTrend(input.generatedAt, input.trend),
    },
    queue: {
      bufferedCount: count(input.bufferedTaskCount),
      pendingCount: count(input.pendingTaskCount),
      runningCount: count(input.runningTaskCount),
      averageWaitMs: duration(input.averageWaitMs),
      p95WaitMs: duration(input.p95WaitMs),
    },
    cache: {
      enabled: input.cacheEnabled,
      hitCount,
      missCount,
      lookupCount,
      hitRate: rate(hitCount, lookupCount),
      readyEntryCount,
      fillingEntryCount,
    },
  };
}
