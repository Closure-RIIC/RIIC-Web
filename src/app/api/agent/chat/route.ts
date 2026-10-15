import { convertToModelMessages, createUIMessageStreamResponse, stepCountIs, streamText, type UIMessage } from "ai";
import { appendFile } from "node:fs/promises";

import { assertSameOrigin, createRequestId, enforceRateLimit, failureResponse, PublicApiError, readJsonBody, successResponse } from "@/server/api-contract";
import { requireFeatureSession } from "@/server/auth/feature-access";
import { createAgentUsage, finalizeAgentUsage, getWallet } from "@/server/billing/service";
import { SOLVE_TOOL_POINTS } from "@/server/billing/config";
import { agentLlmSettings, agentModelChoices } from "@/server/agent/config";
import { getAgentModel } from "@/server/agent/llm";
import { createAgentStreamPolicy } from "@/server/agent/stream-policy";
import { buildAgentSystemPrompt } from "@/server/agent/persona";
import { listBuiltinAgentPersonas, resolveAgentPersonaContent } from "@/server/agent/persona-catalog";
import { buildAgentTools } from "@/server/agent/tools";
import { calculateAgentTokenCost } from "@/server/billing/pricing";
import { agentGatewayEnabled, gatewaySettings } from "@/server/agent/gateway-runtime";
import { gatewayChat } from "@/server/agent/gateway-chat";
import { AgentAccountingError } from "@/server/billing/agent-accounting";
import { AgentFilterError } from "@/server/agent/filter-policy";
import { AgentHistoryError, prepareAgentHistory } from "@/server/agent/message-history";
import { withAgentAnswerBoundary } from "@/server/agent/answer-boundary";
import { activeAgentResources } from "@/server/agent/resources";


// ── 临时监控（诊断"返回内容异常"用，问题定位后整段删除）──
// 把每次 agent 请求的输入、模型逐步原始输出、工具调用结果、流错误
// 追加写到 E:/arkriicinfra/result/agent-monitor/agent-io.jsonl，每行一个 JSON。
const AGENT_MONITOR_LOG = "E:/arkriicinfra/result/agent-monitor/agent-io.jsonl";

function monitorClip(value: unknown, max: number): unknown {
  try {
    const text = JSON.stringify(value) ?? "null";
    if (text.length <= max) return value;
    return `${text.slice(0, max)}…(截断，原文共 ${text.length} 字符)`;
  } catch {
    return "(不可序列化)";
  }
}

function monitorPart(part: unknown): unknown {
  if (!part || typeof part !== "object") return part;
  const p = part as Record<string, unknown>;
  switch (p.type) {
    case "text":
      return { type: "text", text: p.text };
    case "reasoning":
      return { type: "reasoning", text: monitorClip(p.text, 20_000) };
    case "tool-call":
      return { type: "tool-call", toolName: p.toolName, input: monitorClip(p.input, 20_000) };
    case "tool-result":
      return { type: "tool-result", toolName: p.toolName, input: monitorClip(p.input, 8_000), output: monitorClip(p.output, 120_000) };
    case "file":
      return { type: "file", filename: p.filename, mediaType: p.mediaType, urlLength: typeof p.url === "string" ? p.url.length : null };
    default:
      return { type: p.type, summary: monitorClip(p, 4_000) };
  }
}

function monitorMessage(message: UIMessage): unknown {
  return {
    id: message.id,
    role: message.role,
    parts: Array.isArray(message.parts) ? message.parts.map(monitorPart) : [],
  };
}

function monitorStep(step: unknown, index: number): unknown {
  if (!step || typeof step !== "object") return step;
  const s = step as Record<string, unknown>;
  const response = s.response as Record<string, unknown> | undefined;
  return {
    index,
    finishReason: s.finishReason,
    usage: s.usage,
    content: Array.isArray(s.content) ? s.content.map(monitorPart) : monitorClip(s.content, 20_000),
    warnings: monitorClip(s.warnings, 8_000),
    responseId: (response?.body as Record<string, unknown> | undefined)?.id ?? response?.id ?? null,
    responseModel: (response?.body as Record<string, unknown> | undefined)?.model ?? response?.model ?? null,
  };
}

async function monitorLog(entry: Record<string, unknown>): Promise<void> {
  if (process.env.NODE_ENV === "production") return;
  try {
    await appendFile(AGENT_MONITOR_LOG, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, "utf-8");
  } catch {
    // 监控自身失败时静默，不影响正常请求
  }
}
// ── 临时监控结束 ──

