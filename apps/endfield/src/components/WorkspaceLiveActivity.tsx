import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { useRouterState } from "@tanstack/react-router";
import { StatusMark } from "@riic/ui-primitives/status-mark";
import { MOTION_EASE_OUT } from "@riic/ui-primitives/motion";
import { useAccountActivity, type AccountActivity } from "@riic/shell/account-activity";
import type { ManualEvaluationActivity, SolverActivity } from "../solver-activity";
import type { SklandSyncActivity, SklandSyncStatus } from "../skland-workspace";
import { useWorkspace } from "../state";
import { useRosterDialog } from "./RosterDialog";

type RosterActivity = { kind: "roster"; id: number; phase: "warning" };
type WorkspaceActivity = SolverActivity | ManualEvaluationActivity | SklandSyncActivity | AccountActivity | RosterActivity;

export function WorkspaceLiveActivity() {
  const { activity, manualEvaluationActivity, sklandSyncActivity, sklandSyncDetailsOpen, sklandSyncReport, workspace, ready } = useWorkspace();
  const path = useRouterState({ select: state => state.location.pathname });
  const needsRoster = ready && path === "/manual" && workspace.operators.length === 0;
  const rosterSequence = useRef(0);
  const [rosterActivity, setRosterActivity] = useState<RosterActivity | null>(null);
  useEffect(() => {
    setRosterActivity(needsRoster ? { kind: "roster", id: ++rosterSequence.current, phase: "warning" } : null);
  }, [needsRoster]);
  const accountActivity = useAccountActivity();
  const [dismissed, setDismissed] = useState<Partial<Record<WorkspaceActivity["kind"], string>>>({});
  const dismiss = useCallback((item: WorkspaceActivity) => setDismissed(current => ({ ...current, [item.kind]: `${item.id}:${item.phase}` })), []);
  const available = [activity, manualEvaluationActivity, sklandSyncActivity, accountActivity, rosterActivity].filter((item): item is WorkspaceActivity => !!item && !(item.kind === "skland" && (sklandSyncDetailsOpen || path === "/skland" && !!sklandSyncReport)) && dismissed[item.kind] !== `${item.id}:${item.phase}`);
  const current = available.find(item => item.phase === "running") ?? available.find(item => item.kind === "account")
    ?? available.filter(item => item.kind !== "roster").sort((a, b) => b.id - a.id)[0] ?? available.find(item => item.kind === "roster");
  return <AnimatePresence initial={false} mode="wait">
    {current
      ? <ActivitySurface key={`${current.kind}:${current.id}`} activity={current} onDismiss={dismiss} />
      : null}
  </AnimatePresence>;
}

