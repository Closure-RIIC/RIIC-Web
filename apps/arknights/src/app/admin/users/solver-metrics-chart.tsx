"use client";
import { localize as localize_app_admin_users_solver_metrics_chart } from "../../../i18n/helpers/app_admin_users_solver_metrics_chart.ts";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { AdminSolverMetricsData } from "@riic/arknights-domain/types";
import { useLocale } from "use-intl";

function chartConfig(en: boolean): ChartConfig { return {
  successCount: {
    label: localize_app_admin_users_solver_metrics_chart.text(en, "success"),
    theme: {
      light: "oklch(0.58 0.14 166)",
      dark: "oklch(0.72 0.13 166)",
    },
  },
  failureCount: {
    label: localize_app_admin_users_solver_metrics_chart.text(en, "failure"),
    theme: {
      light: "oklch(0.62 0.2 24)",
      dark: "oklch(0.72 0.16 24)",
    },
  },
}; }

function formatTime(value: string, formatter: Intl.DateTimeFormat): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? formatter.format(date) : value;
}

export function AdminSolverMetricsChart({
  trend,
}: {
  trend: AdminSolverMetricsData["solver"]["trend"];
}) {
  const locale = useLocale();
  const en = locale === "en";
  const axisTimeFormatter = new Intl.DateTimeFormat((locale === "en" ? "en-US" : "zh-CN"), { hour: "2-digit", minute: "2-digit" });
  const tooltipTimeFormatter = new Intl.DateTimeFormat((locale === "en" ? "en-US" : "zh-CN"), { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <ChartContainer
      config={chartConfig(en)}
      className="h-[280px] min-h-[280px] w-full sm:h-[320px]"
      data-admin-solver-trend-chart
    >
      <AreaChart accessibilityLayer data={trend} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 4" />
        <XAxis
          dataKey="bucketStartedAt"
          axisLine={false}
          tickLine={false}
          tickMargin={10}
          minTickGap={28}
          tickFormatter={(value: string) => formatTime(value, axisTimeFormatter)}
        />
        <YAxis allowDecimals={false} axisLine={false} tickLine={false} tickMargin={8} width={28} />
        <ChartTooltip
          cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }}
          content={(
            <ChartTooltipContent
              indicator="line"
              labelFormatter={(value) => formatTime(String(value), tooltipTimeFormatter)}
            />
          )}
        />
        <ChartLegend content={<ChartLegendContent />} />
        <defs>
          <linearGradient id="admin-success-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-successCount)" stopOpacity={0.5} />
            <stop offset="95%" stopColor="var(--color-successCount)" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="admin-failure-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-failureCount)" stopOpacity={0.42} />
            <stop offset="95%" stopColor="var(--color-failureCount)" stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <Area
          dataKey="successCount"
          type="monotone"
          fill="url(#admin-success-area)"
          fillOpacity={1}
          stroke="var(--color-successCount)"
          strokeWidth={2}
          stackId="completed"
          isAnimationActive={false}
        />
        <Area
          dataKey="failureCount"
          type="monotone"
          fill="url(#admin-failure-area)"
          fillOpacity={1}
          stroke="var(--color-failureCount)"
          strokeWidth={2}
          stackId="completed"
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}
