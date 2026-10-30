import type { EffectTable, SimOptions, StepConfig, StepView } from "../step/step-types.ts";

export type SimulationInput = { config: StepConfig; effects: EffectTable; options: SimOptions };
export type SimulationTimeline = StepView & { rateIntegrals: Record<string, Record<string, number>> };
export type SimulationRequest = { id: number } & (
  | { type: "run"; input: SimulationInput }
  | { type: "seek"; seconds: number }
  | { type: "clear-log" }
);
export type SimulationMessage = { id: number } & (
  | { type: "complete"; view: StepView; timeline?: SimulationTimeline }
  | { type: "error" }
);
