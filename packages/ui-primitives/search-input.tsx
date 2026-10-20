"use client";

import type { ComponentProps } from "react";
import { Search, X } from "lucide-react";
import { Input } from "./input";
import { cn } from "./utils";

export function SearchInput({ label, className, containerClassName, onClear, clearLabel = "清空搜索", ...props }: Omit<ComponentProps<"input">, "aria-label"> & {
  label: string;
  containerClassName?: string;
  onClear?: () => void;
  clearLabel?: string;
}) {
  return <div className={cn("relative block min-w-0", containerClassName)} data-search-control>
    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    <Input type="text" {...props} aria-label={label} data-search-input className={cn("h-11 pr-10 pl-9 max-sm:pr-12", className)} />
    {onClear && props.value ? <button type="button" disabled={props.disabled}
      onClick={event => { onClear(); event.currentTarget.parentElement?.querySelector("input")?.focus(); }}
      className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring max-sm:size-11"
      aria-label={clearLabel} title={clearLabel}><X className="size-4" aria-hidden="true" /></button> : null}
  </div>;
}
