"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import type { ScrollDirection } from "./overlay-scrollbars"

function ScrollArea({
  className,
  viewportClassName,
  viewportProps,
  scrollbarSlotId,
  direction = "y",
  children,
  ...props
}: React.ComponentProps<"div"> & {
  viewportClassName?: string
  viewportProps?: React.ComponentProps<"div">
  scrollbarSlotId?: string
  direction?: ScrollDirection
}) {
  return (
    <div data-slot="scroll-area" className={cn("relative min-h-0 min-w-0", className)} {...props}>
      <div
        {...viewportProps}
        data-slot="scroll-area-viewport"
        data-yeye-scroll={direction}
        data-yeye-scroll-slot={scrollbarSlotId}
        tabIndex={viewportProps?.tabIndex ?? 0}
        className={cn(
          "size-full max-h-[inherit] rounded-[inherit] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1",
          direction === "y" ? "overflow-x-hidden overflow-y-auto" : direction === "x" ? "overflow-x-auto overflow-y-hidden" : "overflow-auto",
          viewportProps?.className,
          viewportClassName,
        )}
      >
        {children}
      </div>
    </div>
  )
}

export { ScrollArea }
