import { setTimeout as sleep } from "node:timers/promises";
import type { PublicPlanData } from "@riic/arknights-domain/types";

export interface QueuedSolveDependencies {
  submit: () => Promise<{ taskId?: string; status: string; result?: PublicPlanData }>;
  read: (id: string) => Promise<{ status: string; result: PublicPlanData | null; error: string | null } | null>;
  cancel: (id: string) => Promise<unknown>;
}

function readWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => { cleanup(); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) abort();
  });
}

/** Never resubmit: a single tool call owns exactly one durable queue task. */
export async function waitForQueuedSolve(deps: QueuedSolveDependencies, options: {
  signal?: AbortSignal; timeoutMs?: number; pollMs?: number;
} = {}): Promise<PublicPlanData> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new DOMException("排班任务等待超时，请稍后重试。", "TimeoutError")), options.timeoutMs ?? 180_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
  let taskId: string | undefined;
  try {
    signal.throwIfAborted();
    // Admission must finish even if cancelled mid-transaction, so we can cancel the created ID.
    const submitted = await deps.submit();
    taskId = submitted.taskId;
    signal.throwIfAborted();
    if (submitted.status === "done" && submitted.result) return submitted.result;
    if (!taskId) throw new Error("排班队列未返回任务编号。");
    for (;;) {
      signal.throwIfAborted();
      const task = await readWithSignal(deps.read(taskId), signal);
      signal.throwIfAborted();
      if (!task) throw new Error("排班任务不存在或已过期。");
      if (task.status === "done") {
        if (!task.result) throw new Error("排班任务缺少计算结果。");
        return task.result;
      }
      if (task.status === "failed") throw new Error(task.error ?? "排班求解失败。");
      if (task.status === "cancelled") throw new DOMException("排班任务已取消。", "AbortError");
      await sleep(options.pollMs ?? 500, undefined, { signal });
    }
  } catch (error) {
    if (taskId) {
      let cancellationError: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await deps.cancel(taskId); cancellationError = undefined; break; }
        catch (failure) { cancellationError = failure; if (attempt < 2) await sleep(100); }
      }
      if (cancellationError) throw new AggregateError([error, cancellationError], "排班调用已失败，但取消队列任务未成功，请联系管理员。", { cause: error });
    }
    throw error;
  } finally { clearTimeout(timer); }
}
