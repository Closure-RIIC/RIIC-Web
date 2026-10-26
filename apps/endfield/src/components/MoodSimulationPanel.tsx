import { useEffect, useMemo, useRef, useState } from "react";
import { operatorData } from "@riic/endfield-data";
import type { Assignment } from "@riic/endfield-solver/model.mjs";
import { useWorkspace } from "../state";
import { StepSettings } from "./StepSettings";
import { MoodCharts } from "../mood-simulation/charts";
import { useMoodSimulation } from "../mood-simulation/use-simulation";
import { StepLog, StepStats } from "./StepPanels";
import { StepPicker } from "./StepPicker";
import {
  buildStepConfig, effectTable, ensureBoostDays, maxBoostDays, roomEffectResolver, scheduledNames, validateStepConfig,
} from "../step/step-model.ts";
import { applyStored, DEFAULT_STEP_CONTROLS, loadStepConfig, saveStepConfig, toStored, type StoredStep } from "../step/step-store.ts";
import type { StepBoostConfig } from "../step/step-types.ts";
import { Action, Notice, Section } from "@riic/endfield-ui";
import { Play, RotateCcw } from "lucide-react";
import "../step/step.css";

type PickerState = { day: number; index: number };

/** 只编辑模拟参数；排班由父级提供，排班变化时父级重挂载以清除旧回放。 */
export function MoodSimulationPanel({ assignments }: { assignments: Assignment[] }) {
  const { workspace, locale, t } = useWorkspace();
  const resolver = useMemo(() => roomEffectResolver(effectTable(workspace)), [workspace]);

  const [preferences, setPreferences] = useState<StoredStep | null>(null);
  const [controls, setControls] = useState(DEFAULT_STEP_CONTROLS);
  const [ready, setReady] = useState(false);
  const { startHour, maxHours } = controls;
  const config = useMemo(() => applyStored(buildStepConfig({ ...workspace, manual: assignments }, null, "manual"), preferences), [workspace, assignments, preferences]);
  const [error, setError] = useState("");
  const [picker, setPicker] = useState<PickerState | null>(null);
  const reportRef = useRef<HTMLDetailsElement>(null);
  const playback = useMoodSimulation(config, resolver, controls, ready);
  const { view, timeline, started } = playback;

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

  function showResults() {
    if (!validate()) return;
    playback.showResults();
    if (reportRef.current) reportRef.current.open = true;
    requestAnimationFrame(() => document.getElementById("moodCharts")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function reset() {
    setError("");
    playback.reset();
    if (reportRef.current) reportRef.current.open = false;
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
  return <>
  <div className="ef-step-page" id="manual-simulation">
    <Section>
      {error ? <Notice error>{error}</Notice> : null}
      {!ready ? <Notice>{t("正在读取本地配置…", "Loading local configuration…")}</Notice> : null}
      <div className="ef-actions ef-step-playback">
        <Action id="showResultBtn" size="sm" variant="yellow" icon={<Play />} onClick={showResults} disabled={!ready}>
          {t("展示模拟结果", "Show results")}
        </Action>
        <Action id="resetBtn" size="sm" icon={<RotateCcw />} onClick={reset} disabled={!ready}>
          {t("重置模拟", "Reset simulation")}
        </Action>
      </div>
    </Section>

    <Section>
      {showResult && view && timeline ? <MoodCharts view={view} timeline={timeline} rooms={config.rooms} onSeek={seek} />
        : <div className="ef-empty"><p>{t("安排干员后点击「展示模拟结果」查看曲线。", "Assign operators, then choose Show results.")}</p></div>}
    </Section>
    <details className="ef-step-report"><summary>{t("模拟设置", "Simulation settings")}</summary>
      <StepSettings config={config} controls={controls} scheduled={scheduled} labelOf={labelOf} onControls={setControls}
        onMood={changeMood} onWork={changeWork} onBoost={changeBoost} onPick={(day, index) => setPicker({ day, index })} />
    </details>
    <details className="ef-step-report" ref={reportRef}><summary>{t("事件日志与模拟统计", "Events and statistics")}</summary>
      <StepLog log={showResult && view ? view.log : []} startHour={startHour} onClear={playback.clearLog} />      <Section title={t("模拟统计", "Simulation statistics")}>
      {showResult && view && config ? <StepStats view={view} rooms={config.rooms} />
        : <p className="ef-muted">{t("尚未开始", "Not started")}</p>}
      </Section>
    </details>
  </div>
  <StepPicker open={!!picker} title={pickerTitle} current={currentName} unavailable={unavailable}
    onSelect={selectTarget} onClear={() => selectTarget(null)} onClose={() => setPicker(null)} />
  </>;
}
