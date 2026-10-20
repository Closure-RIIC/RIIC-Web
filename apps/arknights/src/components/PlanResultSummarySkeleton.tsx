"use client";
import { useTranslations } from "use-intl";

import { Skeleton } from "@/components/ui/skeleton";

export function PlanResultSummarySkeleton() {
  const intl = useTranslations();

  return (
    <section
      className="relative mb-5 overflow-hidden border border-[#313131]/18 bg-[#F3F1EA] text-[#313131] shadow-[0_12px_30px_rgba(35,38,39,0.10)]"
      role="status"
      aria-label={intl("components_PlanResultSummarySkeleton.restoringScheduleResult")}
      data-plan-result-summary-skeleton
    >
      <div className="grid min-h-[84px] grid-cols-[minmax(10rem,1.05fr)_minmax(0,5fr)] items-stretch max-[820px]:grid-cols-1">
        <div className="grid min-h-[84px] content-center gap-2 bg-[#272A2B] px-5 py-3 max-sm:min-h-16">
          <Skeleton className="h-5 w-28 bg-white/15" />
          <Skeleton className="h-2.5 w-36 bg-white/15" />
        </div>
        <div className="grid min-w-0 grid-cols-3 max-sm:grid-cols-2">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="grid min-h-[84px] content-center gap-2 border-r border-[#313131]/10 px-3 py-3 max-sm:min-h-[78px]">
              <Skeleton className="h-2.5 w-12" />
              <Skeleton className="h-5 w-20 max-w-full" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
