import { evaluateManual, solve, type SolverProgress } from "@shared/endfield-solver/index.mjs";
import type { SolverMessage, SolverRequest } from "./solver-activity";

const send = (message: SolverMessage) => self.postMessage(message);
self.onmessage = (event: MessageEvent<SolverRequest>) => {
  try {
    const onProgress = (progress: SolverProgress) => send({ type: "progress", progress });
    const result = event.data.assignments
      ? evaluateManual(event.data.input, event.data.assignments, onProgress)
      : solve(event.data.input, onProgress);
    send({ type: "result", result });
  } catch (error) {
    send({ type: "error", error: error instanceof Error ? error.message : "求解失败 / Solver failed" });
  }
};
