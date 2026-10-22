"use client";
import { useTranslations } from "use-intl";

import { StatusCenterLoading, StatusCenterPage } from "@/components/pages/StatusCenterShell";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkbenchHeadingAccent } from "@/components/workbench/WorkbenchPageHeading";
import type { AppPage } from "@/workbench-routes";

function PageHeadingSkeleton({ width, page }: { width: string; page: AppPage }) {
  return (
    <div className="mb-2 flex h-7 min-w-0 items-center gap-2.5" aria-hidden="true">
      <WorkbenchHeadingAccent page={page} />
      <Skeleton className={`h-[18px] ${width}`} />
      <Skeleton className="h-3 w-12" />
    </div>
  );
}

export function TrainingRouteSkeleton() {
  const intl = useTranslations();

  return (
    <div
      className="flex w-full flex-col gap-5 pt-5"
      role="status"
      aria-label={intl("components_workbench_WorkbenchRouteSkeleton.loadingTrainingAdvice")}
      data-workbench-route-skeleton="training"
    >
      <section className="min-w-0">
        <PageHeadingSkeleton page="training" width="w-24" />
        <div className="min-h-[176px] bg-[#272A2B] p-5 text-white sm:p-6">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(28rem,0.8fr)] lg:items-end">
            <div className="grid gap-4">
              <Skeleton className="h-4 w-28 bg-white/15" />
              <Skeleton className="h-7 w-72 max-w-full bg-white/15" />
            </div>
            <div className="grid grid-cols-2 gap-px bg-white/10 sm:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="grid min-h-[68px] gap-2 bg-black/24 px-3 py-3">
                  <Skeleton className="h-2.5 w-8 bg-white/15" />
                  <Skeleton className="h-6 w-12 bg-white/15" />
                </div>
              ))}
              <div className="col-span-2 flex min-h-9 items-center gap-3 bg-black/24 px-3 py-2 sm:col-span-4">
                <Skeleton className="h-3 w-14 bg-white/15" />
                <Skeleton className="h-3 w-20 bg-white/15" />
                <Skeleton className="h-3 w-20 bg-white/15" />
              </div>
            </div>
          </div>
        </div>
      </section>
      <div className="min-h-20 bg-[#272A2B] p-5">
        <Skeleton className="h-4 w-2/3 max-w-md bg-white/15" />
        <Skeleton className="mt-3 h-3 w-1/2 max-w-sm bg-white/15" />
      </div>
      <section className="min-w-0">
        <PageHeadingSkeleton page="training" width="w-20" />
        <div className="grid gap-3 lg:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-40 rounded-none" />
          ))}
        </div>
      </section>
    </div>
  );
}

export function SkillQueryRouteSkeleton() {
  const intl = useTranslations();

  return (
    <section
      className="min-w-0 pt-5"
      role="status"
      aria-label={intl("components_workbench_WorkbenchRouteSkeleton.loadingSkillReference")}
      data-workbench-route-skeleton="skill-query"
    >
      <PageHeadingSkeleton page="skill-query" width="w-20" />
      <div className="mt-3 flex min-h-11 flex-wrap items-center gap-2">
        {Array.from({ length: 7 }, (_, index) => (
          <Skeleton key={index} className="h-9 w-20" />
        ))}
      </div>
      <Skeleton className="mt-2 h-8 w-28" />
      <Skeleton className="mt-3 h-11 w-full" />
      <div className="mt-4 grid gap-3">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="grid min-h-28 grid-cols-[3.5rem_minmax(0,1fr)] gap-4 border border-border/70 p-4">
            <Skeleton className="size-14 rounded-none" />
            <div className="grid content-center gap-3">
              <Skeleton className="h-5 w-40 max-w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-3/5" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function StatusRouteSkeleton({ label }: { label?: string }) {
  const intl = useTranslations();

  const resolvedLabel = label ?? (intl("components_workbench_WorkbenchRouteSkeleton.loadingStatusCenter"));
  return (
    <StatusCenterPage data-workbench-route-skeleton="status">
      <StatusCenterLoading label={resolvedLabel} />
    </StatusCenterPage>
  );
}
