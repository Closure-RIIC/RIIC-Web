import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SIM_RATES } from "@riic/endfield-solver/simulation.mjs";
import { operatorData } from "@riic/endfield-data";
import { useWorkspace } from "../state";
import { RosterDialogTrigger } from "./RosterDialog";
import { StepBoosts } from "./StepBoosts";
import { StepCharts } from "./StepCharts";
import { StepLog, StepRooms, StepStats } from "./StepPanels";
import { StepPicker } from "./StepPicker";
import { StepRoomConfig } from "./StepRoomConfig";
import { StepSimulation, formatClock, formatDuration } from "../step/step-engine.ts";
import {
  buildStepConfig, defaultSource, effectTable, ensureBoostDays, maxBoostDays, roomEffectResolver, scheduledNames,
  validateStepConfig, type ImportSource,
} from "../step/step-model.ts";
import { applyStored, loadStepConfig, saveStepConfig, toStored } from "../step/step-store.ts";
import type { SimRates, StepBoostConfig, StepConfig, StepRoom, StepRoomKey, StepShift, StepView } from "../step/step-types.ts";
import { Action, ActionContent, actionClassName, Field, Notice, PageTitle, Section } from "@riic/endfield-ui";
import { Play, Pause, RotateCcw, FastForward, Import, Users, ChevronsUpDown } from "lucide-react";
import { Input } from "@riic/ui-primitives/input";
import "../step/step.css";

const RATES: SimRates = { work: SIM_RATES.work, rest: SIM_RATES.rest, head: SIM_RATES.head, assist: SIM_RATES.assist };

type Phase = "idle" | "running" | "paused" | "ended";
type PickerState =
  | { mode: "room"; key: StepRoomKey; shift: StepShift; index: number }
  | { mode: "boost"; day: number; index: number };

