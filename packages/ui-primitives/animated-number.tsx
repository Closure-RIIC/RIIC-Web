"use client";

import { Calligraph, type CalligraphProps } from "calligraph";
import { useSyncExternalStore, type ComponentPropsWithoutRef } from "react";
import { cn } from "./utils";

interface AnimatedNumberProps extends Omit<ComponentPropsWithoutRef<"span">, "children"> {
  value: string | number;
  accessibleText?: string;
  drift?: { x?: number; y?: number };
  trend?: -1 | 0 | 1;
  animation?: CalligraphProps["animation"];
  stagger?: number;
}

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
function subscribeToReducedMotion(onChange: () => void) {
  const preference = window.matchMedia(reducedMotionQuery);
  preference.addEventListener("change", onChange);
  return () => preference.removeEventListener("change", onChange);
}
const prefersReducedMotion = () => window.matchMedia(reducedMotionQuery).matches;
const serverReducedMotion = () => false;

/** Shared number transition used by both games, with a reduced-motion fallback. */
export function AnimatedNumber({
  value,
  accessibleText,
  className,
  drift = { x: 6, y: 0 },
  trend = 0,
  animation = "default",
  stagger = 0.008,
  ...props
}: AnimatedNumberProps) {
  const shouldReduceMotion = useSyncExternalStore(subscribeToReducedMotion, prefersReducedMotion, serverReducedMotion);
  const text = String(value);

  return (
    <span aria-label={accessibleText ?? text} className={cn("inline-block min-w-0", className)} data-animated-value="number">
      {shouldReduceMotion ? (
        <span aria-hidden="true">{text}</span>
      ) : (
        <Calligraph {...props} aria-hidden="true" animation={animation} autoSize={false} data-calligraph
          drift={drift} initial={false} stagger={stagger} trend={trend} variant="number">
          {text}
        </Calligraph>
      )}
    </span>
  );
}
