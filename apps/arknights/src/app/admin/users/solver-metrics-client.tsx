"use client";
import { useAdminFetch } from "../admin-context";
import { localize as localize_app_admin_users_solver_metrics_client } from "../../../i18n/helpers/app_admin_users_solver_metrics_client.ts";
import { useTranslations, useLocale } from "use-intl";

import { lazy, Suspense } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonSwap, SkeletonRouteBoundary, SkeletonRouteFallback } from "@/components/ui/skeleton-swap";
import { ADMIN_SOLVER_METRICS_REFRESH_INTERVAL_SECONDS } from "@riic/arknights-domain/solver-metrics-config";
import type { AdminSolverMetricsData } from "@riic/arknights-domain/types";

function MetricsChartLoading() {
  const intl = useTranslations();

  return <SkeletonRouteFallback><Skeleton className="h-[280px] rounded-xl sm:h-[320px]" aria-label={intl("app_admin_users_solver_metrics_client.loadingSolverTrendChart")} /></SkeletonRouteFallback>;
}

const LazyMetricsChart = lazy(() => import("./solver-metrics-chart").then((module) => ({ default: module.AdminSolverMetricsChart })));
function AdminSolverMetricsChart(props: React.ComponentProps<typeof LazyMetricsChart>) {
  return <ClientOnly fallback={<MetricsChartLoading />}><Suspense fallback={<MetricsChartLoading />}><LazyMetricsChart {...props} /></Suspense></ClientOnly>;
}

const PERCENT_FORMATTER = new Intl.NumberFormat("zh-CN", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});
const DECIMAL_FORMATTER = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

type MetricsResponse = {
  data?: AdminSolverMetricsData;
  error?: { message?: string };
};

function percentage(value: number | null, en = false): string {
  return value === null ? (localize_app_admin_users_solver_metrics_client.text(en, "noSamples")) : PERCENT_FORMATTER.format(value);
}

function duration(value: number | null, en = false): string {
  if (value === null) return localize_app_admin_users_solver_metrics_client.text(en, "noSamples");
  return value < 1_000 ? `${value} ms` : `${DECIMAL_FORMATTER.format(value / 1_000)} s`;
}

