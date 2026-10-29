"use client";

import { useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useLocale, useTranslations } from "use-intl";
import { SetupStepper } from "@/components/setup/SetupStepper";
import { cn } from "@/lib/utils";
import { formatManualShiftDuration, manualShiftTimeRanges, moveManualShiftBoundaryByHour, snapManualShiftDurationsToHours } from "@/manual-schedule";

// A short, damped snap, following interior.dev's slider-detents carriage.
const SNAP = { type: "spring", stiffness: 520, damping: 34, mass: 0.45 } as const;
const COLORS = ["bg-amber-200 dark:bg-amber-800", "bg-stone-300 dark:bg-stone-600", "bg-emerald-200 dark:bg-emerald-800", "bg-orange-200 dark:bg-orange-800", "bg-sky-200 dark:bg-sky-800", "bg-zinc-300 dark:bg-zinc-600"];
const timeAt = (minutes: number) => {
  const minute = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
};

export function ManualShiftStartStepper({ startTime, onStartTimeChange }: {
  startTime: string;
  onStartTimeChange?: (time: string) => void;
}) {
  const t = useTranslations("setup_dialog");
  const startHour = Number(startTime.slice(0, 2));
  return <SetupStepper
    label={t("firstShiftStarts")}
    value={startTime}
    valueLabel={t("shiftStartTime", { value1: 1 })}
    decreaseLabel={t("startOneHourEarlier")}
    increaseLabel={t("startOneHourLater")}
    decreaseDisabled={!onStartTimeChange}
    increaseDisabled={!onStartTimeChange}
    onDecrease={() => onStartTimeChange?.(timeAt((startHour - 1) * 60))}
    onIncrease={() => onStartTimeChange?.(timeAt((startHour + 1) * 60))}
  />;
}

