"use client";

import { Calligraph } from "calligraph";
import { useReducedMotion } from "motion/react";
import { type ComponentPropsWithoutRef, type CSSProperties } from "react";

import { cn } from "@/lib/utils";

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

export function AnimatedNumber({
  value,
  accessibleText,
  className,
  drift = { x: 6, y: 0 },
  trend = 0,
  ...props
}: AnimatedValueProps) {
  const shouldReduceMotion = useReducedMotion();
  const { text, spokenText } = animatedValueText(value, accessibleText);

  return (
    <span
      aria-label={spokenText}
      className={cn("inline-block min-w-0", className)}
      data-animated-value="number"
    >
      {shouldReduceMotion ? (
        <span aria-hidden="true">{text}</span>
      ) : (
        <Calligraph
          {...props}
          aria-hidden="true"
          animation="default"
          autoSize={false}
          data-calligraph
          drift={drift}
          initial={false}
          stagger={0.008}
          trend={trend}
          variant="number"
        >
          {text}
        </Calligraph>
      )}
    </span>
  );
}
