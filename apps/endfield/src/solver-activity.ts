import type { Assignment, Result, SolverProgress, SolverStage, Workspace } from "@shared/endfield-solver/index.mjs";

export type SolverRequest = { input: Workspace; assignments?: Assignment[] };
export type SolverMessage =
  | { type: "progress"; progress: SolverProgress }
  | { type: "result"; result: Result }
  | { type: "error"; error: string };

export interface SolverActivity {
  id: number;
  kind: "schedule" | "manual";
  phase: "running" | "success" | "error";
  stage: SolverStage;
  startedAt: number;
  elapsedMs: number;
  limited?: boolean;
  problem?: "empty" | "verification" | "worker";
  error?: string;
}

export function completeSolverActivity(activity: SolverActivity, result: Result): SolverActivity {
  const problem = !result.center ? "empty" : !result.verification.ok ? "verification" : undefined;
  return {
    ...activity, stage: "verifying", phase: problem ? "error" : "success",
    elapsedMs: result.elapsedMs, problem,
    limited: activity.kind === "schedule" && !result.status.searchComplete,
    error: problem === "verification" ? result.verification.errors.join("；") : undefined,
  };
}
