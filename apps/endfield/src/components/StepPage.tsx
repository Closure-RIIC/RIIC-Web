import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { catalog } from "@riic/endfield-solver/model.mjs";
import { SIM_RATES } from "@riic/endfield-solver/simulation.mjs";
import { operatorData } from "@riic/endfield-data";
import { useWorkspace } from "../state";
import { workspaceKey } from "../result-cache";
import { RosterDialogTrigger } from "./RosterDialog";
import { StepBoosts } from "./StepBoosts";
import { StepCharts } from "./StepCharts";
import { StepLog, StepRooms, StepStats } from "./StepPanels";
import { StepPicker, type PickerOperator } from "./StepPicker";
import { StepRoomConfig } from "./StepRoomConfig";
import { StepSimulation, formatClock, formatDuration } from "../step/step-engine.ts";
import {
  applyStored, buildStepConfig, defaultSource, effectTable, ensureBoostDays, maxBoostDays, roomEffectResolver, scheduledNames,
  validateStepConfig, type ImportSource,
} from "../step/step-model.ts";
import { loadStepConfig, saveStepConfig, toStored } from "../step/step-store.ts";
import type { SimRates, StepBoostConfig, StepConfig, StepRoom, StepRoomKey, StepShift } from "../step/step-types.ts";
import "../step/step.css";

const RATES: SimRates = { work: SIM_RATES.work, rest: SIM_RATES.rest, head: SIM_RATES.head, assist: SIM_RATES.assist };

type Phase = "idle" | "running" | "paused" | "ended";
type PickerState =
  | { mode: "room"; key: StepRoomKey; shift: StepShift; index: number }
  | { mode: "boost"; day: number; index: number };

