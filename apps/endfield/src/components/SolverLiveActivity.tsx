import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { StatusMark } from "../../../../packages/ui-primitives/status-mark";
import { MOTION_EASE_OUT } from "@shared/ui-primitives/motion";
import type { SolverActivity } from "../solver-activity";
import { useWorkspace } from "../state";

export function SolverLiveActivity() {
  const { activity } = useWorkspace();
  const [dismissed, setDismissed] = useState<string>();
  const dismiss = useCallback((id: number, phase: SolverActivity["phase"]) => setDismissed(`${id}:${phase}`), []);
  return <AnimatePresence initial={false} mode="wait">
    {activity && dismissed !== `${activity.id}:${activity.phase}`
      ? <ActivitySurface key={activity.id} activity={activity} onDismiss={dismiss} />
      : null}
  </AnimatePresence>;
}

function ActivitySurface({ activity, onDismiss }: {
  activity: SolverActivity;
  onDismiss: (id: number, phase: SolverActivity["phase"]) => void;
}) {
  const { t, retrySolve } = useWorkspace();
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
  const running = activity.phase === "running";
  const expanded = peek || hovered || focused || !running;
  const status = running ? "running" : activity.phase === "success" ? "done" : "failed";
  const manual = activity.kind === "manual";
  const title = running
    ? manual ? t("正在评估方案", "Evaluating schedule") : t("正在生成排班", "Generating schedule")
    : activity.phase === "success"
      ? manual ? t("方案评估完成", "Evaluation complete") : t("排班已生成", "Schedule generated")
      : activity.problem === "empty" ? t("未找到可用方案", "No schedule found")
        : activity.problem === "verification" ? t("方案校验未通过", "Schedule validation failed")
          : manual ? t("方案评估失败", "Evaluation failed") : t("排班生成失败", "Scheduling failed");
  const stage = activity.stage === "preparing" ? t("准备干员与设施配置", "Preparing operators and facilities")
    : activity.stage === "searching"
      ? manual ? t("模拟生产与心情循环", "Simulating production and morale") : t("搜索班组与换班时间", "Searching crews and shift times")
      : t("校验人员、工位与产出", "Checking crew, capacity and output");
  const description = running ? stage
    : activity.phase === "success"
      ? activity.limited ? t("已生成当前搜索范围内的方案，详情见报告。", "A candidate is ready within the search budget. See the full report.")
        : t("人员、工位与产出校验通过，可以查看结果。", "Crew, capacity and output checked. Your result is ready.")
      : activity.problem === "empty" ? t("请检查名单、设施配置或调整搜索预算。", "Check your roster and facilities, or adjust the search budget.")
        : activity.error || t("请检查配置后重试。", "Check your setup and try again.");
  const elapsed = running ? Math.max(activity.elapsedMs, now - activity.startedAt, 0) : activity.elapsedMs;
  const elapsedLabel = t(`${(elapsed / 1000).toFixed(running ? 0 : 1)} 秒`, `${(elapsed / 1000).toFixed(running ? 0 : 1)}s`);
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
    if (activity.phase !== "success" || hovered || focused || !pageVisible) return;
    const timer = setTimeout(() => onDismiss(activity.id, activity.phase), 4000);
    return () => clearTimeout(timer);
  }, [activity.id, activity.phase, hovered, focused, pageVisible, onDismiss]);
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
    data-activity-view={expanded ? "expanded" : "compact"} data-solver-stage={activity.stage}
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
      if (!running) onDismiss(activity.id, activity.phase);
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
    <span className="sr-only" role={activity.phase === "error" ? "alert" : "status"} aria-atomic="true">{title}。{description}</span>
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
        <div className="ef-live-copy"><strong>{title}</strong><p>{description}</p></div>
        <span className="ef-live-time" aria-hidden>{elapsedLabel}</span>
      </div>
      <div className="ef-live-actions">
        {activity.phase === "error" ? <button type="button" onClick={retrySolve}>{t("重试", "Retry")}</button> : null}
        <button type="button" onClick={() => onDismiss(activity.id, activity.phase)}
          aria-label={t("关闭求解提示", "Dismiss solver notification")}>{t("收起", "Dismiss")}</button>
      </div>
    </motion.div>
  </motion.aside>;
}