function ActivitySurface({ activity, onDismiss }: {
  activity: WorkspaceActivity;
  onDismiss: (activity: WorkspaceActivity) => void;
}) {
  const { t, retrySolve, sklandSyncReport, setSklandSyncDetailsOpen } = useWorkspace();
  const { openRoster } = useRosterDialog();
  const reduceMotion = useReducedMotion();
  const present = useIsPresent();
  const [peek, setPeek] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [pageVisible, setPageVisible] = useState(true);
  const compactRef = useRef<HTMLDivElement>(null);
  const expandedRef = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>();
  useEffect(() => {
    if (activity.kind !== "skland" || activity.status.blocked) return;
    const timer = setTimeout(() => onDismiss(activity), 3000);
    return () => clearTimeout(timer);
  }, [activity, onDismiss]);
  const running = activity.phase === "running";
  const expanded = peek || hovered || focused || !running;
  const status = running ? "running" : activity.phase === "success" ? "done" : activity.phase === "warning" ? "pending" : "failed";
  const manual = activity.kind === "manual" || activity.kind === "evaluation";
  const title = activity.kind === "roster" ? t("WorkspaceLiveActivity.setUpYourOperators") : activity.kind === "account" ? activity.title : activity.kind === "skland"
    ? activity.status.blocked ? t("WorkspaceLiveActivity.sklandSyncNeedsAttention") : t("WorkspaceLiveActivity.sklandSyncComplete")
    : running
    ? manual ? t("WorkspaceLiveActivity.evaluatingSchedule") : t("WorkspaceLiveActivity.generatingSchedule")
    : activity.phase === "success"
      ? manual ? t("WorkspaceLiveActivity.evaluationComplete") : t("WorkspaceLiveActivity.scheduleGenerated")
      : activity.problem === "empty" ? t("WorkspaceLiveActivity.noScheduleFound")
        : activity.problem === "verification" ? t("WorkspaceLiveActivity.scheduleValidationFailed")
          : manual ? t("WorkspaceLiveActivity.evaluationFailed") : t("WorkspaceLiveActivity.schedulingFailed");
  const stage = activity.kind === "skland" || activity.kind === "account" || activity.kind === "roster" ? "" : activity.stage === "preparing" ? t("WorkspaceLiveActivity.preparingOperatorsAndFacilities")
    : activity.stage === "searching"
      ? manual ? t("WorkspaceLiveActivity.simulatingProductionAndMorale") : t("WorkspaceLiveActivity.searchingCrewsAndShiftTimes")
      : t("WorkspaceLiveActivity.checkingCrewCapacityAndOutput");
  const description = activity.kind === "roster" ? t("WorkspaceLiveActivity.selectYourOperatorsToStartAssigningShifts") : activity.kind === "account" ? activity.description : activity.kind === "skland" ? <SklandSyncSummary status={activity.status} /> : running ? stage
    : activity.phase === "success"
      ? activity.limited ? t("WorkspaceLiveActivity.aCandidateIsReadyWithinTheSearchBudgetSee")
        : t("WorkspaceLiveActivity.crewCapacityAndOutputCheckedYourResultIsReady")
      : activity.problem === "empty" ? t("WorkspaceLiveActivity.checkYourRosterAndFacilitiesOrAdjustTheSearch")
        : activity.kind === "evaluation" && activity.error ? <div>{activity.error.split("；").map((message, index) => <p key={index}>{message}</p>)}</div>
          : activity.error || t("WorkspaceLiveActivity.checkYourSetupAndTryAgain");
  const elapsed = activity.kind === "skland" || activity.kind === "account" || activity.kind === "roster" ? null : running ? Math.max(activity.elapsedMs, now - activity.startedAt, 0) : activity.elapsedMs;
  const elapsedLabel = elapsed === null ? null : t("WorkspaceLiveActivity.s", { value1: (elapsed / 1000).toFixed(running ? 0 : 1) });
  const transition = reduceMotion ? { duration: 0 } : { duration: 0.38, ease: MOTION_EASE_OUT };

  useEffect(() => {
    const update = () => setPageVisible(!document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (!running || !pageVisible) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, pageVisible]);
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => setPeek(false), 3200);
    return () => clearTimeout(timer);
  }, [running]);
  useEffect(() => {
    if ((activity.kind !== "roster" && activity.phase !== "success") || hovered || focused || !pageVisible) return;
    const timer = setTimeout(() => onDismiss(activity), activity.kind === "roster" ? 3000 : 4000);
    return () => clearTimeout(timer);
  }, [activity, hovered, focused, pageVisible, onDismiss]);
  useEffect(() => () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }, []);
  useLayoutEffect(() => {
    const face = expanded ? expandedRef.current : compactRef.current;
    if (!face) return;
    const measure = () => {
      const next = { width: face.offsetWidth + 2, height: face.offsetHeight + 2 };
      setSize(current => current?.width === next.width && current?.height === next.height ? current : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(face);
    return () => observer.disconnect();
  }, [expanded]);

  return <motion.aside
    className="ef-live-activity"
    data-slot="live-activity" data-activity-kind={activity.kind} data-activity-phase={activity.phase}
    data-activity-view={expanded ? "expanded" : "compact"} data-solver-stage={activity.kind === "skland" || activity.kind === "account" || activity.kind === "roster" ? undefined : activity.stage}
    aria-label={title} aria-hidden={!present || undefined} inert={!present} tabIndex={present ? 0 : -1}
    onPointerEnter={event => {
      if (event.pointerType === "touch") return;
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      setHovered(true);
    }}
    onPointerLeave={() => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      leaveTimer.current = setTimeout(() => setHovered(false), 240);
    }}
    onFocusCapture={() => setFocused(true)}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    onClick={() => { if (!expanded) setFocused(true); }}
    onKeyDown={event => {
      if (event.key === "Enter" || event.key === " ") {
        if (event.target !== event.currentTarget) return;
        event.preventDefault(); setFocused(true);
      }
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation();
      if (!running) onDismiss(activity);
      else {
        setPeek(false); setHovered(false); setFocused(false);
        if (document.activeElement instanceof HTMLElement && event.currentTarget.contains(document.activeElement)) document.activeElement.blur();
      }
    }}
    style={{ width: "min(400px, calc(100vw - 24px))", height: 96, transformOrigin: "50% 0%" }}
    initial={reduceMotion ? false : { opacity: 0, y: -8, scale: 0.985 }}
    animate={{ opacity: 1, y: 0, scale: 1, width: size?.width, height: size?.height }}
    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.99 }}
    transition={transition}
  >
    <div className="sr-only" role={activity.phase === "error" ? "alert" : "status"} aria-atomic="true">{title}。{description}</div>
    <motion.div ref={compactRef} className="ef-live-compact" aria-hidden inert={expanded}
      initial={false} animate={{ opacity: expanded ? 0 : 1 }} transition={transition}>
      <StatusMark status={status} size={16} active={present && !expanded && pageVisible} />
      <span>{title}</span><small>{elapsedLabel}</small>
    </motion.div>
    <motion.div ref={expandedRef} className="ef-live-expanded" aria-hidden={!expanded || undefined} inert={!expanded}
      initial={false} animate={{ opacity: expanded ? 1 : 0 }} transition={transition}
      style={{ pointerEvents: expanded ? undefined : "none" }}>
      <div className="ef-live-body">
        <StatusMark status={status} size={28} active={present && expanded && pageVisible} />
        <div className="ef-live-copy"><strong>{title}</strong><div className="ef-live-description" data-yeye-scroll="auto" data-skland-sync-status={activity.kind === "skland" ? "" : undefined}>{description}</div></div>
        {elapsedLabel ? <span className="ef-live-time" aria-hidden>{elapsedLabel}</span> : null}
      </div>
      <div className="ef-live-actions">
        {activity.kind === "roster" ? <button type="button" aria-haspopup="dialog" onClick={() => {
          openRoster(document.querySelector<HTMLElement>("[data-manual-slot]") ?? undefined);
          onDismiss(activity);
        }}>{t("WorkspaceLiveActivity.setUpOperators")}</button> : null}
        {activity.kind === "skland" && sklandSyncReport ? <button type="button" aria-haspopup="dialog" onClick={() => { setSklandSyncDetailsOpen(true); onDismiss(activity); }}>{t("WorkspaceLiveActivity.viewDetails")}</button> : null}
        {activity.phase === "error" ? <button type="button" onClick={activity.kind === "evaluation" ? activity.retry : retrySolve}>{t("WorkspaceLiveActivity.retry")}</button> : null}
        <button type="button" onClick={() => onDismiss(activity)}
          aria-label={activity.kind === "roster" ? t("WorkspaceLiveActivity.dismissRosterNotification") : activity.kind === "account" ? t("WorkspaceLiveActivity.dismissAccountNotification") : activity.kind === "skland" ? t("WorkspaceLiveActivity.dismissSyncNotification") : t("WorkspaceLiveActivity.dismissSolverNotification")}>{t("WorkspaceLiveActivity.dismiss")}</button>
      </div>
    </motion.div>
  </motion.aside>;
}

function SklandSyncSummary({ status }: { status: SklandSyncStatus }) {
  const { t } = useWorkspace();
  return <div>
    <p>{status.blocked === "partial"
      ? t("WorkspaceLiveActivity.thisCharacterSRosterIsIncompleteThePreviousRoster")
      : status.blocked === "unsupported"
        ? t("WorkspaceLiveActivity.noneOfTheseOperatorsAreRecognizedByTheScheduler")
        : t("WorkspaceLiveActivity.syncedSchedulableOperatorsAndTheirEliteStages", { value1: status.count })}</p>
    {status.partial && !status.blocked ? <p>{t("WorkspaceLiveActivity.onlyPartOfTheRosterWasReturnedOtherOperators")}</p> : null}
    {!status.facilitiesApplied && !status.blocked ? <p>{t("WorkspaceLiveActivity.facilityDataIsIncompleteThePreviousSetupWasKept")}</p> : null}
    {status.unsupported.length ? <p>{t("WorkspaceLiveActivity.notYetSupportedExcludedFromScheduling")}{status.unsupported.join("、")}</p> : null}
  </div>;
}
