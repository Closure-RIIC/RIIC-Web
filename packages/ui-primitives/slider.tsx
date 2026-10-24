"use client"

import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "./utils"

export function Slider({ className, label, valueText, ...props }: Omit<SliderPrimitive.Root.Props<number>, "className"> & {
  className?: string; label: string; valueText?: string;
}) {
  return <SliderPrimitive.Root data-slot="slider" className={cn("w-full data-disabled:opacity-50", className)} {...props}>
    <SliderPrimitive.Control className="relative flex h-6 w-full touch-none items-center select-none data-disabled:pointer-events-none">
      <SliderPrimitive.Track className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <SliderPrimitive.Indicator className="h-full rounded-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb aria-label={label} aria-valuetext={valueText}
        className="size-4 rounded-full border border-primary bg-background shadow-sm outline-none focus-within:ring-3 focus-within:ring-ring/50" />
    </SliderPrimitive.Control>
  </SliderPrimitive.Root>
}
