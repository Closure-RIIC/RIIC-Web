"use client";

import { type ComponentPropsWithoutRef, type CSSProperties } from "react";

import { cn } from "@/lib/utils";
export { AnimatedNumber } from "@riic/ui-primitives/animated-number";

interface AnimatedValueProps extends Omit<ComponentPropsWithoutRef<"span">, "children"> {
  value: string | number;
  accessibleText?: string;
  drift?: { x?: number; y?: number };
  trend?: -1 | 0 | 1;
}

function animatedValueText(value: string | number, accessibleText?: string) {
  const text = String(value);
  return { text, spokenText: accessibleText ?? text };
}

export function AnimatedText({
  value,
  accessibleText,
  className,
  drift = { x: 6, y: 0 },
  trend = 0,
  ...props
}: AnimatedValueProps) {
  const { text, spokenText } = animatedValueText(value, accessibleText);
  const direction = trend === 0 ? 1 : trend;
  const style = {
    ...props.style,
    "--animated-field-x": `${(drift.x ?? 0) * direction}px`,
    "--animated-field-y": `${drift.y ?? 0}px`,
  } as CSSProperties;

  return (
    <span
      aria-label={spokenText}
      className={cn("inline-block min-w-0", className)}
      data-animated-value="text"
      {...props}
      style={style}
    >
      <span key={text} aria-hidden="true" className="animated-field-value">{text}</span>
    </span>
  );
}
