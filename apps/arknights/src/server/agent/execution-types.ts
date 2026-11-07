import type { PublicPlanData } from "@riic/arknights-domain/types";

export type SolveEvent =
  | { computation: "running" }
  | { computation: "succeeded" }
  | { computation: "failed"; errorCode: "solver_failed" }
  | { processing: "succeeded"; result: PublicPlanData }
  | { processing: "failed"; errorCode: "result_conversion_failed" };

export class AgentToolError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; this.name = "AgentToolError"; }
}

// Waiting is cancellable; the underlying computation is deliberately retained.
// Neither a wait timeout nor caller cancellation claims that the solver stopped.
export async function waitForTool<T>(work: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AgentToolError("tool_wait_timeout", "排班仍可能在计算，等待已结束；请查询本次执行结果，不要重复提交。")), ms);
      abort = () => reject(new AgentToolError("tool_wait_cancelled", "已停止等待；底层计算状态可通过本次执行记录查询。"));
      if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
    })]);
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}
