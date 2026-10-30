import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EffectTable, StepConfig, StepView } from "../step/step-types.ts";
import type { StepControls } from "../step/step-store.ts";
import type { SimulationInput, SimulationMessage, SimulationRequest, SimulationTimeline } from "./worker-protocol.ts";

type Playback = { input: SimulationInput; view: StepView | null; timeline: SimulationTimeline | null; pending: boolean; error: "failed" | "timeout" | null };
type Task = { worker: Worker; id: number; timer?: ReturnType<typeof setTimeout> };

/** Each input owns its worker; resets, edits and unmounts cancel both computation and stale replies. */
export function useMoodSimulation(config: StepConfig, effects: EffectTable, controls: StepControls, ready: boolean) {
  const { startHour, maxHours, sampleSec } = controls;
  const input = useMemo(() => ({ config, effects, options: { startHour, maxHours, sampleSec } }), [config, effects, startHour, maxHours, sampleSec]);
  const task = useRef<Task | null>(null);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const cancel = useCallback(() => {
    if (task.current) { clearTimeout(task.current.timer); task.current.worker.terminate(); task.current = null; }
  }, []);
  useEffect(() => cancel, [input, ready, cancel]);
  const reset = useCallback(() => { cancel(); setPlayback(null); }, [cancel]);
  const fail = useCallback((error: "failed" | "timeout") => {
    cancel();
    setPlayback({ input, view: null, timeline: null, pending: false, error });
  }, [input, cancel]);
  const send = useCallback((request: SimulationRequest) => {
    const current = task.current;
    if (!current) return;
    current.id = request.id;
    current.timer = setTimeout(() => fail("timeout"), 60_000);
    setPlayback(previous => ({ input, view: previous?.input === input ? previous.view : null,
      timeline: previous?.input === input ? previous.timeline : null, pending: true, error: null }));
    try { current.worker.postMessage(request); } catch { fail("failed"); }
  }, [input, fail]);
  const showResults = useCallback(() => {
    if (!ready) return;
    cancel();
    try {
      const worker = new Worker(new URL("./simulation.worker.ts", import.meta.url), { type: "module" });
      const current: Task = { worker, id: 0 };
      task.current = current;
      setPlayback(null);
      worker.onmessage = (event: MessageEvent<SimulationMessage>) => {
        if (task.current !== current || event.data.id !== current.id) return;
        clearTimeout(current.timer); current.timer = undefined;
        if (event.data.type === "error") { fail("failed"); return; }
        const { view, timeline } = event.data;
        setPlayback(previous => ({ input, view, timeline: timeline ?? (previous?.input === input ? previous.timeline : null), pending: false, error: null }));
      };
      const onFailure = () => { if (task.current === current) fail("failed"); };
      worker.onerror = onFailure;
      worker.onmessageerror = onFailure;
      send({ id: 1, type: "run", input });
    } catch { fail("failed"); }
  }, [ready, input, cancel, fail, send]);
  const seek = useCallback((seconds: number) => {
    const current = task.current;
    if (current && !current.timer && Number.isFinite(seconds)) send({ id: current.id + 1, type: "seek", seconds });
  }, [send]);
  const clearLog = useCallback(() => {
    const current = task.current;
    if (current && !current.timer) send({ id: current.id + 1, type: "clear-log" });
  }, [send]);
  const current = ready && playback?.input === input ? playback : null;
  return { view: current?.view ?? null, timeline: current?.timeline ?? null, started: !!current?.timeline,
    pending: current?.pending ?? false, error: current?.error ?? null, showResults, reset, seek, clearLog };
}
