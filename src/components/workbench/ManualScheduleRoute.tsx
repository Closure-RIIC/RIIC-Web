"use client";

import { lazy, Suspense } from "react";
import { ClientOnly } from "@tanstack/react-router";

import { Skeleton } from "@/components/ui/skeleton";
import { useWorkbench } from "@/workbench-context";

function ManualScheduleLoading() {
  return (
    <section
      className="grid min-h-[calc(100svh-9rem)] content-start gap-4 py-5"
      aria-hidden="true"
      data-manual-schedule-loading
    >
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-40 w-full" />
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    </section>
  );
}

const ManualSchedulePage = lazy(() => import("@/components/pages/ManualSchedulePage").then((module) => ({ default: module.ManualSchedulePage })));

export function ManualScheduleRoute() {
  const { manual } = useWorkbench();
  return <ClientOnly fallback={<ManualScheduleLoading />}><Suspense fallback={<ManualScheduleLoading />}><ManualSchedulePage {...manual} /></Suspense></ClientOnly>;
}
