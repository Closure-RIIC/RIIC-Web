import { SIM_RATES } from "@riic/endfield-solver/simulation.mjs";
import { StepSimulation } from "../step/step-engine.ts";
import { ensureBoostDays, maxBoostDays, roomEffectResolver } from "../step/step-model.ts";
import { cursorView, displayTimeline } from "./timeline.ts";
import type { SimulationMessage, SimulationRequest } from "./worker-protocol.ts";

let engine: StepSimulation | null = null;
const send = (message: SimulationMessage) => self.postMessage(message);
self.onmessage = (event: MessageEvent<SimulationRequest>) => {
  const request = event.data;
  try {
    if (request.type === "run") {
      const { config, effects, options } = request.input;
      engine = new StepSimulation({ ...config, boost: ensureBoostDays(config.boost, maxBoostDays(options.startHour, options.maxHours)) }, roomEffectResolver(effects), SIM_RATES, options);
      engine.runToEnd();
      const view = engine.snapshot();
      send({ id: request.id, type: "complete", view: cursorView(view), timeline: displayTimeline(view) });
    } else {
      if (!engine) throw new Error("Simulation has not started");
      if (request.type === "seek") engine.seekTo(request.seconds);
      else engine.clearLog();
      send({ id: request.id, type: "complete", view: cursorView(engine.snapshot()) });
    }
  } catch { send({ id: request.id, type: "error" }); }
};
