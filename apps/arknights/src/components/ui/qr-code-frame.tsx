import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function QrCodeFrame({ className, style, ...props }: ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cn("grid size-52 place-items-center rounded-xl bg-white p-3 text-black ring-1 ring-black/10 dark:bg-white dark:text-black sm:size-56 md:size-52", className)}
      style={{ ...style, colorScheme: "only light", forcedColorAdjust: "none" }}
    />
  );
}
