"use client";
import { useTranslations } from "use-intl";

/*
 * Interaction adapted from interior.dev by Dominic Doemann.
 * Source: https://github.com/ddoemonn/interior/blob/main/components/interior/hold-to-confirm.tsx
 * Licensed under the MIT License: https://github.com/ddoemonn/interior/blob/main/LICENSE
 */

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type HoldPhase = "idle" | "holding" | "releasing" | "committed";

export function HoldToConfirm({
  children,
  onConfirm,
  confirmLabel,
  duration = 1800,
  disabled = false,
  className,
}: {
  children: ReactNode;
  onConfirm: () => void;
  confirmLabel?: string;
  duration?: number;
  disabled?: boolean;
  className?: string;
}) {
  const intl = useTranslations();

  const effectiveConfirmLabel = confirmLabel ?? (intl("components_ui_hold_to_confirm.confirmed"));
  const [phase, setPhase] = useState<HoldPhase>("idle");
  const phaseRef = useRef<HoldPhase>("idle");
  const startedAtRef = useRef(0);
  const frameRef = useRef(0);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const confirmRef = useRef(onConfirm);
  const hintId = useId();
  const reducedMotion = useReducedMotion();
  const swept = useMotionValue(0);
  const clipPath = useTransform(swept, (value) => `inset(0 ${(1 - value) * 100}% 0 0)`);

  useEffect(() => {
    confirmRef.current = onConfirm;
  }, [onConfirm]);

  const move = useCallback((next: HoldPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const reset = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    originRef.current = null;
    move("idle");
  }, [move]);

  const release = useCallback(() => {
    if (phaseRef.current !== "holding") return;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    originRef.current = null;
    move("releasing");
  }, [move]);

  const begin = useCallback((point?: { x: number; y: number }) => {
    if (disabled || phaseRef.current === "holding" || phaseRef.current === "committed") return;
    originRef.current = point ?? null;
    startedAtRef.current = performance.now();
    move("holding");

    const loop = (now: number) => {
      if (phaseRef.current !== "holding") return;
      if (now - startedAtRef.current >= duration) {
        frameRef.current = 0;
        originRef.current = null;
        move("committed");
        navigator.vibrate?.(14);
        confirmRef.current();
        return;
      }
      frameRef.current = requestAnimationFrame(loop);
    };
    frameRef.current = requestAnimationFrame(loop);
  }, [disabled, duration, move]);

  useEffect(() => {
    const target = phase === "holding" || phase === "committed" ? 1 : 0;
    if (reducedMotion) {
      swept.set(phase === "committed" ? 1 : 0);
      return;
    }
    const from = swept.get();
    const controls = animate(swept, target, {
      duration: phase === "holding" ? (duration * (1 - from)) / 1000 : Math.max(0.12, from * 0.42),
      ease: phase === "holding" ? "linear" : [0.23, 1, 0.32, 1],
    });
    return () => controls.stop();
  }, [duration, phase, reducedMotion, swept]);

  useEffect(() => {
    if (phase !== "committed") return;
    const timeout = window.setTimeout(reset, 1600);
    return () => window.clearTimeout(timeout);
  }, [phase, reset]);

  useEffect(() => {
    if (disabled) reset();
  }, [disabled, reset]);

  useEffect(() => {
    const handleVisibility = () => { if (document.hidden) release(); };
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", handleVisibility);
      cancelAnimationFrame(frameRef.current);
    };
  }, [release]);

  const committed = phase === "committed";
  return (
    <button
      type="button"
      aria-disabled={disabled || committed}
      aria-describedby={hintId}
      data-hold-to-confirm
      data-hold-phase={phase}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        begin({ x: event.clientX, y: event.clientY });
      }}
      onPointerMove={(event) => {
        const origin = originRef.current;
        if (phaseRef.current === "holding" && origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) release();
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); reset(); return; }
        if (!event.repeat && (event.key === " " || event.key === "Enter")) { event.preventDefault(); begin(); }
      }}
      onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") release(); }}
      onBlur={release}
      onClick={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
      style={{ touchAction: "manipulation", WebkitTouchCallout: "none" }}
      className={cn(
        "relative isolate inline-grid min-h-11 select-none place-items-center overflow-hidden border border-input bg-background px-4 text-sm font-medium text-foreground shadow-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className,
      )}
    >
      <span className="col-start-1 row-start-1 flex items-center justify-center gap-2 whitespace-nowrap">{committed ? effectiveConfirmLabel : children}</span>
      <motion.span aria-hidden style={{ clipPath }} className="absolute inset-0 grid place-items-center bg-[#E23B32] px-4 text-white">
        <span className="flex items-center justify-center gap-2 whitespace-nowrap">{committed ? effectiveConfirmLabel : children}</span>
      </motion.span>
      <span id={hintId} className="font-number sr-only">{intl("components_ui_hold_to_confirm.holdForSecondsToConfirmReleasingEarlyCancelsWithout", { value1: duration / 1000 })}</span>
      <span role="status" aria-live="polite" className="sr-only">{committed ? effectiveConfirmLabel : ""}</span>
    </button>
  );
}