function Metric({ label, value, detail, dataAttribute }: {
  label: string;
  value: string;
  detail: string;
  dataAttribute?: Record<string, string | number>;
}) {
  return (
    <div className="min-w-0 px-4 py-4 first:pt-0 last:pb-0 md:py-1 md:first:pt-1 md:last:pb-1" {...dataAttribute}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">{value}</p>
      <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
}

export function AdminSolverMetrics() {
  const request = useAdminFetch();
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale === "en";
  const [metrics, setMetrics] = useState<AdminSolverMetricsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setRefreshing(true);
    try {
      const response = await request("/api/admin/solver-metrics", {
        cache: "no-store",
        signal: controller.signal,
      });
      const body = await response.json() as MetricsResponse;
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? (intl("app_admin_users_solver_metrics_client.couldNotLoadSolverMetrics")));
      setMetrics(body.data);
      setError(null);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError(caught instanceof Error ? caught.message : (intl("app_admin_users_solver_metrics_client.couldNotLoadSolverMetrics")));
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setRefreshing(false);
      }
    }
  }, [intl, request]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    refreshWhenVisible();
    const interval = window.setInterval(
      refreshWhenVisible,
      ADMIN_SOLVER_METRICS_REFRESH_INTERVAL_SECONDS * 1_000,
    );
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      const activeRequest = requestRef.current;
      requestRef.current = null;
      activeRequest?.abort();
    };
  }, [load]);

  const hasTrendData = metrics?.solver.trend.some((point) => point.completedCount > 0) ?? false;

  return (
    <section id="solver-metrics" className="scroll-mt-24 overflow-hidden rounded-xl border bg-card" data-admin-solver-metrics>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b px-5 py-5 sm:px-6">
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold tracking-tight">{intl("app_admin_users_solver_metrics_client.liveSolverMetrics")}</h2>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`size-1.5 rounded-full ${error ? "bg-destructive" : metrics ? "bg-emerald-500" : "animate-pulse bg-amber-500"}`} aria-hidden="true" />
              {intl("app_admin_users_solver_metrics_client.refreshesEverySeconds", { ADMIN_SOLVER_METRICS_REFRESH_INTERVAL_SECONDS: ADMIN_SOLVER_METRICS_REFRESH_INTERVAL_SECONDS })}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {metrics ? (intl("app_admin_users_solver_metrics_client.updated", { value1: TIME_FORMATTER.format(new Date(metrics.generatedAt)) })) : (intl("app_admin_users_solver_metrics_client.loadingRecentSolverData"))}
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={refreshing} onClick={() => void load()}>
          <RefreshCw aria-hidden="true" className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? (intl("app_admin_users_solver_metrics_client.refreshing")) : (intl("app_admin_users_solver_metrics_client.refresh"))}
        </Button>
      </header>

      <SkeletonSwap ready={Boolean(metrics) || Boolean(error)} skeleton={(
        <div className="grid gap-4 px-5 py-5 sm:px-6" aria-hidden="true">
          <div className="grid gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-24 rounded-xl" />)}
          </div>
          <Skeleton className="h-[280px] rounded-xl" />
        </div>
      )}>
      {metrics ? (
        <div>
          <div className="grid divide-y px-5 py-5 md:grid-cols-4 md:divide-x md:divide-y-0 md:px-2 sm:px-6">
            <Metric
              label={intl("app_admin_users_solver_metrics_client.errorRateLastMin", { windowMinutes: metrics.solver.windowMinutes })}
              value={percentage(metrics.solver.errorRate, en)}
              detail={intl("app_admin_users_solver_metrics_client.failedCompleted", { failureCount: metrics.solver.failureCount, completedCount: metrics.solver.completedCount })}
              dataAttribute={{ "data-solver-error-rate": metrics.solver.errorRate ?? "unavailable" }}
            />
            <Metric
              label={intl("app_admin_users_solver_metrics_client.completionThroughput")}
              value={`${DECIMAL_FORMATTER.format(metrics.solver.throughputPerMinute)} / min`}
              detail={intl("app_admin_users_solver_metrics_client.succeededFailed", { successCount: metrics.solver.successCount, failureCount: metrics.solver.failureCount })}
            />
            <Metric
              label={intl("app_admin_users_solver_metrics_client.solverComputeTime")}
              value={duration(metrics.solver.averageSolverDurationMs, en)}
              detail={intl("app_admin_users_solver_metrics_client.p95AverageWorkerEndToEnd", { value1: (en) ? (duration(metrics.solver.p95SolverDurationMs, en)) : "", value2: (en) ? (duration(metrics.solver.averageWorkerDurationMs, en)) : "", value3: (en) ? "" : (duration(metrics.solver.p95SolverDurationMs)), value4: (en) ? "" : (duration(metrics.solver.averageWorkerDurationMs)) })}
            />
            <Metric
              label={intl("app_admin_users_solver_metrics_client.currentTaskQueue")}
              value={intl("app_admin_users_solver_metrics_client.queued", { pendingCount: metrics.queue.pendingCount })}
              detail={intl("app_admin_users_solver_metrics_client.candidatesRunningAverageWait", { bufferedCount: metrics.queue.bufferedCount, runningCount: metrics.queue.runningCount, value3: (en) ? (duration(metrics.queue.averageWaitMs, en)) : "", value4: (en) ? "" : (duration(metrics.queue.averageWaitMs)) })}
              dataAttribute={{ "data-pending-task-count": metrics.queue.pendingCount }}
            />
          </div>

          <div className="border-t px-5 py-5 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="font-medium">{intl("app_admin_users_solver_metrics_client.completionTrend")}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{intl("app_admin_users_solver_metrics_client.lastMinMinuteBuckets", { trendWindowMinutes: metrics.solver.trendWindowMinutes, trendBucketMinutes: metrics.solver.trendBucketMinutes })}</p>
              </div>
              {!hasTrendData ? <span className="text-xs text-muted-foreground">{intl("app_admin_users_solver_metrics_client.noCompletedSolvesInThisWindow")}</span> : null}
            </div>
            <div className="mt-4">
              <SkeletonRouteBoundary><AdminSolverMetricsChart trend={metrics.solver.trend} /></SkeletonRouteBoundary>
            </div>
          </div>

          <div className="grid border-t lg:grid-cols-[0.8fr_0.8fr_1.4fr] lg:divide-x">
            <div className="px-5 py-5 sm:px-6">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{intl("app_admin_users_solver_metrics_client.sources15Minutes")}</h3>
              <dl className="mt-3 grid grid-cols-3 gap-3">
                <div><dt className="text-xs text-muted-foreground">MAA</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{metrics.solver.sourceCounts.maa}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{intl("app_admin_users_solver_metrics_client.skland")}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{metrics.solver.sourceCounts.skland}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{intl("app_admin_users_solver_metrics_client.sample")}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{metrics.solver.sourceCounts.sample}</dd></div>
              </dl>
            </div>

            <div className="border-t px-5 py-5 sm:px-6 lg:border-t-0">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{intl("app_admin_users_solver_metrics_client.queueWait15Minutes")}</h3>
              <p className="mt-3 text-lg font-semibold tabular-nums">{duration(metrics.queue.averageWaitMs, en)}</p>
              <p className="mt-1 text-xs text-muted-foreground">P95 {duration(metrics.queue.p95WaitMs, en)}</p>
            </div>

            <div className="border-t px-5 py-5 sm:px-6 lg:border-t-0" data-cache-hit-rate={metrics.cache.hitRate ?? "unavailable"}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{intl("app_admin_users_solver_metrics_client.currentActiveCachePool")}</h3>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${metrics.cache.enabled ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>
                  {metrics.cache.enabled ? (intl("app_admin_users_solver_metrics_client.enabled")) : (intl("app_admin_users_solver_metrics_client.disabled"))}
                </span>
              </div>
              <p className="mt-3 text-2xl font-semibold tabular-nums">{metrics.cache.enabled ? percentage(metrics.cache.hitRate, en) : (intl("app_admin_users_solver_metrics_client.disabled"))}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {intl("app_admin_users_solver_metrics_client.hitsCacheableLookupsReadyEntries", { hitCount: metrics.cache.hitCount, lookupCount: metrics.cache.lookupCount, readyEntryCount: metrics.cache.readyEntryCount })}
                {metrics.cache.fillingEntryCount ? (intl("app_admin_users_solver_metrics_client.filling", { fillingEntryCount: metrics.cache.fillingEntryCount })) : ""}
              </p>
            </div>
          </div>

          <p className="border-t px-5 py-3 text-xs leading-5 text-muted-foreground sm:px-6">
            {intl("app_admin_users_solver_metrics_client.theErrorRateCoversRecordedSolverRunsOnlyIt")}
          </p>
        </div>
      ) : null}
      </SkeletonSwap>

      {error ? (
        <p className="border-t px-5 py-3 text-sm text-destructive sm:px-6" role="status">
          {metrics ? (intl("app_admin_users_solver_metrics_client.liveRefreshFailedShowingTheLastData", { error: error })) : error}
        </p>
      ) : null}
    </section>
  );
}
