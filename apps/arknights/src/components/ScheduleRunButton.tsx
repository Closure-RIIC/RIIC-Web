"use client";

// State crossfade adapted from https://www.interior.dev/docs/loading-button.
/* MIT License — Copyright (c) 2026 ozzy
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { AlertCircle, Check, LoaderCircle, Play } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "use-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Outcome = "idle" | "success" | "error";
type Phase = Outcome | "pending";

export function ScheduleRunButton({ canRun, hasBox, plannerReady, requiresAccount, runCooldownSeconds, loading, outcome = "idle", onRun, onCancel }: {
  canRun: boolean;
  hasBox: boolean;
  plannerReady: boolean;
  requiresAccount: boolean;
  runCooldownSeconds: number;
  loading: boolean;
  outcome?: Outcome;
  onRun: () => void;
  onCancel: () => void;
}) {
  const intl = useTranslations("components_pages_InfraCalculator");
  const reduced = useReducedMotion();
  const source: Phase = loading ? "pending" : outcome;
  // Restoring an existing result should not replay a completion animation.
  const [feedback, setFeedback] = useState<{ source: Phase; phase: Phase }>({ source, phase: loading ? "pending" : "idle" });
  if (feedback.source !== source) setFeedback({ source, phase: source });
  useEffect(() => {
    if (feedback.phase !== "success" && feedback.phase !== "error") return;
    const timer = window.setTimeout(() => setFeedback(current => ({ ...current, phase: "idle" })), 1400);
    return () => window.clearTimeout(timer);
  }, [feedback.phase]);

  const unavailableLabel = runCooldownSeconds > 0 ? intl("retryInSeconds", { runCooldownSeconds })
    : requiresAccount ? intl("signInFirst") : plannerReady ? intl("importOperatorDataFirst") : intl("plannerUnavailable");
  const idleLabel = runCooldownSeconds > 0 ? intl("retryInS", { runCooldownSeconds })
    : requiresAccount && hasBox ? intl("signInToGenerate") : !plannerReady ? intl("plannerUnavailable2") : canRun || loading ? intl("generate") : intl("importToGenerate");
  const phase = !loading && runCooldownSeconds > 0 ? "idle" : feedback.phase;
  const faces = [
    { key: "idle", label: idleLabel, Icon: Play },
    { key: "pending", label: intl("cancelTask"), Icon: LoaderCircle },
    { key: "success", label: intl("scheduleGenerated"), Icon: Check },
    { key: "error", label: intl("retryGeneration"), Icon: AlertCircle },
  ] as const;
  return <>
    <Button
      type="button"
      size="sm"
      className="relative h-9 min-w-0 overflow-hidden max-md:h-auto max-md:min-h-11 max-md:w-full max-md:shrink max-md:px-3 max-md:py-2 max-md:text-xs"
      data-schedule-run-button
      data-run-phase={phase}
      aria-busy={loading || undefined}
      aria-label={loading ? intl("cancelTask") : runCooldownSeconds > 0 ? unavailableLabel : canRun || hasBox ? intl("generateSchedule") : unavailableLabel}
      title={loading ? intl("cancelTask") : runCooldownSeconds > 0 || (!canRun && !(requiresAccount && hasBox && plannerReady)) ? unavailableLabel : undefined}
      onClick={loading ? onCancel : onRun}
      disabled={!loading && (runCooldownSeconds > 0 || (!canRun && !(requiresAccount && hasBox && plannerReady)))}
    >
      <span aria-hidden="true" className="grid min-w-0 place-items-center">
        {faces.map(({ key, label, Icon }) => <motion.span
          key={key}
          data-run-face={key}
          initial={false}
          animate={key === phase ? { opacity: 1, y: 0, filter: "blur(0px)" } : { opacity: 0, y: reduced ? 0 : 3, filter: reduced ? "blur(0px)" : "blur(3px)" }}
          transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 34, mass: 0.8 }}
          className={cn("col-start-1 row-start-1 flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap max-md:whitespace-normal", key === "success" && "text-[var(--schedule-success)]", key === "error" && "text-red-300 dark:text-red-800")}
        >
          <Icon className={cn("size-3.5 motion-reduce:animate-none", key === "pending" && loading && !reduced && "animate-spin")} />
          {label}
        </motion.span>)}
      </span>
    </Button>
    <span role="status" aria-live="polite" className="sr-only">{phase === "success" ? intl("scheduleGenerated") : phase === "error" ? intl("retryGeneration") : ""}</span>
  </>;
}