/** 步进模拟页：读取 Workspace/Result，事件驱动推演心情与产出。 */
export function StepPage() {
  const { workspace, result, ready, locale, t } = useWorkspace();
  const resolver = useMemo(() => roomEffectResolver(effectTable(workspace)), [workspace]);

  const [config, setConfig] = useState<StepConfig | null>(null);
  const [source, setSource] = useState<ImportSource>("template");
  const [startHour, setStartHour] = useState(8);
  const [maxHours, setMaxHours] = useState(24);
  const [sampleSec, setSampleSec] = useState(60);
  const [speed, setSpeed] = useState(100);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [started, setStarted] = useState(false);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const engine = useRef<StepSimulation | null>(null);
  const [snapshot, setSnapshot] = useState<{
    view: StepView; rates: Record<string, Record<string, number>>; centralBonus: number;
  } | null>(null);
  const bump = useCallback(() => {
    const simulation = engine.current;
    if (!simulation) return;
    const view = simulation.snapshot();
    setSnapshot({ view, rates: Object.fromEntries(Object.keys(view.rooms).map(key => [key, simulation.roomRates(key)])), centralBonus: simulation.centralBonus() });
  }, []);
  const configRef = useRef<StepConfig | null>(null);
  const startRef = useRef({ startHour, maxHours, sampleSec });
  useEffect(() => { startRef.current = { startHour, maxHours, sampleSec }; }, [startHour, maxHours, sampleSec]);

  const rebuild = useCallback((next: StepConfig) => {
    const options = { ...startRef.current };
    // 引擎只认补齐后的 days；否则“2 次/日”里缺的第二条会被静默丢掉。
    const normalized: StepConfig = { ...next, boost: ensureBoostDays(next.boost, maxBoostDays(options.startHour, options.maxHours)) };
    engine.current = new StepSimulation(normalized, resolver, RATES, options);
    setRunning(false);
    setPhase("idle");
    setStarted(false);
    bump();
  }, [resolver, bump]);

  const commit = useCallback((next: StepConfig, rebuildSim: boolean) => {
    configRef.current = next;
    setConfig(next);
    if (rebuildSim) rebuild(next);
  }, [rebuild]);

  // 名单/设施变化时重新导入；模拟专属配置从本地恢复。
  useEffect(() => {
    if (!ready) return;
    const nextSource = defaultSource(workspace, result);
    const next = applyStored(buildStepConfig(workspace, result, nextSource), loadStepConfig());
    configRef.current = next;
    setSource(nextSource);
    setConfig(next);
    rebuild(next);
  }, [ready, workspace, result, rebuild]);

  // 起点/时长/采样变化后按当前配置重建。
  useEffect(() => {
    if (!configRef.current) return;
    rebuild(configRef.current);
  }, [startHour, maxHours, sampleSec, rebuild]);

  useEffect(() => {
    if (config) saveStepConfig(toStored(config));
  }, [config]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const simulation = engine.current;
      if (!simulation) return;
      simulation.advanceBy(speed * 0.1);
      bump();
      if (simulation.view.ended) { setRunning(false); setPhase("ended"); }
    }, 100);
    return () => window.clearInterval(id);
  }, [running, speed, bump]);

  const view = snapshot?.view ?? null;
  const days = maxBoostDays(startHour, maxHours);
  const boost = config ? ensureBoostDays(config.boost, days) : null;
  const scheduled = useMemo(() => config ? scheduledNames(config.rooms) : new Set<string>(), [config]);

  const labelOf = (name: string) => locale === "en" ? operatorData(name)?.enName || name : name;

  function importFrom(kind: ImportSource) {
    const next = applyStored(buildStepConfig(workspace, result, kind), loadStepConfig());
    setSource(kind);
    setError("");
    commit(next, true);
  }

  function changeRoom(key: StepRoomKey, patch: Partial<StepRoom>) {
    if (!config) return;
    commit({ ...config, rooms: config.rooms.map(room => room.key === key ? { ...room, ...patch } : room) }, true);
  }

  function changeMood(name: string, value: number) {
    if (!config) return;
    commit({ ...config, moods: { ...config.moods, [name]: value } }, true);
  }

  function changeWork(name: string, value: boolean) {
    if (!config) return;
    commit({ ...config, work: { ...config.work, [name]: value } }, true);
  }

  function changeBoost(next: StepBoostConfig) {
    if (!config) return;
    commit({ ...config, boost: ensureBoostDays(next, days) }, true);
  }

  function validate() {
    if (!config) return false;
    if (!workspace.operators.length) { setError(t("名单为空，请先配置我的干员。", "Set up your roster before starting.")); return false; }
    if (!config.rooms.some(room => room.enabled)) { setError(t("请至少启用一个舱室。", "Enable at least one facility.")); return false; }
    const problems = validateStepConfig(config, new Set(workspace.operators.map(operator => operator.name)));
    if (problems.length) { setError(problems.join("；")); return false; }
    setError("");
    return true;
  }

  function start() {
    if (!config || running || !validate()) return;
    if (!engine.current || engine.current.view.ended) rebuild(config);
    setStarted(true);
    setRunning(true);
    setPhase("running");
  }

  function pause() {
    if (!running) return;
    setRunning(false);
    setPhase("paused");
    engine.current?.markPaused();
    bump();
  }

  function reset() {
    setRunning(false);
    setError("");
    if (config) rebuild(config);
  }

  function fastForward() {
    const simulation = engine.current;
    if (!simulation || !config || !validate()) return;
    setRunning(false);
    setStarted(true);
    simulation.runToEnd();
    setPhase(simulation.view.ended ? "ended" : "idle");
    bump();
  }

  function selectOperator(name: string) {
    if (!config || !picker || unavailable.has(name)) return;
    if (picker.mode === "boost") {
      const base = ensureBoostDays(config.boost, Math.max(days, picker.day + 1));
      const boostDays = base.days.map((day, dayIndex) => dayIndex === picker.day
        ? { list: day.list.map((entry, entryIndex) => entryIndex === picker.index ? { ...entry, target: name } : entry) }
        : day);
      commit({ ...config, boost: { ...base, days: boostDays } }, true);
      setPicker(null);
      return;
    }
    const rooms = config.rooms.map(room => {
      const crewA = room.crewA.map(value => value === name ? null : value);
      const crewB = room.crewB.map(value => value === name ? null : value);
      if (room.key !== picker.key) return { ...room, crewA, crewB };
      const crew = picker.shift === "a" ? crewA : crewB;
      const next = crew.map((value, index) => index === picker.index ? name : value);
      return { ...room, crewA: picker.shift === "a" ? next : crewA, crewB: picker.shift === "b" ? next : crewB };
    });
    commit({ ...config, rooms }, true);
    setPicker(null);
  }

  function clearOperator() {
    if (!config || !picker) return;
    if (picker.mode === "boost") {
      const base = ensureBoostDays(config.boost, Math.max(days, picker.day + 1));
      const boostDays = base.days.map((day, dayIndex) => dayIndex === picker.day
        ? { list: day.list.map((entry, entryIndex) => entryIndex === picker.index ? { ...entry, target: null } : entry) }
        : day);
      commit({ ...config, boost: { ...base, days: boostDays } }, true);
      setPicker(null);
      return;
    }
    const rooms = config.rooms.map(room => {
      if (room.key !== picker.key) return room;
      const cleared = (values: (string | null)[]) => values.map((value, index) => index === picker.index ? null : value);
      return { ...room, crewA: picker.shift === "a" ? cleared(room.crewA) : room.crewA, crewB: picker.shift === "b" ? cleared(room.crewB) : room.crewB };
    });
    commit({ ...config, rooms }, true);
    setPicker(null);
  }

  const currentName = (() => {
    if (!config || !picker) return null;
    if (picker.mode === "boost") return config.boost.days[picker.day]?.list[picker.index]?.target ?? null;
    const room = config.rooms.find(item => item.key === picker.key);
    if (!room) return null;
    return (picker.shift === "a" ? room.crewA : room.crewB)[picker.index] ?? null;
  })();

  const unavailable = new Set(picker?.mode === "boost"
    ? workspace.operators.map(op => op.name).filter(name => !scheduled.has(name)) : scheduled);
  if (currentName && picker?.mode !== "boost") unavailable.delete(currentName);

  const pickerTitle = picker?.mode === "boost"
    ? t(`助力目标 · 第 ${picker.day + 1} 天 · 第 ${picker.index + 1} 次`, `Assistance target · Day ${picker.day + 1} · Assist ${picker.index + 1}`)
    : t("选择排班干员", "Select assigned operator");

  const showResult = started && !!view && !!config;
  const percent = showResult && view && view.maxTSec > 0 ? (view.tSec / view.maxTSec) * 100 : 0;
  const phaseLabel = phase === "running" ? t("模拟中", "Running") : phase === "paused" ? t("已暂停", "Paused")
    : phase === "ended" ? t("模拟完成", "Complete") : t("待开始", "Ready");
  const controlsDisabled = !ready || running;

  return <div className="ef-page ef-schedule-page ef-step-page">
    <PageTitle title={t("步进模拟", "Step simulation")}
      subtitle={t("沿时间线检查排班，查看心情、换班与产出变化。", "Replay a schedule to inspect morale, shift changes and production.")}
      action={<RosterDialogTrigger className={actionClassName({ size: "sm" })} disabled={running}>
        <ActionContent icon={<Users />}>{t("编辑名单", "Edit roster")}</ActionContent>
      </RosterDialogTrigger>} />
    {error ? <Notice error>{error}</Notice> : null}
    {!ready ? <Notice>{t("正在读取本地配置…", "Loading local configuration…")}</Notice> : null}
    {ready && !workspace.operators.length ? <Notice>{t("请先配置我的干员，再从手动排班或当前结果导入。", "Set up your roster, then import a manual schedule or the current result.")}</Notice> : null}

    <Section title={t("排班设置", "Schedule setup")} actions={<>
      <Action size="sm" icon={<Import />} disabled={controlsDisabled} onClick={() => importFrom("manual")} id="importFromManualBtn">{t("导入手动排班", "Import manual schedule")}</Action>
      <Action size="sm" disabled={controlsDisabled || !result?.center} onClick={() => importFrom("result")} id="importFromResultBtn">{t("导入当前结果", "Import current result")}</Action>
      <Action size="sm" icon={<ChevronsUpDown />} aria-expanded={!collapsed} aria-controls="step-configuration" onClick={() => setCollapsed(value => !value)}>
        {collapsed ? t("展开", "Expand") : t("收起", "Collapse")}
      </Action>
    </>}>
      <div id="step-configuration" hidden={collapsed}>
        {config ? <StepRoomConfig rooms={config.rooms} moods={config.moods} work={config.work} startHour={startHour}
          disabled={running} onRoomChange={changeRoom} onMoodChange={changeMood} onWorkChange={changeWork}
          onPick={(key, shift, index) => setPicker({ mode: "room", key, shift, index })} /> : null}
        {source === "template" ? <p className="ef-facility-note">{t("当前为设施模板，请选择干员或导入排班。修改仅用于本页模拟。", "This is a facility template. Select operators or import a schedule. Changes apply only to this simulation.")}</p> : null}
      </div>
    </Section>

    <Section title={t("心情恢复助力", "Morale assistance")}>
      {boost ? <StepBoosts boost={boost} maxDays={days} scheduled={scheduled} labelOf={labelOf}
        disabled={running} assistEnabled={workspace.options.assist} onChange={changeBoost}
        onPickTarget={(day, index) => setPicker({ mode: "boost", day, index })} /> : null}
    </Section>

    <Section title={t("模拟控制", "Simulation controls")}>
      <div className="ef-form-grid">
        <Field label={t("曲线采样", "Chart sampling")} value={sampleSec} disabled={controlsDisabled} onValueChange={value => setSampleSec(Number(value))}
          options={[10, 30, 60, 300, 900].map(value => ({ value, label: value < 60 ? `${value} s` : `${value / 60} min` }))} />
        <Field label={t("模拟时长", "Duration")} value={maxHours} disabled={controlsDisabled} onValueChange={value => setMaxHours(Number(value))}
          options={[24, 48, 72, 96].map(value => ({ value, label: `${value} h` }))} />
        <label className="ef-field"><span>{t("起点（小时）", "Start hour")}</span>
          <Input type="number" id="startHour" min={0} max={23} value={startHour} disabled={controlsDisabled}
            onChange={event => { if (event.target.value !== "") setStartHour(Math.min(23, Math.max(0, Math.round(Number(event.target.value))))); }} />
        </label>
        <Field label={t("播放速度", "Playback speed")} value={speed} onValueChange={value => setSpeed(Number(value))}
          options={[1, 10, 100, 1000].map(value => ({ value, label: `${value}×` }))} />
      </div>
      <div className="ef-actions ef-step-playback">
        <Action id="startBtn" size="sm" variant="yellow" icon={<Play />} onClick={start} disabled={!ready || running || phase === "ended"}>
          {phase === "paused" ? t("继续", "Resume") : t("开始", "Start")}
        </Action>
        <Action id="pauseBtn" size="sm" icon={<Pause />} onClick={pause} disabled={!running}>{t("暂停", "Pause")}</Action>
        <Action id="resetBtn" size="sm" icon={<RotateCcw />} onClick={reset} disabled={!ready}>{t("重置", "Reset")}</Action>
        <Action id="fastBtn" size="sm" icon={<FastForward />} onClick={fastForward} disabled={!ready || phase === "ended"}>{t("快进到结束", "Fast forward")}</Action>
        <span className="ef-muted" role="status">{phaseLabel}</span>
      </div>
      <div className="ef-step-timeline">
        <progress max={100} value={percent} aria-label={t("模拟进度", "Simulation progress")} />
        <div className="ef-step-time" id="timeInfo">
          <strong>{showResult && view ? formatClock(view.tSec, view.startHour) : "--:--:--"}</strong>
          <span className="ef-muted">{showResult && view ? `${formatDuration(view.tSec)} / ${formatDuration(view.maxTSec)}` : t("尚未开始", "Not started")}</span>
        </div>
      </div>
    </Section>

    <Section title={t("心情与产率曲线", "Morale and production curves")}>
      {showResult && view && config ? <StepCharts view={view} rooms={config.rooms} />
        : <div className="ef-empty"><p>{t("开始模拟后显示心情、换班与产率曲线。", "Start the simulation to see morale, shift changes and production rates.")}</p></div>}
    </Section>
    <Section title={t("舱室实时状态", "Live facility status")}>
      {showResult && view && config ? <StepRooms view={view} rooms={config.rooms} ratesOf={key => snapshot?.rates[key] ?? {}}
        centralBonus={snapshot?.centralBonus ?? 0} labelOf={labelOf} />
        : <p className="ef-muted">{t("尚未开始", "Not started")}</p>}
    </Section>
    <StepLog log={showResult && view ? view.log : []} startHour={startHour} onClear={() => { engine.current?.clearLog(); bump(); }} />
    <Section title={t("模拟统计", "Simulation statistics")}>
      {showResult && view && config ? <StepStats view={view} rooms={config.rooms} />
        : <p className="ef-muted">{t("尚未开始", "Not started")}</p>}
    </Section>
    <StepPicker open={!!picker} title={pickerTitle} current={currentName} unavailable={unavailable}
      onSelect={selectOperator} onClear={clearOperator} onClose={() => setPicker(null)} />
  </div>;
}
