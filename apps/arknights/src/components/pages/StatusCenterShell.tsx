import type { ComponentProps, ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function StatusCenterPage({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("grid gap-6 pb-2 pt-5 sm:pb-5", className)}
      {...props}
    />
  );
}

export function StatusCenterHeader({
  identity,
  actions,
  className,
  ...props
}: Omit<ComponentProps<"header">, "children"> & {
  identity: ReactNode;
  actions: ReactNode;
}) {
  return (
    <header
      className={cn(
        "grid gap-5 border-b border-border/70 pb-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end",
        className
      )}
      {...props}
    >
      <div className="flex min-h-18 min-w-0 items-center" data-status-center-identity>
        {identity}
      </div>
      <div
        className="grid min-h-24 content-end sm:min-h-0 lg:justify-self-end"
        data-status-center-actions
      >
        {actions}
      </div>
    </header>
  );
}

export function StatusCenterLoading({ label }: { label: string }) {
  return (
    <div className="grid gap-6" role="status" aria-label={label}>
      <div className="grid gap-5 border-b border-border/70 pb-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="flex min-h-18 min-w-0 items-center">
          <div className="flex min-w-0 items-center gap-4">
            <Skeleton className="size-14 shrink-0 rounded-xl" />
            <div className="grid min-w-0 flex-1 gap-2">
              <Skeleton className="h-7 w-48 max-w-full" />
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
          </div>
        </div>
        <div className="grid min-h-24 content-end sm:min-h-0 lg:justify-self-end">
          <Skeleton className="h-11 w-full sm:w-44" />
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
        <Skeleton className="h-64 rounded-none" />
        <Skeleton className="h-64 rounded-none" />
      </div>
    </div>
  );
}
