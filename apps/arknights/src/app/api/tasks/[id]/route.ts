import {
  assertSameOrigin,
  createRequestId,
  failureResponse,
  PublicApiError,
  successResponse,
} from "@riic/platform-server/api-contract";
import { requireWebsiteSession } from "@riic/platform-server/auth/authorization";
import {
  cancelPlanTask,
  currentPlanTaskEtaSeconds,
  getPlanTask,
  planQueuePosition,
  planSelectionPoolSize,
} from "@/server/plan-task";


async function authorizeTask(taskId: string, request: Request) {
  const task = await getPlanTask(taskId);
  if (!task) throw new PublicApiError("AIC-REQ-1001", { fieldErrors: [{ path: "taskId", code: "not_found", message: "任务不存在或已过期。" }] });
  if (task.userId) {
    const session = await requireWebsiteSession(request);
    if (session.user.id !== task.userId) throw new PublicApiError("AIC-AUTH-2002");
  }
  return task;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSameOrigin(request);
    const { id: taskId } = await params;
    const task = await authorizeTask(taskId, request);
    if (task.status === "buffered") {
      return successResponse({
        taskId,
        status: "buffered",
        selectionPoolSize: await planSelectionPoolSize(),
      }, requestId);
    }
    if (task.status === "pending") {
      const queuePosition = await planQueuePosition(taskId);
      return successResponse({
        taskId,
        status: "pending",
        queuePosition,
        etaSeconds: await currentPlanTaskEtaSeconds(queuePosition),
      }, requestId);
    }
    if (task.status === "running") {
      return successResponse({
        taskId,
        status: "running",
        queuePosition: 0,
        etaSeconds: await currentPlanTaskEtaSeconds(1, false),
      }, requestId);
    }
    if (task.status === "done") {
      if (!task.result) throw new PublicApiError("AIC-SYS-5000");
      return successResponse({ taskId, status: "done", result: task.result }, requestId);
    }
    return successResponse({
      taskId,
      status: task.status,
      ...(task.status === "failed" ? { error: task.error } : {}),
    }, requestId);
  } catch (error) {
    return failureResponse(error, requestId, `/api/tasks/${(await params).id}`, startedAt, "AIC-SYS-5000", request);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSameOrigin(request);
    const { id: taskId } = await params;
    const task = await authorizeTask(taskId, request);
    const result = await cancelPlanTask(task.id);
    return successResponse({
      taskId,
      cancelled: result === "cancelled",
      reason: result === "cancelled" ? null : result,
    }, requestId);
  } catch (error) {
    return failureResponse(error, requestId, `/api/tasks/${(await params).id}`, startedAt, "AIC-SYS-5000", request);
  }
}
