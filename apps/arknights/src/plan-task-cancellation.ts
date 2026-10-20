import type { PlanTaskPollData, PlanTaskStatus } from "./api.ts";
import type { PublicPlanData } from "./types.ts";

const RUNNING_POLL_MS = 1_000;
const NEAR_QUEUE_POLL_MS = 2_000;
const MID_QUEUE_POLL_MS = 5_000;
const FAR_QUEUE_POLL_MS = 15_000;
const BUFFERED_POLL_MS = 30_000;
const JITTER_RATIO = 0.1;
export const PLAN_TASK_POLL_BACKOFF_MS = [2_000, 4_000, 8_000, 16_000, 32_000] as const;

export type PlanTaskCancellationResponse = {
  cancelled: boolean;
  reason: "running" | "unavailable" | null;
};

export type PlanTaskCancellationDecision = {
  clearTask: boolean;
  message: string | null;
};

export function planTaskCancellationDecision(
  response: PlanTaskCancellationResponse,
): PlanTaskCancellationDecision {
  if (response.cancelled) return { clearTask: true, message: null };
  return {
    clearTask: false,
    message: response.reason === "running"
      ? "任务已经开始计算，暂时无法取消；完成后仍会保留结果。"
      : "任务状态已经变化，正在重新查询。",
  };
}

export function planTaskPollDelayMs(input: {
  status: PlanTaskStatus;
  queuePosition?: number | null;
  etaSeconds?: number | null;
}, random = Math.random): number {
  let baseDelayMs = MID_QUEUE_POLL_MS;
  if (input.status === "running") baseDelayMs = RUNNING_POLL_MS;
  else if (input.status === "buffered") baseDelayMs = BUFFERED_POLL_MS;
  else if (input.status === "pending") {
    if ((input.etaSeconds ?? Infinity) <= 10 || (input.queuePosition ?? Infinity) <= 8) baseDelayMs = NEAR_QUEUE_POLL_MS;
    else if ((input.etaSeconds ?? Infinity) <= 30 || (input.queuePosition ?? Infinity) <= 40) baseDelayMs = MID_QUEUE_POLL_MS;
    else baseDelayMs = FAR_QUEUE_POLL_MS;
  }
  return Math.round(baseDelayMs * (0.9 + Math.min(1, Math.max(0, random())) * JITTER_RATIO * 2));
}

export type PlanTaskPollResponseDecision = {
  kind: "continue";
  status: "buffered" | "pending" | "running";
  queuePosition?: number;
  etaSeconds?: number;
  delayMs: number;
} | {
  kind: "done";
  result: PlanTaskPollData["result"];
  clearStoredTask: true;
} | {
  kind: "terminal";
  status: "failed" | "cancelled";
  message: string;
  notifyFailure: boolean;
  clearStoredTask: true;
};

export function planTaskPollResponseDecision(
  data: PlanTaskPollData,
  random = Math.random,
): PlanTaskPollResponseDecision {
  if (data.status === "done") {
    return { kind: "done", result: data.result, clearStoredTask: true };
  }
  if (data.status === "failed" || data.status === "cancelled") {
    return {
      kind: "terminal",
      status: data.status,
      message: data.error ?? (data.status === "cancelled" ? "任务已取消。" : "排班失败，请重试。"),
      notifyFailure: data.status === "failed",
      clearStoredTask: true,
    };
  }
  return {
    kind: "continue",
    status: data.status,
    queuePosition: data.queuePosition,
    etaSeconds: data.etaSeconds,
    delayMs: planTaskPollDelayMs(data, random),
  };
}

export type PlanTaskPollErrorDecision = {
  kind: "terminal";
  message: string;
  clearStoredTask: true;
} | {
  kind: "pause" | "stopped";
  message: string;
  clearStoredTask: false;
} | {
  kind: "retry";
  delayMs: number;
  nextAttempt: number;
  clearStoredTask: false;
};

export function planTaskPollErrorDecision(
  errorCode: string | null,
  attempt: number,
  retryAfterMs = 0,
): PlanTaskPollErrorDecision {
  if (errorCode === "AIC-REQ-1001") {
    return { kind: "terminal", message: "任务不存在或已过期，请重新生成排班。", clearStoredTask: true };
  }
  if (errorCode === "AIC-AUTH-2002") {
    return { kind: "terminal", message: "任务状态异常，请刷新页面后重试。", clearStoredTask: true };
  }
  if (errorCode === "AIC-AUTH-2001" || errorCode === "AIC-AUTH-2008") {
    return { kind: "pause", message: "登录已过期，请重新登录后刷新页面继续查询。", clearStoredTask: false };
  }
  if (attempt < PLAN_TASK_POLL_BACKOFF_MS.length || retryAfterMs > 0) {
    return {
      kind: "retry",
      delayMs: Math.max(PLAN_TASK_POLL_BACKOFF_MS[Math.min(attempt, PLAN_TASK_POLL_BACKOFF_MS.length - 1)], retryAfterMs),
      nextAttempt: Math.min(attempt + 1, PLAN_TASK_POLL_BACKOFF_MS.length),
      clearStoredTask: false,
    };
  }
  return { kind: "stopped", message: "网络异常，请点击查询进度。", clearStoredTask: false };
}

export type PlanTaskPollAttemptEffects = {
  poll: (taskId: string) => Promise<PlanTaskPollData>;
  isCurrent: (taskId: string) => boolean;
  errorCode: (error: unknown) => string | null;
  retryAfterMs?: (error: unknown) => number;
  finishDone: (result: PublicPlanData | null) => void;
  finishTerminal: (status: "failed" | "cancelled", message: string, notifyFailure: boolean) => void;
  continueActive: (decision: Extract<PlanTaskPollResponseDecision, { kind: "continue" }>) => void;
  schedule: (taskId: string, attempt: number, delayMs: number) => void;
  pause: (message: string) => void;
  stop: (message: string, recoverOnNetwork: boolean) => void;
};

export async function runPlanTaskPollAttempt(
  taskId: string,
  attempt: number,
  effects: PlanTaskPollAttemptEffects,
): Promise<void> {
  if (!effects.isCurrent(taskId)) return;
  try {
    const data = await effects.poll(taskId);
    if (!effects.isCurrent(taskId)) return;
    const decision = planTaskPollResponseDecision(data);
    if (decision.kind === "done") {
      effects.finishDone(decision.result ?? null);
      return;
    }
    if (decision.kind === "terminal") {
      effects.finishTerminal(decision.status, decision.message, decision.notifyFailure);
      return;
    }
    effects.continueActive(decision);
    effects.schedule(taskId, 0, decision.delayMs);
  } catch (error) {
    if (!effects.isCurrent(taskId)) return;
    const errorCode = effects.errorCode(error);
    const decision = planTaskPollErrorDecision(errorCode, attempt, effects.retryAfterMs?.(error));
    if (decision.kind === "terminal") {
      effects.finishTerminal("failed", decision.message, true);
      return;
    }
    if (decision.kind === "pause") {
      effects.pause(decision.message);
      return;
    }
    if (decision.kind === "retry") {
      effects.schedule(taskId, decision.nextAttempt, decision.delayMs);
      return;
    }
    effects.stop(decision.message, errorCode === null || errorCode === "AIC-SYS-5000");
  }
}
