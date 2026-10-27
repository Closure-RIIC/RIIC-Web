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
  const title = activity.kind === "roster" ? t("先配置我的干员", "Set up your operators") : activity.kind === "account" ? activity.title : activity.kind === "skland"
    ? activity.status.blocked ? t("森空岛同步需要确认", "Skland sync needs attention") : t("森空岛同步完成", "Skland sync complete")
    : running
    ? manual ? t("正在评估方案", "Evaluating schedule") : t("正在生成排班", "Generating schedule")
    : activity.phase === "success"
      ? manual ? t("方案评估完成", "Evaluation complete") : t("排班已生成", "Schedule generated")
      : activity.problem === "empty" ? t("未找到可用方案", "No schedule found")
        : activity.problem === "verification" ? t("方案校验未通过", "Schedule validation failed")
          : manual ? t("方案评估失败", "Evaluation failed") : t("排班生成失败", "Scheduling failed");
  const stage = activity.kind === "skland" || activity.kind === "account" || activity.kind === "roster" ? "" : activity.stage === "preparing" ? t("准备干员与设施配置", "Preparing operators and facilities")
    : activity.stage === "searching"
      ? manual ? t("模拟生产与心情循环", "Simulating production and morale") : t("搜索班组与换班时间", "Searching crews and shift times")
      : t("校验人员、工位与产出", "Checking crew, capacity and output");
  const description = activity.kind === "roster" ? t("选择已拥有的干员后即可安排班次。", "Select your operators to start assigning shifts.") : activity.kind === "account" ? activity.description : activity.kind === "skland" ? <SklandSyncSummary status={activity.status} /> : running ? stage
    : activity.phase === "success"
      ? activity.limited ? t("已生成当前搜索范围内的方案，详情见报告。", "A candidate is ready within the search budget. See the full report.")
        : t("人员、工位与产出校验通过，可以查看结果。", "Crew, capacity and output checked. Your result is ready.")
      : activity.problem === "empty" ? t("请检查名单、设施配置或调整搜索预算。", "Check your roster and facilities, or adjust the search budget.")
        : activity.kind === "evaluation" && activity.error ? <div>{activity.error.split("；").map((message, index) => <p key={index}>{message}</p>)}</div>
          : activity.error || t("请检查配置后重试。", "Check your setup and try again.");
  const elapsed = activity.kind === "skland" || activity.kind === "account" || activity.kind === "roster" ? null : running ? Math.max(activity.elapsedMs, now - activity.startedAt, 0) : activity.elapsedMs;
  const elapsedLabel = elapsed === null ? null : t(`${(elapsed / 1000).toFixed(running ? 0 : 1)} 秒`, `${(elapsed / 1000).toFixed(running ? 0 : 1)}s`);
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
        }}>{t("配置干员", "Set up operators")}</button> : null}
        {activity.kind === "skland" && sklandSyncReport ? <button type="button" aria-haspopup="dialog" onClick={() => { setSklandSyncDetailsOpen(true); onDismiss(activity); }}>{t("查看明细", "View details")}</button> : null}
        {activity.phase === "error" ? <button type="button" onClick={activity.kind === "evaluation" ? activity.retry : retrySolve}>{t("重试", "Retry")}</button> : null}
        <button type="button" onClick={() => onDismiss(activity)}
          aria-label={activity.kind === "roster" ? t("关闭干员配置提示", "Dismiss roster notification") : activity.kind === "account" ? t("关闭账号提示", "Dismiss account notification") : activity.kind === "skland" ? t("关闭同步提示", "Dismiss sync notification") : t("关闭求解提示", "Dismiss solver notification")}>{t("收起", "Dismiss")}</button>
      </div>
    </motion.div>
  </motion.aside>;
}

function SklandSyncSummary({ status }: { status: SklandSyncStatus }) {
  const { t } = useWorkspace();
  return <div>
    <p>{status.blocked === "partial"
      ? t("当前角色的干员数据不完整，尚未替换排班名单和设施配置。请在森空岛公开完整干员数据后刷新。", "This character's roster is incomplete. The previous roster and facilities were kept. Make the full roster public in Skland, then refresh.")
      : status.blocked === "unsupported"
        ? t("当前干员均未被排班数据识别，已保留原名单和设施配置。", "None of these operators are recognized by the scheduler. The previous roster and facilities were kept.")
        : t(`已同步 ${status.count} 名可排班干员及精英化阶段。`, `Synced ${status.count} schedulable operators and their elite stages.`)}</p>
    {status.partial && !status.blocked ? <p>{t("本次仅返回部分干员，已保留该角色此前同步的其余名单。", "Only part of the roster was returned. Other operators previously saved for this character were retained.")}</p> : null}
    {!status.facilitiesApplied && !status.blocked ? <p>{t("设施数据不完整，已保留原设施配置，请在排班前确认等级。", "Facility data is incomplete. The previous setup was kept; check facility levels before scheduling.")}</p> : null}
    {status.unsupported.length ? <p>{t("暂未支持，未纳入排班：", "Not yet supported; excluded from scheduling: ")}{status.unsupported.join("、")}</p> : null}
  </div>;
}
