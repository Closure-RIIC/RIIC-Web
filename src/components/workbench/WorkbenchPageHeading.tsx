import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";
import type { AppPage } from "@/workbench-routes";
import { workbenchPageAccent } from "@/workbench-accent";

export function WorkbenchHeadingAccent({ page, color }: { page: AppPage; color?: string }) {
  return <span
    className="h-6 w-1.5 shrink-0"
    style={{ backgroundColor: color ?? workbenchPageAccent(page) }}
    aria-hidden="true"
  />;
}

export function WorkbenchPageHeading({ page, accentColor, className, children, ...props }: ComponentProps<"h1"> & { page: AppPage; accentColor?: string }) {
  return <h1 className={cn("flex min-w-0 items-center gap-2.5 text-lg font-semibold text-foreground", className)} {...props}>
    <WorkbenchHeadingAccent page={page} color={accentColor} />
    <span className="min-w-0 truncate">{children}</span>
  </h1>;
}