async function requireAgentAccess(request: Request) {
  const session = await requireFeatureSession(request, "agent");
  const wallet = await getWallet(session.user.id);
  if (wallet.totalPoints < SOLVE_TOOL_POINTS) {
    throw new PublicApiError("AIC-BILLING-4101", { message: `请先购买积分，Agent 至少需要 ${SOLVE_TOOL_POINTS} 积分才能使用。` });
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
    if (agentGatewayEnabled()) enforceRateLimit("agent-chat", session.user.id, 20, 60_000);
    const body = (await readJsonBody(request, 16 * 1024 * 1024)) as { model?: unknown; id?: unknown; conversationId?: unknown; attemptId?: unknown; messages?: UIMessage[]; persona?: { id?: unknown; kind?: unknown; name?: unknown; content?: unknown } };
    if (body.model !== undefined && body.model !== "deepseek" && body.model !== "glm") {
      throw new PublicApiError("AIC-REQ-1001", { message: "请选择可用的模型。" });
    }
    const settings = agentLlmSettings(body.model);
    if (!settings.configured && !agentGatewayEnabled()) {
      const response = failureResponse(
        new Error(`AGENT_LLM_API_KEY 未配置（provider=${settings.provider}），请在本机 .env.local 填入后重启开发服务。`),
        requestId,
        "/api/agent/chat",
        startedAt
      );
      return new Response(response.body, { status: 503, headers: response.headers });
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      const response = failureResponse(new Error("缺少对话消息。"), requestId, "/api/agent/chat", startedAt);
      return new Response(response.body, { status: 400, headers: response.headers });
    }
    let personaContent: string | undefined;
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
    if (agentGatewayEnabled()) return await gatewayChat(request, session.user.id, requestId, { ...body, messages: body.messages }, personaContent, resources ?? undefined);
    const messages = await prepareAgentHistory(body.messages, async () => {});
    const tools = buildAgentTools({ request, userId: session.user.id, resources: resources?.policy });
    // 临时监控：记录本次请求的完整输入（含历史消息与附件元数据）
    await monitorLog({
      event: "agent_request",
      requestId,
      userId: session.user.id,
      llm: { provider: settings.provider, baseURL: settings.baseURL, model: settings.model },
      persona: typeof body.persona?.content === "string" ? { name: body.persona?.name, contentLength: body.persona.content.length } : null,
      messages: body.messages.map(monitorMessage),
    });
    const streamPolicy = createAgentStreamPolicy(request.signal);
    const result = streamText({
      ...streamPolicy.options,
      model: withAgentAnswerBoundary(getAgentModel(settings)),
      system: await buildAgentSystemPrompt(personaContent, resources?.policy),
      messages: await convertToModelMessages(messages, { tools }),
      tools,
      stopWhen: stepCountIs(12),
      onFinish: async (event) => {
        // 临时监控：记录模型逐步原始输出（文本/推理/工具调用与结果/用量）
        await monitorLog({
          event: "agent_finish",
          requestId,
          finishReason: event.finishReason,
          totalUsage: event.totalUsage,
          steps: (await event.steps).map(monitorStep),
        });
        const usageIds = new Set<string>();
        for (const candidate of event.toolResults ?? []) {
          const output = (candidate as { output?: unknown }).output;
          if (!output || typeof output !== "object") continue;
          const billing = (output as { billing?: unknown }).billing;
          if (!billing || typeof billing !== "object") continue;
          const usageId = (billing as { usageId?: unknown }).usageId;
          if (typeof usageId === "string") usageIds.add(usageId);
        }
        // A pure conversation has no tool fee, but its measured token usage is
        // still billed as its own usage record.
        if (usageIds.size === 0) {
          usageIds.add(await createAgentUsage({
            userId: session.user.id,
            toolName: "agent_chat",
            runId: requestId,
            idempotencyKey: `agent_chat:${requestId}`,
          }));
        }
        const usage = event.usage;
        const model = String((event.model as { modelId?: unknown }).modelId ?? "unknown");
        const usageIdList = [...usageIds];
        const splitTokens = (total: number | undefined, index: number) => {
          const normalized = Math.max(0, Math.floor(total ?? 0));
          const count = Math.max(1, usageIdList.length);
          return Math.floor(normalized / count) + (index < normalized % count ? 1 : 0);
        };
        for (const [index, usageId] of usageIdList.entries()) {
          // Provider usage is reported at the model-step level. When one turn
          // invokes multiple billable tools, split the step totals once so the
          // same token usage is not charged repeatedly to every tool record.
          const inputTokens = splitTokens(usage.inputTokens, index);
          const outputTokens = splitTokens(usage.outputTokens, index);
          const cachedInputTokens = Math.min(inputTokens, splitTokens(usage.inputTokenDetails.cacheReadTokens, index));
          const pricing = calculateAgentTokenCost(model, {
            inputTokens,
            outputTokens,
            cachedInputTokens,
          });
          await finalizeAgentUsage({
            usageId,
            inputTokens,
            outputTokens,
            cachedInputTokens,
            upstreamCostRmbFen: pricing?.providerCostRmbFen,
            chargedCostRmbFen: pricing?.chargedCostRmbFen,
            chargedPoints: pricing?.chargedPoints,
            metadata: {
              model,
              finishReason: event.finishReason,
              pricing,
            },
          });
        }
      },
    });
    const stream = result.toUIMessageStream({
      sendReasoning: false,
      onError: (error) => {
        const message = streamPolicy.errorText(error);
        console.error(JSON.stringify({
          level: "error",
          event: "agent_stream_error",
          requestId,
          message,
        }));
        // 临时监控：记录流内错误（含堆栈，便于定位"返回很怪"是否为流中断/解析失败）
        void monitorLog({
          event: "agent_stream_error",
          requestId,
          message,
          stack: error instanceof Error ? error.stack : null,
          name: error instanceof Error ? error.name : null,
          cause: error instanceof Error && error.cause instanceof Error ? { message: error.cause.message, stack: error.cause.stack } : null,
        });
        return streamPolicy.errorText(error);
      },
    });
    return createUIMessageStreamResponse({
      headers: { "X-Request-Id": requestId, "X-Agent-Resource-Version": resources?.id ?? "configured" },
      stream: stream.pipeThrough(streamPolicy.transform),
    });
  } catch (error) {
    // 临时监控：记录请求级失败
    void monitorLog({
      event: "agent_request_error",
      requestId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    return failureResponse(error instanceof AgentFilterError || error instanceof AgentAccountingError || error instanceof AgentHistoryError
      ? new PublicApiError("AIC-REQ-1001", { message: error.message }) : error, requestId, "/api/agent/chat", startedAt);
  }
}
