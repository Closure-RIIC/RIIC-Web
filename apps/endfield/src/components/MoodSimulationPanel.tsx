import { useEffect, useMemo, useState } from "react";
import { operatorData } from "@riic/endfield-data";
import type { Assignment } from "@riic/endfield-solver/model.mjs";
import { useWorkspace } from "../state";
import { Dialog } from "@base-ui/react/dialog";
import { Slider } from "@riic/ui-primitives/slider";
import { DialogFrame } from "./DialogFrame";
import { StepSettings } from "./StepSettings";
import { MoodCharts } from "../mood-simulation/charts";
import { useMoodSimulation } from "../mood-simulation/use-simulation";
import { SIM_SPEEDS } from "../mood-simulation/constants";
import { StepLog, StepStats } from "./StepPanels";
import { StepPicker } from "./StepPicker";
import { formatClock, formatDuration } from "../step/step-engine.ts";
import {
  buildStepConfig, effectTable, ensureBoostDays, maxBoostDays, roomEffectResolver, scheduledNames, validateStepConfig,
} from "../step/step-model.ts";
import { applyStored, DEFAULT_STEP_CONTROLS, loadStepConfig, saveStepConfig, toStored, type StoredStep } from "../step/step-store.ts";
import type { StepBoostConfig } from "../step/step-types.ts";
import { Action, ActionContent, actionClassName, Field, Notice, Section } from "@riic/endfield-ui";
import { Play, Pause, RotateCcw, FastForward, Settings2 } from "lucide-react";
import "../step/step.css";

type PickerState = { day: number; index: number };

