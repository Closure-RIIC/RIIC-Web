import { useCallback, useEffect, useRef, useState } from "react";
import { SIM_RATES } from "@riic/endfield-solver/simulation.mjs";
import { StepSimulation } from "../step/step-engine.ts";
import { ensureBoostDays, maxBoostDays } from "../step/step-model.ts";
import type { RoomEffectResolver, StepConfig, StepView } from "../step/step-types.ts";
import type { StepControls } from "../step/step-store.ts";

type Phase = "idle" | "running" | "paused" | "ended";
const PLAYBACK_INTERVAL_MS = 120;

/** PR #603 的回放控制层；完整曲线缓存与当前时刻状态共用终末地事件引擎。 */
export function useMoodSimulation(config: StepConfig, resolver: RoomEffectResolver, controls: StepControls, ready: boolean) {
  const { startHour, maxHours, sampleSec, speed } = controls;
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [started, setStarted] = useState(false);
  const [timeline, setTimeline] = useState<StepView | null>(null);
  const engine = useRef<StepSimulation | null>(null);
  const [snapshot, setSnapshot] = useState<StepView | null>(null);
  const bump = useCallback(() => { if (engine.current) setSnapshot(engine.current.snapshot()); }, []);
  const createSimulation = useCallback(() => new StepSimulation(
    { ...config, boost: ensureBoostDays(config.boost, maxBoostDays(startHour, maxHours)) }, resolver, SIM_RATES,
    { startHour, maxHours, sampleSec },
  ), [config, resolver, startHour, maxHours, sampleSec]);

  const reset = useCallback(() => {
    engine.current = createSimulation();
    setTimeline(null);
    setRunning(false);
    setPhase("idle");
    setStarted(false);
    bump();
  }, [createSimulation, bump]);
  useEffect(() => { if (ready) reset(); }, [ready, reset]);
  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const simulation = engine.current;
      if (!simulation) return;
      const now = performance.now();
      // 倍率与真实经过秒数相乘，切换采样精度不会改变播放速度。
      simulation.advanceBy((now - last) / 1000 * speed);
      last = now;
      bump();
      if (simulation.view.ended) { setRunning(false); setPhase("ended"); }
    }, PLAYBACK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [running, speed, bump]);

  function prepareTimeline() {
    if (timeline) return;
    const full = createSimulation();
    full.runToEnd();
    setTimeline(full.snapshot());
  }
  function start() {
    if (!ready || running) return;
    if (!engine.current) engine.current = createSimulation();
    else if (engine.current.view.ended) engine.current.seekTo(0);
    prepareTimeline();
    setStarted(true);
    setRunning(true);
    setPhase("running");
    bump();
  }
  function pause() {
    if (!running) return;
    setRunning(false);
    setPhase("paused");
    engine.current?.markPaused();
    bump();
  }
  function seek(seconds: number) {
    if (!ready || !engine.current) return;
    prepareTimeline();
    engine.current.seekTo(seconds);
    setRunning(false);
    setStarted(true);
    setPhase(engine.current.view.ended ? "ended" : "paused");
    bump();
  }
  function clearLog() { engine.current?.clearLog(); bump(); }
  return { view: snapshot, timeline, running, phase, started, start, pause, reset, seek, clearLog };
}
