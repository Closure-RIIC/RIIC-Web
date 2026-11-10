import { POST as submitTask } from "../../app/api/tasks/route.ts";
import { cancelPlanTask, getPlanTask } from "../plan-task.ts";
import { waitForQueuedSolve } from "./queued-solve.ts";
import type { PublicPlanData } from "@riic/arknights-domain/types";

export async function runAgentQueuedPlan(request: Request, userId: string, body: object, signal: AbortSignal) {
  return waitForQueuedSolve({
    submit: async () => {
      const headers = new Headers(request.headers);
      headers.set("content-type", "application/json");
      headers.delete("content-length");
      const response = await submitTask(new Request(new URL("/api/tasks", request.url), { method: "POST", headers, body: JSON.stringify(body) }));
      const envelope = await response.json() as { success: boolean; data?: { taskId?: string; status: string; result?: PublicPlanData }; error?: { message?: string } };
      if (!response.ok || !envelope.success || !envelope.data) throw new Error(envelope.error?.message ?? "排班队列提交失败。");
      return envelope.data;
    },
    read: async id => {
      const task = await getPlanTask(id);
      if (task && task.userId !== userId) throw new Error("无权读取此排班任务。");
      return task;
    },
    cancel: async id => {
      const task = await getPlanTask(id);
      if (task && task.userId !== userId) throw new Error("无权取消此排班任务。");
      return cancelPlanTask(id, { includeRunning: true });
    },
  }, { signal });
}