/** 只编辑模拟参数；排班由父级提供，排班变化时父级重挂载以清除旧回放。 */
export function MoodSimulationPanel({ assignments }: { assignments: Assignment[] }) {
  const { workspace, locale, t } = useWorkspace();
  const resolver = useMemo(() => roomEffectResolver(effectTable(workspace)), [workspace]);

  const [preferences, setPreferences] = useState<StoredStep | null>(null);
  const [controls, setControls] = useState(DEFAULT_STEP_CONTROLS);
  const [ready, setReady] = useState(false);
  const { startHour, maxHours, speed } = controls;
  const config = useMemo(() => applyStored(buildStepConfig({ ...workspace, manual: assignments }, null, "manual"), preferences), [workspace, assignments, preferences]);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const playback = useMoodSimulation(config, resolver, controls, ready);
  const { view, timeline, running, phase, started, pause } = playback;

  // 客户端挂载后恢复参数，避免服务端与首次渲染不一致。
  useEffect(() => {
    const stored = loadStepConfig();
    setPreferences(stored);
    setControls(stored?.controls ?? DEFAULT_STEP_CONTROLS);
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) saveStepConfig(toStored(config, controls));
  }, [ready, config, controls]);

  const days = maxBoostDays(startHour, maxHours);
  const scheduled = useMemo(() => scheduledNames(config.rooms), [config]);

  const labelOf = (name: string) => locale === "en" ? operatorData(name)?.enName || name : name;

  function changeMood(name: string, value: number) {
    setPreferences(toStored({ ...config, moods: { ...config.moods, [name]: value } }, controls));
  }

  function changeWork(name: string, value: boolean) {
    setPreferences(toStored({ ...config, work: { ...config.work, [name]: value } }, controls));
  }

  function changeBoost(next: StepBoostConfig) {
    setPreferences(toStored({ ...config, boost: ensureBoostDays(next, days) }, controls));
  }

  function validate() {
    if (!ready) return false;
    if (!workspace.operators.length) { setError(t("名单为空，请先配置我的干员。", "Set up your roster before starting.")); return false; }
    if (!config.rooms.some(room => room.enabled)) { setError(t("请至少启用一个舱室。", "Enable at least one facility.")); return false; }
    if (!scheduled.size) { setError(t("请先在编辑视图安排干员。", "Assign operators in the editor before starting.")); return false; }
    const problems = validateStepConfig(config, new Set(workspace.operators.map(operator => operator.name)));
    if (problems.length) { setError(problems.join("；")); return false; }
    setError("");
    return true;
  }

  function start() {
    if (validate()) playback.start();
  }

  function reset() {
    setError("");
    playback.reset();
  }

  function fastForward() {
    if (validate()) playback.seek(maxHours * 3600);
  }

  function seek(seconds: number) {
    if (validate()) playback.seek(seconds);
  }

  function selectTarget(name: string | null) {
    if (!picker || (name && !scheduled.has(name))) return;
    const base = ensureBoostDays(config.boost, Math.max(days, picker.day + 1));
    const boostDays = base.days.map((day, dayIndex) => dayIndex === picker.day
      ? { list: day.list.map((entry, entryIndex) => entryIndex === picker.index ? { ...entry, target: name } : entry) }
      : day);
    changeBoost({ ...base, days: boostDays });
    setPicker(null);
  }

  const currentName = picker ? config.boost.days[picker.day]?.list[picker.index]?.target ?? null : null;
  const unavailable = new Set(workspace.operators.map(op => op.name).filter(name => !scheduled.has(name)));
  const pickerTitle = picker
    ? t(`助力目标 · 第 ${picker.day + 1} 天 · 第 ${picker.index + 1} 次`, `Assistance target · Day ${picker.day + 1} · Assist ${picker.index + 1}`)
    : t("选择助力目标", "Choose assistance target");

  const showResult = started && !!view && !!config;
  const phaseLabel = phase === "running" ? t("模拟中", "Running") : phase === "paused" ? t("已暂停", "Paused")
    : phase === "ended" ? t("模拟完成", "Complete") : t("待开始", "Ready");
  return <Dialog.Root open={settingsOpen} onOpenChange={open => { if (open) pause(); setSettingsOpen(open); }}>
  <div className="ef-step-page" id="manual-simulation">
    <Section title={t("模拟回放", "Simulation replay")} actions={<Dialog.Trigger className={actionClassName({ size: "sm" })} disabled={!ready}>
      <ActionContent icon={<Settings2 />}>{t("模拟设置", "Simulation settings")}</ActionContent>
    </Dialog.Trigger>}>
      <p className="ef-muted">{t("与编辑视图共用排班。修改人员、设施或换班时间后，回放重置，模拟参数保留。", "Replay uses the shared schedule. Changing operators, facilities or shift times resets playback and keeps simulation settings.")}</p>
    </Section>
    {error ? <Notice error>{error}</Notice> : null}
    {!ready ? <Notice>{t("正在读取本地配置…", "Loading local configuration…")}</Notice> : null}

    <Section title={t("模拟控制", "Simulation controls")}>
      <div className="ef-actions ef-step-playback">
        <Action id="startBtn" size="sm" variant="yellow" icon={<Play />} onClick={start} disabled={!ready || running || phase === "ended"}>
          {phase === "paused" ? t("继续", "Resume") : t("开始", "Start")}
        </Action>
        <Action id="pauseBtn" size="sm" icon={<Pause />} onClick={pause} disabled={!running}>{t("暂停", "Pause")}</Action>
        <Action id="resetBtn" size="sm" icon={<RotateCcw />} onClick={reset} disabled={!ready}>{t("重置", "Reset")}</Action>
        <Action id="fastBtn" size="sm" icon={<FastForward />} onClick={fastForward} disabled={!ready || phase === "ended"}>{t("快进到结束", "Fast forward")}</Action>
        <Field label={t("播放速度", "Playback speed")} value={speed} disabled={!ready} onValueChange={value => setControls({ ...controls, speed: Number(value) })}
          options={SIM_SPEEDS.map(value => ({ value, label: `${value}×` }))} />
        <span className="ef-muted" role="status">{phaseLabel}</span>
      </div>
      <div className="ef-step-timeline">
        <Slider min={0} max={maxHours * 3600} step={60} largeStep={900} value={view?.tSec ?? 0} disabled={!ready || !scheduled.size}
          label={t("模拟时间轴", "Simulation timeline")} valueText={formatClock(view?.tSec ?? 0, startHour)} onValueChange={seek}
          onKeyDown={event => { if (event.code === "Space") { event.preventDefault(); if (running) pause(); else start(); } }} />
        <div className="ef-step-time" id="timeInfo">
          <strong>{showResult && view ? formatClock(view.tSec, view.startHour) : "--:--:--"}</strong>
          <span className="ef-muted">{showResult && view ? `${formatDuration(view.tSec)} / ${formatDuration(view.maxTSec)}` : t("尚未开始", "Not started")}</span>
        </div>
      </div>
    </Section>

    <Section title={t("心情与产率曲线", "Morale and production curves")}>
      {showResult && view && timeline ? <MoodCharts view={view} timeline={timeline} rooms={config.rooms} onSeek={seek} />
        : <div className="ef-empty"><p>{t("开始模拟后显示心情、换班与产率曲线。", "Start the simulation to see morale, shift changes and production rates.")}</p></div>}
    </Section>
    <details className="ef-step-report"><summary>{t("事件日志与模拟统计", "Events and statistics")}</summary>
      <StepLog log={showResult && view ? view.log : []} startHour={startHour} onClear={playback.clearLog} />
      <Section title={t("模拟统计", "Simulation statistics")}>
      {showResult && view && config ? <StepStats view={view} rooms={config.rooms} />
        : <p className="ef-muted">{t("尚未开始", "Not started")}</p>}
      </Section>
    </details>
  </div>
  <Dialog.Portal><Dialog.Backdrop className="ef-dialog-backdrop" />
    <DialogFrame className="ef-production-dialog" title={t("模拟设置", "Simulation settings")} closeLabel={t("关闭模拟设置", "Close simulation settings")}
      description={t("参数仅用于模拟回放，修改后重新开始。", "These settings apply to replay only. Changes reset playback.")}
      footer={<Dialog.Close className={actionClassName({ size: "sm", variant: "yellow" })}><ActionContent>{t("完成", "Done")}</ActionContent></Dialog.Close>}>
      <StepSettings config={config} controls={controls} scheduled={scheduled} labelOf={labelOf} onControls={setControls}
        onMood={changeMood} onWork={changeWork} onBoost={changeBoost} onPick={(day, index) => setPicker({ day, index })} />
      <StepPicker open={!!picker} title={pickerTitle} current={currentName} unavailable={unavailable}
        onSelect={selectTarget} onClear={() => selectTarget(null)} onClose={() => setPicker(null)} />
    </DialogFrame>
  </Dialog.Portal>
  </Dialog.Root>;
}
