import { useCallback, useEffect, useState } from "react";
import type { Assignment, Result, Workspace } from "@riic/endfield-solver/model.mjs";
import type { SolverMessage, SolverRequest } from "./solver-activity";
import { workspaceKey } from "./result-cache";

type Evaluation = { key: string; result: Result | null; error: string };

/** Draft evaluation has its own worker so edits stay available and automatic plans remain usable. */
export function useManualEvaluation(workspace: Workspace, assignments: Assignment[], ready: boolean, visible: boolean) {
  const key = workspaceKey(workspace);
  const supported = ready && !workspace.options.assist;
  const enabled = supported && visible;
  const [completed, setCompleted] = useState<Evaluation | null>(null);
  const retry = useCallback(() => setCompleted(null), []);
  useEffect(() => {
    if (!enabled || completed?.key === key) return;
    let worker: Worker | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    const finish = (result: Result | null, error = "") => {
      if (!active) return;
      active = false;
      worker?.terminate();
      clearTimeout(timeout);
      setCompleted({ key, result, error });
    };
    const timer = setTimeout(() => {
      try {
        worker = new Worker(new URL("./solver.worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (event: MessageEvent<SolverMessage>) => {
          if (event.data.type === "result") {
            const result = event.data.result;
            finish(result, result.verification.ok ? "" : result.verification.errors.join("；"));
          } else if (event.data.type === "error") finish(null, event.data.error);
        };
        worker.onerror = () => finish(null, "@evaluation:failed");
        timeout = setTimeout(() => finish(null, "@evaluation:timeout"), workspace.options.time + 10000);
        const request: SolverRequest = { input: workspace, assignments: assignments.map(room => ({ ...room, a: room.a.filter(Boolean), b: room.b.filter(Boolean) })) };
        worker.postMessage(request);
      } catch { finish(null, "@evaluation:start"); }
    }, 300);
    return () => { active = false; clearTimeout(timer); clearTimeout(timeout); worker?.terminate(); };
  }, [workspace, assignments, key, enabled, completed?.key]);
  const current = supported && completed?.key === key ? completed : null;
  // Keep the previous figures mounted until the next valid result arrives, so they can animate.
  const displayed = supported && !current?.error && completed?.result?.verification.ok ? completed.result : null;
  return { result: current?.result ?? null, displayed, error: current?.error ?? "", pending: enabled && !current, retry };
}
