import type { StepView } from "../step/step-types.ts";
import type { SimulationTimeline } from "./worker-protocol.ts";

/** Integrate every original sample in the worker, before reducing display-only history. */
export function displayTimeline(view: StepView): SimulationTimeline {
  const rateIntegrals: SimulationTimeline["rateIntegrals"] = {};
  const history = view.history;
  const stride = Math.max(1, Math.ceil(history.length / 720));
  const selected = new Set<number>();
  let previous = "";
  for (let index = 0; index < history.length; index++) {
    const point = history[index];
    const hours = ((history[index + 1]?.tSec ?? view.maxTSec) - point.tSec) / 3600;
    for (const [room, rates] of Object.entries(point.rates)) {
      const total = rateIntegrals[room] ??= {};
      for (const [product, rate] of Object.entries(rates)) total[product] = (total[product] ?? 0) + rate * hours;
    }
    const state = JSON.stringify([point.activeRounds, point.rates, point.workings]);
    if (state !== previous) {
      if (index) selected.add(index - 1);
      selected.add(index);
    }
    if (index % stride === 0 || index === history.length - 1) selected.add(index);
    previous = state;
  }
  return { ...view, rateIntegrals, history: [...selected].sort((a, b) => a - b).map(index => history[index]) };
}

/** The cursor only needs current state; historical arrays remain inside the worker. */
export function cursorView(view: StepView): StepView {
  const moodRanges = Object.fromEntries(view.ops.map(op => [op.name, { minimum: op.mood, maximum: op.mood }]));
  for (const point of view.history) for (const [name, mood] of Object.entries(point.moods)) {
    const range = moodRanges[name];
    if (range) { range.minimum = Math.min(range.minimum, mood); range.maximum = Math.max(range.maximum, mood); }
  }
  return { ...view, history: [], moodRanges };
}