export function ManualShiftTimeline({ durations, startTime, onDurationsChange }: {
  durations: number[];
  startTime: string;
  onDurationsChange?: (durations: number[]) => void;
}) {
  const t = useTranslations("setup_dialog");
  const en = useLocale();
  const reduced = useReducedMotion();
  const transition = reduced ? { duration: 0 } : SNAP;
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [held, setHeld] = useState(false);
  const ranges = manualShiftTimeRanges(startTime, durations);
  const start = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3, 5));
  const boundaries = ranges.reduce<number[]>((all, range) => [...all, all[all.length - 1]! + range.durationMinutes / 60], [0]);
  const snapped = snapManualShiftDurationsToHours(durations);
  const bounds = (index: number) => {
    const before = snapped.slice(0, index).reduce((sum, duration) => sum + duration, 0);
    return { min: before + 1, max: before + snapped[index]! + snapped[index + 1]! - 1 };
  };
  const move = (index: number, hour: number) => onDurationsChange?.(moveManualShiftBoundaryByHour(durations, index, hour));
  const hourAtPointer = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect();
    return (clientX - rect.left) / rect.width * 24;
  };
  const release = () => { dragging.current = null; setHeld(false); };

  return <div className="min-w-0 space-y-4" data-manual-shift-timeline>
    <div className="pt-7 pb-5">
      <div
        ref={track}
        className="relative h-11 touch-none select-none"
        data-shift-timeline-track
        onPointerDown={event => {
          if (!onDurationsChange || ranges.length < 2 || (event.pointerType === "mouse" && event.button !== 0)) return;
          const target = (event.target as HTMLElement).closest<HTMLElement>("[data-shift-boundary]");
          const hour = hourAtPointer(event.clientX);
          const index = target ? Number(target.dataset.shiftBoundary)
            : boundaries.slice(1, -1).reduce((best, value, i, list) => Math.abs(value - hour) < Math.abs(list[best]! - hour) ? i : best, 0);
          dragging.current = index;
          setActive(index);
          setHeld(true);
          event.currentTarget.setPointerCapture(event.pointerId);
          track.current?.querySelector<HTMLElement>(`[data-shift-boundary="${index}"]`)?.focus({ preventScroll: true });
          if (!target) move(index, hour);
        }}
        onPointerMove={event => { if (dragging.current !== null) move(dragging.current, hourAtPointer(event.clientX)); }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
      >
        <div className="pointer-events-none absolute inset-x-0 top-2 h-7 overflow-hidden rounded-[7px] border border-black/10 dark:border-white/10">
          {ranges.map((range, index) => <motion.div key={index} className={cn("absolute inset-y-0", COLORS[index % COLORS.length])}
            initial={false} animate={{ left: `${boundaries[index]! / 24 * 100}%`, width: `${range.durationMinutes / 1440 * 100}%` }} transition={transition} />)}
          <div className="absolute inset-0 grid grid-cols-24" data-shift-hour-cells>
            {Array.from({ length: 24 }, (_, index) => <span key={index} className="border-r border-black/15 last:border-0 dark:border-white/20" />)}
          </div>
        </div>
        {boundaries.slice(1, -1).map((hour, index) => <motion.div
          key={index}
          role="slider"
          tabIndex={onDurationsChange ? 0 : -1}
          aria-label={t("shiftBoundary", { first: index + 1, second: index + 2 })}
          aria-orientation="horizontal"
          aria-valuemin={Math.min(bounds(index).min, hour)}
          aria-valuemax={Math.max(bounds(index).max, hour)}
          aria-valuenow={hour}
          aria-valuetext={t("boundaryValue", { time: timeAt(start + hour * 60), duration: formatManualShiftDuration(ranges[index]!.durationMinutes, en) })}
          aria-disabled={!onDurationsChange || undefined}
          data-shift-boundary={index}
          className="absolute top-0 z-10 flex h-11 w-[min(32px,4.166667%)] -translate-x-1/2 cursor-ew-resize items-center justify-center outline-none"
          initial={false} animate={{ left: `${hour / 24 * 100}%` }} transition={transition}
          onFocus={() => setActive(index)}
          onBlur={() => { if (!held) setActive(null); }}
          onKeyDown={event => {
            if (!onDurationsChange) return;
            const { min, max } = bounds(index);
            const next = event.key === "Home" ? min : event.key === "End" ? max
              : ["ArrowRight", "ArrowUp", "PageUp"].includes(event.key) ? hour + 1
              : ["ArrowLeft", "ArrowDown", "PageDown"].includes(event.key) ? hour - 1 : null;
            if (next === null) return;
            event.preventDefault();
            move(index, next);
          }}
        >
          <motion.span className={cn("flex h-9 w-3 shrink-0 items-center justify-center rounded-[5px] border bg-background shadow-sm", active === index ? "border-foreground ring-2 ring-foreground/15" : "border-stone-400 dark:border-stone-500")}
            animate={{ scaleY: active === index && held && !reduced ? 1.08 : 1 }} transition={transition}>
            <span className="h-3 w-px bg-foreground/45" />
          </motion.span>
          {active === index ? <span className="pointer-events-none absolute bottom-full mb-1 whitespace-nowrap rounded-md bg-foreground px-2 py-1 font-number text-xs text-background tabular-nums">{timeAt(start + hour * 60)}</span> : null}
        </motion.div>)}
        <div className="pointer-events-none absolute inset-x-0 top-full mt-1 flex justify-between font-number text-[10px] text-muted-foreground tabular-nums sm:text-xs" aria-hidden="true">
          {[0, 6, 12, 18, 24].map(hour => <span key={hour}>{timeAt(start + hour * 60)}</span>)}
        </div>
      </div>
    </div>
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3" data-shift-timeline-legend>
      {ranges.map((range, index) => <div key={index} className="flex min-w-0 items-start gap-2 py-1 text-xs">
        <span className={cn("mt-1 size-2 shrink-0 rounded-sm", COLORS[index % COLORS.length])} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"><span className="font-medium">{t("shift", { value1: index + 1 })}</span><span className="text-muted-foreground">{formatManualShiftDuration(range.durationMinutes, en)}</span></div>
          <p className="mt-1 font-number text-muted-foreground tabular-nums">{range.startTime}–{range.endTime}</p>
        </div>
      </div>)}
    </div>
  </div>;
}
