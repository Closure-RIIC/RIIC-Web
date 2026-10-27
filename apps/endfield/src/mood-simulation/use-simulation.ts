import { useCallback, useEffect, useRef, useState } from "react";
import { SIM_RATES } from "@riic/endfield-solver/simulation.mjs";
import { StepSimulation } from "../step/step-engine.ts";
import { ensureBoostDays, maxBoostDays } from "../step/step-model.ts";
import type { RoomEffectResolver, StepConfig, StepView } from "../step/step-types.ts";
import type { StepControls } from "../step/step-store.ts";

/** 结果只在用户点击“展示模拟结果”时计算；参数变化会清空旧结果。 */
export function useMoodSimulation(config: StepConfig, resolver: RoomEffectResolver, controls: StepControls, ready: boolean) {
  const { startHour, maxHours, sampleSec } = controls;
  const [started, setStarted] = useState(false);
  const [timeline, setTimeline] = useState<StepView | null>(null);
  const [snapshot, setSnapshot] = useState<StepView | null>(null);
  const engine = useRef<StepSimulation | null>(null);
  const createSimulation = useCallback(() => new StepSimulation(
    { ...config, boost: ensureBoostDays(config.boost, maxBoostDays(startHour, maxHours)) }, resolver, SIM_RATES,
    { startHour, maxHours, sampleSec },
  ), [config, resolver, startHour, maxHours, sampleSec]);

  const reset = useCallback(() => {
    const next = createSimulation();
    engine.current = next;
    setTimeline(null);
    setSnapshot(next.snapshot());
    setStarted(false);
  }, [createSimulation]);

  useEffect(() => { if (ready) reset(); }, [ready, reset]);

  /** 一次性跑完并展示最终结果；这是唯一生成完整曲线的入口。 */
  const showResults = useCallback(() => {
    const full = createSimulation();
    full.runToEnd();
    engine.current = full;
    const view = full.snapshot();
    setTimeline(view);
    setSnapshot(view);
    setStarted(true);
  }, [createSimulation]);

  const seek = useCallback((seconds: number) => {
    if (!engine.current || !timeline) return;
    engine.current.seekTo(seconds);
    setSnapshot(engine.current.snapshot());
  }, [timeline]);

  const clearLog = useCallback(() => {
    engine.current?.clearLog();
    setSnapshot(engine.current?.snapshot() ?? null);
  }, []);

  return { view: snapshot, timeline, started, showResults, reset, seek, clearLog };
}
