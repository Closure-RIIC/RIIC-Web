import { createRequestId, failureResponse, successResponse } from "@/server/api-contract";
import { requireFeatureSession } from "@/server/auth/feature-access";
import { getAgentPlanArtifact } from "@/server/agent/plan-artifact";


export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    const session = await requireFeatureSession(request, "agent");
    if (!session?.user) {
      const response = failureResponse(new Error("请先登录网站账号。"), requestId, "/api/agent/plan/[id]", startedAt);
      return new Response(response.body, { status: 401, headers: response.headers });
    }
    const { id } = await context.params;
    const artifact = await getAgentPlanArtifact(id, session.user.id);
    if (!artifact) {
      const response = failureResponse(new Error("排班结果不存在或已过期。"), requestId, "/api/agent/plan/[id]", startedAt);
      return new Response(response.body, { status: 404, headers: response.headers });
    }
    return successResponse(
      {
        id: artifact.id,
        createdAt: artifact.createdAt.toISOString(),
        meta: artifact.meta,
        session: artifact.session,
      },
      requestId
    );
  } catch (error) {
    return failureResponse(error, requestId, "/api/agent/plan/[id]", startedAt);
  }
}
