"use client";



import type { AppLocale } from "@riic/contracts/locale";
import { localize as localize_components_ui_live_activity } from "../../i18n/helpers/components_ui_live_activity.ts";
import { useTranslations, useLocale } from "use-intl";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAccountActivity } from "@riic/shell/account-activity";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusMark, type StatusMarkStatus } from "@/components/ui/status-mark";
import { cn } from "@/lib/utils";
import { MOTION_EASE_OUT } from "@/motion";
import type { DisplayError, MaaJson } from "@riic/arknights-domain/types";
import { solverDiagnosticFor } from "@/solver-diagnostic";
import type { useSklandTrainingSync } from "@/hooks/use-skland-training-sync";
import { TrainingSyncButton } from "@/components/workbench/TrainingSyncButton";

const SURFACE = { duration: 0.38, ease: MOTION_EASE_OUT } as const;
const FACE = { duration: 0.26, ease: MOTION_EASE_OUT } as const;
const STATUS_MARK_COLORS = "text-amber-600 [--status-mark-done:var(--color-emerald-600)] [--status-mark-failed:var(--destructive)] dark:text-amber-300 dark:[--status-mark-done:var(--color-emerald-400)]";

const MAA_UNCERTAIN_OPERATOR_NAMES = ["红", "红隼"] as const;

function maaUncertainOperators(maa: MaaJson): string[] {
  const scheduledNames = maa.plans.flatMap((plan) => [
    ...Object.values(plan.rooms).flatMap((rooms) => (rooms ?? []).flatMap((room: NonNullable<MaaJson["plans"][number]["rooms"]["trading"]>[number]) => room.operators ?? [])),
    ...(plan.groups ?? []).flatMap((group) => group.operators),
  ]).flatMap((operator) => {
    if (typeof operator === "string") return [operator];
    return operator?.name ? [operator.name] : [];
  });
  return MAA_UNCERTAIN_OPERATOR_NAMES.filter((name) => scheduledNames.includes(name));
}

export type ActivityPhase = "running" | "queued" | "success" | "error" | "notice";
export type ActivityKind = "schedule" | "progression-adjustment" | "account" | "training-sync" | "skland-renewal";

export interface Activity {
  id: number | string;
  kind: ActivityKind;
  phase: ActivityPhase;
  error: DisplayError | null;
  queuePosition?: number | null;
  etaSeconds?: number | null;
  buffered?: boolean;
  uncertainMaaOperators?: string[];
  title?: string;
  description?: string;
}

export interface LiveActivityProps {
  activity: Activity | null;
  notice?: Activity | null;
  trainingSync?: ReturnType<typeof useSklandTrainingSync> | null;
  onRetry: () => void;
  onCopyDiagnostic: () => void;
  retryCountdownSeconds?: number;
}

export function usePlanActivity({
  loading,
  error,
  completed = false,
  completedMaa = null,
  queued = false,
  queuePosition = null,
  etaSeconds = null,
  buffered = false,
  kind = "schedule",
}: {
  loading: boolean;
  error: DisplayError | null;
  /** 当前任务是否真正完成（由任务状态驱动，避免取消/旧结果误判成功）。 */
  completed?: boolean;
  /** Snapshot the completed task's warning, independent of later result edits or variant switches. */
  completedMaa?: MaaJson | null;
  queued?: boolean;
  queuePosition?: number | null;
  etaSeconds?: number | null;
  buffered?: boolean;
  kind?: "schedule" | "progression-adjustment";
}) {
  const [activity, setActivity] = useState<Activity | null>(null);
  const wasLoading = useRef(false);
  const sequence = useRef(0);

  useEffect(() => {
    if (loading && !wasLoading.current) {
      sequence.current += 1;
      setActivity({
        id: sequence.current,
        kind,
        phase: queued ? "queued" : "running",
        error: null,
        queuePosition,
        etaSeconds,
        buffered,
      });
    } else if (loading && wasLoading.current) {
      // loading 期间 running ↔ queued 互相切换（轮询停止/恢复）。
      setActivity((current) =>
        current && current.id === sequence.current && (current.phase === "running" || current.phase === "queued")
          ? { ...current, phase: queued ? "queued" : "running", queuePosition, etaSeconds, buffered }
          : current,
      );
    } else if (!loading && wasLoading.current) {
      const id = sequence.current;
      setActivity(error
        ? { id, kind, phase: "error", error }
        : completed
          ? { id, kind, phase: "success", error: null, queuePosition: null, etaSeconds: null, uncertainMaaOperators: completedMaa ? maaUncertainOperators(completedMaa) : [] }
          : null);
    }
    wasLoading.current = loading;
  }, [buffered, completed, completedMaa, error, etaSeconds, kind, loading, queued, queuePosition]);

  return activity;
}