/** 步进模拟页：读取 Workspace/Result，事件驱动推演心情与产出。 */
export function StepPage() {
  const { workspace, result, ready, showImages } = useWorkspace();
  const signature = useMemo(() => workspaceKey(workspace), [workspace]);
  const resolver = useMemo(() => roomEffectResolver(effectTable(workspace)), [signature]);

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
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick(value => value + 1), []);

  const engine = useRef<StepSimulation | null>(null);
  const configRef = useRef<StepConfig | null>(null);
  const startRef = useRef({ startHour, maxHours, sampleSec });
  startRef.current = { startHour, maxHours, sampleSec };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, signature]);

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
      const target = Math.min(simulation.view.maxTSec, simulation.view.tSec + speed * 0.1);
      let guard = 0;
      while (simulation.view.tSec < target && !simulation.view.ended && guard < 100000) {
        if (!simulation.nextEvent()) break;
        guard += 1;
      }
      bump();
      if (simulation.view.ended) { setRunning(false); setPhase("ended"); }
    }, 100);
    return () => window.clearInterval(id);
  }, [running, speed]);

  const view = engine.current?.view ?? null;
  const days = maxBoostDays(startHour, maxHours);
  const boost = config ? ensureBoostDays(config.boost, days) : null;
  const scheduled = useMemo(() => config ? scheduledNames(config.rooms) : new Set<string>(), [config]);

  const pickerOperators = useMemo<PickerOperator[]>(() => workspace.operators.map(operator => {
    const entry = catalog.find(item => item.name === operator.name);
    return {
      name: operator.name,
      elite: operator.elite,
      rarity: entry?.rarity ?? 0,
      profession: entry?.profession ?? "",
      icon: entry ? operatorData(entry.id)?.icon : undefined,
    };
  }), [workspace.operators]);

  const labelOf = (name: string) => operatorData(name)?.name || name;
  const iconOf = (name: string) => operatorData(name)?.icon;

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

  function start() {
    if (!config || running) return;
    if (!workspace.operators.length) { setError("名单为空，请先在“编辑名单”中配置我的干员。"); return; }
    if (!config.rooms.some(room => room.enabled)) { setError("没有启用任何舱室，请先在“排班设置”里勾选要模拟的舱室。"); return; }
    const problems = validateStepConfig(config, new Set(workspace.operators.map(operator => operator.name)));
    if (problems.length) { setError(problems.join("；")); return; }
    setError("");
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
    if (!simulation || !config) return;
    setRunning(false);
    setStarted(true);
    simulation.runToEnd();
    setPhase(simulation.view.ended ? "ended" : "idle");
    bump();
  }

  function selectOperator(name: string) {
    if (!config || !picker) return;
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

  const unavailable = useMemo(() => {
    const names = new Set(scheduled);
    if (currentName) names.delete(currentName);
    return names;
  }, [scheduled, currentName]);

  const pickerTitle = picker?.mode === "boost"
    ? `选择助力目标 · 第 ${picker.day + 1} 天 · 第 ${picker.index + 1} 次`
    : picker
      ? `选择干员 · ${config?.rooms.find(room => room.key === picker.key)?.label ?? picker.key} ${picker.shift === "a" ? "一轮" : "二轮"} 槽位 ${picker.index + 1}`
      : "选择干员";

  const showResult = started && !!view && !!config;
  const percent = showResult && view && view.maxTSec > 0 ? (view.tSec / view.maxTSec) * 100 : 0;
  const info = !showResult || !view || !view.ops.length
    ? "尚未开始"
    : `当前：${formatClock(view.tSec, view.startHour)}（已模拟 ${formatDuration(view.tSec)} / 剩余 ${formatDuration(view.maxTSec - view.tSec)}）`;

  return <div className="step-page">
    <h1 className="sr-only">步进模拟 · 帝江号</h1>
    <main className="step-main">
      <section className="step-panel" id="setupPanel">
        <div className="step-panel-header">
          <h2>① 排班设置</h2>
          <div className="panel-actions">
            <button id="importFromManualBtn" className="step-btn-secondary" type="button" onClick={() => importFrom("manual")}>📥 从手动排班导入</button>
            <button id="importFromResultBtn" className="step-btn-secondary" type="button" disabled={!result?.center} onClick={() => importFrom("result")}>📊 从当前结果导入</button>
            <button id="collapseAllBtn" className="step-btn-secondary" type="button" onClick={() => setCollapsed(value => !value)}>{collapsed ? "全部展开" : "全部收起"}</button>
          </div>
        </div>
        {!ready ? <div className="rooms-placeholder">加载中…</div> : <>
          {error ? <div className="rooms-placeholder" style={{ color: "#c0392b" }}>{error}</div> : null}
          {!workspace.operators.length ? <div className="rooms-placeholder">
            名单为空，请先配置干员。
            <RosterDialogTrigger className="step-btn-secondary" style={{ marginLeft: 8 }}>编辑名单</RosterDialogTrigger>
          </div> : null}
          {config && !collapsed ? <StepRoomConfig
            rooms={config.rooms} moods={config.moods} work={config.work} startHour={startHour}
            disabled={running} showImages={showImages} labelOf={labelOf} iconOf={iconOf}
            onRoomChange={changeRoom} onMoodChange={changeMood} onWorkChange={changeWork}
            onPick={(key, shift, index) => setPicker({ mode: "room", key, shift, index })} /> : null}
          {config && !collapsed && source === "template" ? <p className="rooms-placeholder" style={{ padding: "0 0 8px" }}>
            当前只载入了设施骨架；可从手动排班或最近结果导入名单与换班时刻。
          </p> : null}
        </>}
      </section>

      <section className="step-panel">
        <div className="step-panel-header"><h2>⚡ 心情恢复助力</h2></div>
        {boost ? <StepBoosts boost={boost} maxDays={days} scheduled={scheduled} labelOf={labelOf}
          disabled={running} assistEnabled={workspace.options.assist}
          onChange={changeBoost} onPickTarget={(day, index) => setPicker({ mode: "boost", day, index })} />
          : <div className="rooms-placeholder">加载中…</div>}
      </section>

      <section className="step-panel">
        <div className="step-controls">
          <label>曲线采样
            <select id="sampleSec" value={sampleSec} disabled={running} onChange={event => setSampleSec(Number(event.target.value))}>
              <option value={10}>10 秒</option>
              <option value={30}>30 秒</option>
              <option value={60}>1 分钟</option>
              <option value={300}>5 分钟</option>
              <option value={900}>15 分钟</option>
            </select>
          </label>
          <label>时长
            <select id="maxHours" value={maxHours} disabled={running} onChange={event => setMaxHours(Number(event.target.value))}>
              <option value={24}>24 h</option>
              <option value={48}>48 h</option>
              <option value={72}>72 h</option>
              <option value={96}>96 h</option>
            </select>
          </label>
          <label>起点
            <input type="number" id="startHour" min={0} max={23} value={startHour} disabled={running} style={{ width: 56 }}
              onChange={event => { if (event.target.value === "") return; setStartHour(Math.min(23, Math.max(0, Math.round(Number(event.target.value))))); }} /> 时
          </label>
          <label>播放速度
            <select id="speedSel" value={speed} onChange={event => setSpeed(Number(event.target.value))}>
              <option value={1}>1×（实时）</option>
              <option value={10}>10×</option>
              <option value={100}>100×</option>
              <option value={1000}>1000×</option>
            </select>
          </label>
          <button id="startBtn" className="step-btn-primary" type="button" onClick={start} disabled={running || phase === "ended"}>▶ 开始</button>
          <button id="pauseBtn" type="button" onClick={pause} disabled={!running}>⏸ 暂停</button>
          <button id="resetBtn" type="button" className={phase === "ended" ? "step-btn-danger" : undefined} onClick={reset}>
            {phase === "ended" ? "⏹ 重置（模拟已结束）" : "⏹ 重置"}
          </button>
          <button id="fastBtn" type="button" onClick={fastForward} disabled={phase === "ended"}>⏭ 快进到结束</button>
        </div>
      </section>

      <section className="step-panel">
        <div className="timeline-bar">
          <div className="timeline-fill" id="timelineFill" style={{ width: `${percent}%` }} />
          <div className="timeline-cursor" id="timelineCursor" style={{ left: `${percent}%` }} />
        </div>
        <div className="timeline-info"><span id="timeInfo">{info}</span></div>
      </section>

      <section className="step-panel">
        <div className="step-panel-header"><h2>② 各舱心情曲线 &amp; 产率</h2></div>
        {showResult && view && config
          ? <StepCharts view={view} rooms={config.rooms} />
          : <div className="mood-charts-grid" id="moodCharts"><div className="chart-placeholder">点击「开始」后绘制</div></div>}
      </section>

      <section className="step-panel">
        <div className="step-panel-header"><h2>③ 舱室实时状态</h2></div>
        {showResult && view && config
          ? <StepRooms view={view} rooms={config.rooms} ratesOf={key => engine.current?.roomRates(key) ?? {}}
            centralBonus={engine.current?.centralBonus() ?? 0} labelOf={labelOf} iconOf={iconOf} showImages={showImages} />
          : <div className="rooms-grid" id="roomsGrid"><div className="rooms-placeholder">尚未开始</div></div>}
      </section>

      <section className="step-panel">
        {showResult && view
          ? <StepLog log={view.log} startHour={startHour} onClear={() => { engine.current?.clearLog(); bump(); }} />
          : <><div className="step-panel-header"><h2>④ 事件日志</h2><button className="step-btn-secondary" type="button">清空</button></div>
            <div className="log-list" id="logList"><div className="log-empty">暂无事件</div></div></>}
      </section>

      <section className="step-panel">
        <div className="step-panel-header"><h2>⑤ 最终统计</h2></div>
        {showResult && view && config ? <StepStats view={view} rooms={config.rooms} />
          : <div className="stats-area" id="statsArea"><div className="stats-placeholder">尚未开始</div></div>}
      </section>
    </main>

    <StepPicker
      open={!!picker}
      title={pickerTitle}
      operators={pickerOperators}
      current={currentName}
      unavailable={unavailable}
      scheduled={scheduled}
      boostOnly={picker?.mode === "boost"}
      showImages={showImages}
      onSelect={selectOperator}
      onClear={clearOperator}
      onClose={() => setPicker(null)}
    />
  </div>;
}
