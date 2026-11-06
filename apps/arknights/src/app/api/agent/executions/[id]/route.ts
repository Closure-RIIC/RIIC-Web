import { createRequestId, failureResponse, successResponse } from "@riic/platform-server/api-contract";
import { requireFeatureSession } from "@/server/auth/feature-access";
import { readToolExecution } from "@/server/agent/tool-executor";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  const path = "/api/agent/executions/[id]";
  try {
    const session = await requireFeatureSession(request, "agent");
    if (!session?.user) return new Response(null, { status: 401 });
    const { id } = await context.params;
    const execution = await readToolExecution(id, session.user.id);
    if (!execution) return new Response(null, { status: 404 });
    const response = successResponse(execution, requestId);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) { return failureResponse(error, requestId, path, startedAt); }
}
