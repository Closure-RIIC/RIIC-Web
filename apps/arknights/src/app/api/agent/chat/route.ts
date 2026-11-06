import { type UIMessage } from "ai";

import { assertSameOrigin, createRequestId, enforceRateLimit, failureResponse, PublicApiError, readJsonBody, successResponse } from "@riic/platform-server/api-contract";
import { requireFeatureSession } from "@/server/auth/feature-access";
import { getWallet } from "@/server/billing/service";
import { agentLlmSettings, agentModelChoices } from "@/server/agent/config";
import { listBuiltinAgentPersonas, resolveAgentPersonaContent } from "@/server/agent/persona-catalog";
import { agentGatewayEnabled, gatewaySettings } from "@/server/agent/gateway-runtime";
import { gatewayChat, agentChat } from "@/server/agent/gateway-chat";
import { AgentAccountingError } from "@/server/billing/agent-accounting";
import { AgentFilterError } from "@/server/agent/filter-policy";
import { AgentHistoryError } from "@/server/agent/message-history";
import { activeAgentResources } from "@/server/agent/resources";
import { normalizeAgentPageContext } from "@/agent-page-context";


async function requireAgentAccess(request: Request) {
  const session = await requireFeatureSession(request, "agent");
  const wallet = await getWallet(session.user.id);
  if (wallet.totalPoints <= 0) {
    throw new PublicApiError("AIC-BILLING-4101", { message: "可用积分不足，请先充值。对话按实际 Token 用量计费，成功求解另扣 1 积分。" });
  }
  return { session, wallet };
}

export async function GET(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    await requireAgentAccess(request);
    const settings = agentLlmSettings();
    const automatic = agentGatewayEnabled();
    if (automatic) gatewaySettings();
    return successResponse(
      {
        enabled: automatic || settings.configured,
        automatic,
        provider: settings.configured ? settings.provider : null,
        model: settings.configured ? settings.model : null,
        personas: await listBuiltinAgentPersonas((await activeAgentResources())?.policy),
        models: automatic ? [] : agentModelChoices(),
      },
      requestId
    );
  } catch (error) {
    return failureResponse(error, requestId, "/api/agent/chat", startedAt, "AIC-SYS-5000", request);
  }
}

export async function POST(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSameOrigin(request);
    const { session } = await requireAgentAccess(request);
    const automatic = agentGatewayEnabled();
    if (automatic) enforceRateLimit("agent-chat", session.user.id, 20, 60_000);
    const body = (await readJsonBody(request, 16 * 1024 * 1024)) as { model?: unknown; id?: unknown; conversationId?: unknown; attemptId?: unknown; messages?: UIMessage[]; pageContext?: unknown; persona?: { id?: unknown; kind?: unknown; name?: unknown; content?: unknown } };
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      const response = failureResponse(new Error("缺少对话消息。"), requestId, "/api/agent/chat", startedAt);
      return new Response(response.body, { status: 400, headers: response.headers });
    }
    const pageContext = body.pageContext == null ? null : normalizeAgentPageContext(body.pageContext);
    if (body.pageContext != null && !pageContext) throw new PublicApiError("AIC-REQ-1001", { message: "当前页面摘要无效，请刷新页面后重试。" });
    let personaContent: string | null | undefined;
    const resources = await activeAgentResources();
    try { personaContent = await resolveAgentPersonaContent(body.persona, resources?.policy); }
    catch (error) {
      return failureResponse(new PublicApiError("AIC-REQ-1001", { message: "所选人格卡暂不可用，请重新选择。", cause: error }), requestId, "/api/agent/chat", startedAt);
    }
    const fileParts = body.messages.flatMap((message) => Array.isArray(message?.parts) ? message.parts.filter((part) => part?.type === "file") : []).map((part) => part as unknown as { url?: unknown; mediaType?: unknown; filename?: unknown });
    if (fileParts.length > 4) {
      const response = failureResponse(new Error("一次最多发送 4 个附件。"), requestId, "/api/agent/chat", startedAt);
      return new Response(response.body, { status: 413, headers: response.headers });
    }
    for (const part of fileParts) {
      if (typeof part.url !== "string" || part.url.length > 12_000_000) {
        const response = failureResponse(new Error("附件过大，请压缩后重试。"), requestId, "/api/agent/chat", startedAt);
        return new Response(response.body, { status: 413, headers: response.headers });
      }
    }
    // Automatic routing owns model selection, including for older clients that send null or a stale selection.
    if (automatic) return await gatewayChat(request, session.user.id, requestId, { ...body, messages: body.messages, pageContext }, personaContent, resources ?? undefined);
    if (body.model !== undefined && body.model !== "deepseek" && body.model !== "glm") {
      throw new PublicApiError("AIC-REQ-1001", { message: "请选择可用的模型。" });
    }
    const settings = agentLlmSettings(body.model);
    if (!settings.configured) {
      const response = failureResponse(
        new Error(`AGENT_LLM_API_KEY 未配置（provider=${settings.provider}），请在本机 .env.local 填入后重启开发服务。`),
        requestId,
        "/api/agent/chat",
        startedAt
      );
      return new Response(response.body, { status: 503, headers: response.headers });
    }
    return await agentChat(request, session.user.id, requestId, { ...body, messages: body.messages, pageContext }, personaContent, resources ?? undefined, settings);
  } catch (error) {
    return failureResponse(error instanceof AgentFilterError || error instanceof AgentAccountingError || error instanceof AgentHistoryError
      ? new PublicApiError("AIC-REQ-1001", { message: error.message }) : error, requestId, "/api/agent/chat", startedAt);
  }
}