export function LiveActivity({ activity: planActivity, notice, trainingSync, onRetry, onCopyDiagnostic, retryCountdownSeconds = 0 }: LiveActivityProps) {
  const intl = useTranslations();
  const reduceMotion = useReducedMotion();
  const locale = useLocale();
  const en = locale;
  const [copied, setCopied] = useState(false);
  const accountActivity = useAccountActivity();
  const [dismissed, setDismissed] = useState<Partial<Record<ActivityKind, string>>>({});
  const dismiss = useCallback((item: Activity) => setDismissed(current => ({ ...current, [item.kind]: `${item.id}:${item.phase}` })), []);
  const candidates: (Activity | null)[] = [planActivity, accountActivity, notice ?? null];
  const available = candidates
    .filter((item): item is Activity => !!item && dismissed[item.kind] !== `${item.id}:${item.phase}`);
  const trainingSyncedAt = trainingSync?.syncedAt ?? 0;
  const trainingPhase: ActivityPhase | null = !trainingSync ? null
    : trainingSync.resume ? "error" : trainingSync.busy ? "running"
      : trainingSync.error || trainingSync.stale ? "error" : trainingSync.syncedAt ? "success" : "queued";
  const trainingCandidate = useMemo<Activity | null>(() => trainingPhase ? {
    id: trainingSyncedAt,
    kind: "training-sync",
    phase: trainingPhase,
    error: null,
  } : null, [trainingPhase, trainingSyncedAt]);
  const trainingActivity = trainingCandidate && dismissed["training-sync"] !== `${trainingCandidate.id}:${trainingCandidate.phase}`
    ? trainingCandidate : null;
  // Keep one surface: active work takes priority, then account and result feedback.
  const activity = available.find(item => item.phase === "running" || item.phase === "queued")
    ?? (trainingActivity?.phase === "running" ? trainingActivity : null)
    ?? available.find(item => item.kind === "account") ?? available[0] ?? trainingActivity;
  const [solverWarningOpen, setSolverWarningOpen] = useState(false);
  const [acknowledgedSchedule, setAcknowledgedSchedule] = useState<Activity["id"]>();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [peek, setPeek] = useState(false);
  const compactRef = useRef<HTMLDivElement>(null);
  const expandedRef = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousActivityId = useRef<string | undefined>(undefined);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const activityId = activity ? `${activity.kind}:${activity.id}` : undefined;
  const phase = activity?.phase;
  const training = activity?.kind === "training-sync" ? trainingSync : null;
  const expanded = peek || hovered || focused || phase === "error" || phase === "success" || phase === "notice";
  const markStatus: StatusMarkStatus = phase === "queued" || phase === "notice" ? "pending" : phase === "running" ? "running" : phase === "success" ? "done" : "failed";

  // Keep the initial preview readable without resetting pointer or keyboard interaction on every phase update.
  useEffect(() => {
    const isNewActivity = activityId !== undefined && activityId !== previousActivityId.current;
    previousActivityId.current = activityId;

    if (isNewActivity) {
      setHovered(false);
      setFocused(false);
    }

    if (activityId === undefined || phase === "success" || phase === "error" || phase === "notice") {
      setPeek(false);
      return;
    }

    setPeek(true);
    const timer = window.setTimeout(() => setPeek(false), isNewActivity ? 3_200 : 2_000);
    return () => window.clearTimeout(timer);
  }, [activityId, phase]);

  useEffect(() => () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
  }, []);

  // 普通成功提示自动消失；包含 MAA 识别提醒时保留到用户手动关闭。
  useEffect(() => {
    if (!activity || activity.phase !== "success" || activity.uncertainMaaOperators?.length || hovered || focused) return;
    const timer = window.setTimeout(() => dismiss(activity), 4_000);
    return () => window.clearTimeout(timer);
  }, [activity, dismiss, hovered, focused]);

  // Informational notices have a fixed reading window, including while hovered or focused.
  useEffect(() => {
    if (!activity || activity.phase !== "notice") return;
    const timer = window.setTimeout(() => dismiss(activity), 6_000);
    return () => window.clearTimeout(timer);
  }, [activity, dismiss]);

  useEffect(() => {
    if (!activity) return;
    setCopied(false);
  }, [activity]);

  useEffect(() => {
    if (planActivity?.phase !== "success" || planActivity.kind !== "schedule") return;
    const timer = window.setTimeout(() => setSolverWarningOpen(true), reduceMotion ? 0 : 650);
    return () => window.clearTimeout(timer);
  }, [planActivity?.id, planActivity?.kind, planActivity?.phase, reduceMotion]);

  const diagnostic = activity?.error ? solverDiagnosticFor(activity.error, en) : null;
  const progressionAdjustment = activity?.kind === "progression-adjustment";
  const label = training
    ? phase === "error" ? intl("components_pages_TrainingAdvice.syncIssue")
      : phase === "success" ? intl("components_pages_TrainingAdvice.syncComplete") : intl("components_pages_TrainingAdvice.syncTitle")
    : activity?.title ? activity.title : activity?.phase === "running"
    ? progressionAdjustment
      ? (intl("components_ui_live_activity.adjustingProgression"))
      : (intl("components_ui_live_activity.generatingSchedule"))
    : activity?.phase === "queued"
      ? (intl("components_ui_live_activity.queued"))
    : activity?.phase === "success"
      ? progressionAdjustment
        ? (intl("components_ui_live_activity.progressionAdjustmentComplete"))
        : (intl("components_ui_live_activity.scheduleGenerated"))
      : diagnostic?.title ?? activity?.error?.message ?? (intl("components_ui_live_activity.scheduleGenerationFailed"));
  useLayoutEffect(() => {
    if (!activity) return;
    const measure = () => {
      const face = expanded ? expandedRef.current : compactRef.current;
      if (!face) return;
      const width = face.offsetWidth + 2;
      const height = face.offsetHeight + 2;
      setSize(current => current?.width === width && current?.height === height ? current : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    const face = expanded ? expandedRef.current : compactRef.current;
    if (face) observer.observe(face);
    return () => observer.disconnect();
  }, [activity, expanded]);

  return (
    <>
      <AnimatePresence initial={false}>
      {activity ? (
        <motion.aside
          key={training ? "training-sync" : `${activity.kind}:${activity.id}`}
          data-slot="live-activity"
          data-activity-kind={activity.kind}
          data-activity-phase={activity.phase}
          data-activity-view={expanded ? "expanded" : "compact"}
          data-training-sync={training ? "" : undefined}
          className={cn(
            "fixed top-[max(0.75rem,env(safe-area-inset-top))] max-md:top-[calc(3.75rem+env(safe-area-inset-top))] left-1/2 z-[80] max-md:z-40 -translate-x-1/2 overflow-hidden rounded-[11px] border text-sm outline-none",
            "bg-card text-card-foreground shadow-[var(--shadow-border)] focus-visible:ring-2 focus-visible:ring-ring",
            activity.phase === "error" ? "border-destructive/40" : "border-border",
          )}
          role={activity.phase === "error" ? "alert" : "status"}
          aria-live={activity.phase === "error" ? "assertive" : "polite"}
          aria-label={label}
          tabIndex={0}
          onPointerEnter={(event) => {
            if (event.pointerType === "touch") return;
            if (leaveTimer.current) clearTimeout(leaveTimer.current);
            setHovered(true);
          }}
          onPointerLeave={() => {
            if (leaveTimer.current) clearTimeout(leaveTimer.current);
            leaveTimer.current = setTimeout(() => setHovered(false), 240);
          }}
          onFocusCapture={() => setFocused(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
          }}
          onClick={() => { if (!expanded) setFocused(true); }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            if (activity.phase === "success" || activity.phase === "error" || activity.phase === "notice") {
              dismiss(activity);
            } else {
              setPeek(false);
              setHovered(false);
              setFocused(false);
              (document.activeElement as HTMLElement | null)?.blur();
            }
          }}
          style={{ width: "min(400px, calc(100vw - 24px))", height: 88, transformOrigin: "50% 0%", contain: "layout paint" }}
          initial={reduceMotion ? false : { opacity: 0, y: -8, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1, width: size?.width, height: size?.height }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.99 }}
          transition={reduceMotion ? { duration: 0 } : { ...SURFACE, opacity: { duration: 0.24 } }}
        >
          <motion.div
            ref={compactRef}
            className="absolute top-0 left-0 flex h-9 w-max max-w-[calc(100vw-26px)] items-center gap-2.5 px-3.5"
            aria-hidden="true"
            inert={expanded}
            initial={false}
            animate={{ opacity: expanded ? 0 : 1, y: expanded ? -2 : 0, scale: expanded ? 0.985 : 1 }}
            transition={reduceMotion ? { duration: 0 } : FACE}
          >
            <span className={cn("shrink-0", STATUS_MARK_COLORS)} data-slot="status-mark-compact">
              <StatusMark status={markStatus} size={16} active={!expanded} />
            </span>
            <span className="truncate text-xs font-medium">{label}</span>
          </motion.div>
          <motion.div
            ref={expandedRef}
            className="absolute top-0 left-0 w-[min(398px,calc(100vw-26px))] pb-3"
            inert={!expanded}
            aria-hidden={!expanded || undefined}
            initial={false}
            animate={{ opacity: expanded ? 1 : 0, y: expanded ? 0 : 3, scale: expanded ? 1 : 0.99 }}
            transition={reduceMotion ? { duration: 0 } : FACE}
            style={{ pointerEvents: expanded ? undefined : "none" }}
          >
          <div className="relative flex min-h-[4.5rem] items-stretch overflow-hidden" data-slot="live-activity-body">
            <span
              className={cn("relative z-10 grid w-12 shrink-0 self-stretch place-items-center", (training || phase === "notice") && "self-start pt-3", STATUS_MARK_COLORS)}
              aria-hidden="true"
              data-slot="status-mark-rail"
            >
              <StatusMark status={markStatus} size={28} active={expanded} />
            </span>
            <div className={cn(
              "relative z-10 flex min-w-0 flex-1 flex-wrap items-center gap-3 py-3 pr-3 pl-1 max-sm:gap-y-1.5",
            )}>
              <div className="min-w-0 flex-1 max-sm:basis-full">
              <strong className="block truncate font-medium">{label}</strong>
              <span className="mt-0.5 block">
                {training ? (
                  <span className="text-sm text-muted-foreground">
                    {training.busy ? intl("components_pages_TrainingAdvice.syncing")
                      : training.syncedAt ? intl("components_pages_TrainingAdvice.lastSynced", { time: new Date(training.syncedAt).toLocaleString(locale) })
                        : intl("components_pages_TrainingAdvice.autoSync")}
                  </span>
                ) : activity.description ? (
                  <span className="text-sm text-muted-foreground">{activity.description}</span>
                ) : activity.phase === "queued" ? (
                  <span className="text-sm text-muted-foreground">
                    {activity.buffered ? (
                      <>{intl("components_ui_live_activity.youAreInTheCandidateRingACandidateWill")}</>
                    ) : (
                      <>{intl("components_ui_live_activity.ahead")}<strong className="font-semibold">{activity.queuePosition ?? "—"}</strong>{intl("components_ui_live_activity.estimatedWait")}<strong className="font-semibold">{formatDuration(activity.etaSeconds, en)}</strong></>
                    )}
                  </span>
                ) : activity.phase === "running" ? (
                  <span className="text-sm text-muted-foreground">
                    {progressionAdjustment
                      ? (intl("components_ui_live_activity.reSolvingWithTheAdjustedOperatorRosterPleaseWait"))
                      : (intl("components_ui_live_activity.callingTheSchedulingServicePleaseWait"))}
                    {activity.queuePosition != null ? (
                      <>
                        {intl("components_ui_live_activity.queuePosition")}<strong className="font-semibold">{activity.queuePosition}</strong>{intl("components_ui_live_activity.estimatedWait2")}<strong className="font-semibold">{formatDuration(activity.etaSeconds, en)}</strong>
                      </>
                    ) : null}
                  </span>
                ) : (
                  <span className={cn("text-xs", activity.phase === "error" ? "text-destructive/80" : "text-muted-foreground")}>
                    {activity.phase === "success"
                      ? progressionAdjustment
                        ? (intl("components_ui_live_activity.theAdjustedScheduleIsReadyForComparison"))
                        : (intl("components_ui_live_activity.theThreeShiftResultIsReadyToViewOr"))
                      : `${activity.error?.code ?? "AIC-PLAN"}${activity.error?.requestId ? ` · ${activity.error.requestId}` : ""}`}
                  </span>
                )}
              </span>
              {activity.phase === "success" && activity.uncertainMaaOperators?.length ? (
                <p className="mt-1 text-sm leading-relaxed text-amber-700 dark:text-amber-300" data-maa-recognition-warning>
                  {intl("components_ui_live_activity.maaRecognitionWarning", {
                    operators: activity.uncertainMaaOperators.join(en === "en" ? ", " : "」「"),
                  })}
                </p>
              ) : null}
              {training && (training.error || training.stale) ? (
                <p className="mt-1 text-sm leading-relaxed text-amber-700 dark:text-amber-300">
                  {training.error ?? intl("components_pages_TrainingAdvice.syncStale")}
                </p>
              ) : null}
              {!training && activity.phase === "queued" ? (
                <span className="mt-1 block text-sm text-muted-foreground">
                  {intl("components_ui_live_activity.thisPageUpdatesAutomaticallyDoNotSubmitAgain")}
                </span>
              ) : null}
              {diagnostic ? <span className="mt-1 block text-xs text-destructive">{diagnostic.suggestion}</span> : null}
              </div>
              {training ? (
                <TrainingSyncButton sync={training} className="max-sm:ml-auto" />
              ) : activity.phase === "error" ? (
                <span className="flex shrink-0 items-center gap-1 max-sm:basis-full max-sm:justify-end">
                {activity.error?.retryable ? (
                  <Button type="button" size="sm" variant="ghost" className="h-9 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onRetry} disabled={retryCountdownSeconds > 0}>
                    {retryCountdownSeconds > 0 ? intl("components_ui_live_activity.retryCountdown", { seconds: retryCountdownSeconds }) : intl("components_ui_live_activity.retry")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-9 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => {
                    onCopyDiagnostic();
                    setCopied(true);
                  }}
                >
                  {copied ? (intl("components_ui_live_activity.copied")) : (intl("components_ui_live_activity.copyDiagnostics"))}
                </Button>
                </span>
              ) : null}
              {!training ? <button
                type="button"
                onClick={() => dismiss(activity)}
                aria-label={intl("components_ui_live_activity.dismissNotification")}
                className="h-8 shrink-0 rounded-md px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring max-sm:ml-auto"
              >
                {intl("components_ui_live_activity.dismiss")}
              </button> : null}
            </div>
          </div>
          {activity.phase !== "success" && activity.phase !== "notice" && !(training && activity.phase === "queued") ? <div className="mx-3 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true" data-slot="activity-progress-track">
            {activity.phase === "running" ? (
              <motion.span
                className="block h-full w-[38%] bg-amber-500 dark:bg-amber-300"
                animate={reduceMotion ? { x: "82%" } : { x: ["-110%", "285%"] }}
                transition={reduceMotion ? { duration: 0 } : { duration: 1.6, ease: "linear", repeat: Number.POSITIVE_INFINITY }}
                data-slot="activity-progress-indicator"
              />
            ) : activity.phase === "queued" ? (
              <span className="block h-full w-full bg-amber-500/55 dark:bg-amber-300/55" aria-hidden="true" />
            ) : (
              <motion.span
                className="block h-full w-full bg-destructive"
                initial={reduceMotion ? false : { scaleX: 0.72 }}
                animate={{ scaleX: 1 }}
                transition={reduceMotion ? { duration: 0 } : FACE}
                style={{ transformOrigin: "left center" }}
                data-slot="activity-progress-indicator"
              />
            )}
          </div> : null}
          </motion.div>
        </motion.aside>
      ) : null}
      </AnimatePresence>

      {planActivity?.phase === "success" && planActivity.kind === "schedule" && acknowledgedSchedule !== planActivity.id
        ? <span hidden data-schedule-notice-pending /> : null}
      <Dialog open={solverWarningOpen} onOpenChange={(open) => {
        setSolverWarningOpen(open);
        if (!open) setAcknowledgedSchedule(planActivity?.id);
      }}>
        <DialogContent className="grid max-h-[min(680px,calc(100dvh-2rem))] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 sm:max-w-[min(540px,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle className="text-xl">{intl("components_ui_live_activity.scheduleGenerated")}</DialogTitle>
            <DialogDescription className="text-base leading-7">{intl("components_ui_live_activity.theThreeShiftResultIsReadyToViewOr")}</DialogDescription>
          </DialogHeader>
          <div className="px-5 pb-2 text-lg font-medium leading-8 text-amber-700 sm:px-7 dark:text-amber-300">
            {intl("components_ui_live_activity.solverIterationWarning")}
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" />}>{intl("components_ui_live_activity.dismiss")}</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function formatDuration(seconds: number | null | undefined, en: AppLocale = "zh-CN"): string {
  const total = Math.max(0, Math.round(seconds ?? 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes <= 0) return `${rest} ${localize_components_ui_live_activity.text(en, "s2")}`;
  return `${minutes} ${localize_components_ui_live_activity.text(en, "min")} ${rest} ${localize_components_ui_live_activity.text(en, "s2")}`;
}
