"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SetupStepper({ label, value, valueLabel = label, decreaseLabel, increaseLabel, onDecrease, onIncrease, decreaseDisabled, increaseDisabled, compact = false, hideLabel = false }: {
  label: string;
  value: string | number;
  valueLabel?: string;
  decreaseLabel: string;
  increaseLabel: string;
  onDecrease: () => void;
  onIncrease: () => void;
  decreaseDisabled?: boolean;
  increaseDisabled?: boolean;
  compact?: boolean;
  hideLabel?: boolean;
}) {
  return <div className="flex items-center gap-2" role="group" aria-label={label}>
    {hideLabel ? null : <span className="text-xs text-muted-foreground">{label}</span>}
    <div className="flex items-center rounded-lg border border-border/70 bg-background" data-setup-stepper>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={decreaseLabel} disabled={decreaseDisabled} onClick={onDecrease}><ChevronLeft className="size-4" /></Button>
      <output className={cn("text-center font-number text-sm tabular-nums", compact ? "min-w-6" : "min-w-14")} aria-label={valueLabel}>{value}</output>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={increaseLabel} disabled={increaseDisabled} onClick={onIncrease}><ChevronRight className="size-4" /></Button>
    </div>
  </div>;
}
