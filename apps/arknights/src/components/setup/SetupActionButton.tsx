"use client";

import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SetupActionButtonProps = Omit<ComponentProps<typeof Button>, "size">;

const SETUP_ACTION_CLASS = "h-11 min-w-[152px] px-4 text-xs font-semibold max-sm:min-w-[152px] sm:h-9 sm:min-w-[152px] sm:px-4";

/** Compact pill action shared by the schedule setup surfaces. */
export function SetupActionButton({ className, style, ...buttonProps }: SetupActionButtonProps) {
  return (
    <Button
      {...buttonProps}
      size="dialog"
      className={cn(SETUP_ACTION_CLASS, className)}
      style={{ borderRadius: 18, ...style }}
      data-setup-action=""
      data-setup-action-kind="button"
    />
  );
}
