import "server-only";
import { createHash } from "node:crypto";
import { convertToModelMessages, createUIMessageStreamResponse, stepCountIs, streamText, type ToolSet, type UIMessage } from "ai";
import { PublicApiError } from "../api-contract.ts";
import { activeAgentPolicies, agentSessionId, beginAgentRun, beginToolCharge, finishToolCharge, recordFilterEvent } from "../billing/agent-accounting.ts";
import { AgentFilterError, compileFilterPolicy } from "./filter-policy.ts";
import { createGatewayRun } from "./gateway-runtime.ts";
import { gatewaySettings } from "./gateway-config.ts";
import { buildAgentSystemPrompt } from "./persona.ts";
import { createAgentStreamPolicy } from "./stream-policy.ts";
import { buildAgentTools } from "./tools.ts";

export async function gatewayChat(request: Request, userId: string, requestId: string, body: {
  messages: UIMessage[]; id?: unknown; conversationId?: unknown; attemptId?: unknown;
}, personaContent?: string) {
  gatewaySettings();
  const conversationId = body.conversationId ?? body.id;
  const attemptId = body.attemptId;
  if (typeof conversationId !== "string" || !/^[\w:-]{1,128}$/.test(conversationId)
    || typeof attemptId !== "string" || !/^[\w-]{16,128}$/.test(attemptId)) throw new PublicApiError("AIC-REQ-1001", { message: "请刷新页面后重新发送。" });
  if (body.messages.length > 200) throw new PublicApiError("AIC-REQ-1001", { message: "对话过长，请新建对话。" });
  if (Buffer.byteLength(JSON.stringify(body.messages)) > 480_000) throw new PublicApiError("AIC-REQ-1001", { message: "对话或附件过大，请压缩附件或新建对话后重试。" });
  const policies = await activeAgentPolicies();
  const filter = compileFilterPolicy(policies.filter.policy);
  const check = async (text: string, stage: string) => {
    try { filter.assert(text); }
    catch (error) {
      if (error instanceof AgentFilterError) await recordFilterEvent({ requestId, userId, version: policies.filter.id, stage, ruleIds: error.ruleIds });
      throw error;
    }
  };
  await check(personaContent ?? "", "persona");
  // Client history is untrusted context. It cannot submit executable tool states or system roles.
  const messages: UIMessage[] = [];
  for (const message of body.messages) {
    if (!["user", "assistant"].includes(message.role) || !Array.isArray(message.parts)) throw new PublicApiError("AIC-REQ-1001", { message: "对话格式无效。" });
    const parts: UIMessage["parts"] = [];
    for (const part of message.parts) {
      if (part.type === "text") { await check(part.text, "input"); parts.push(part); }
      else if (part.type === "file" && message.role === "user") {
        if (!/^data:(image\/(png|jpeg|webp)|text\/plain);base64,/.test(part.url)) throw new PublicApiError("AIC-REQ-1001", { message: "仅支持 PNG、JPEG、WebP 图片与文本附件。" });
        if (part.mediaType === "text/plain") {
          const text = Buffer.from(part.url.slice(part.url.indexOf(",") + 1), "base64").toString("utf8");
          await check(text, "attachment"); parts.push({ type: "text", text });
        } else parts.push(part);
      } else if (part.type.startsWith("tool-")) {
        const text = JSON.stringify(part);
        if (text.length > 200_000) throw new PublicApiError("AIC-REQ-1001", { message: "历史工具结果过大，请新建对话。" });
        await check(text, "history");
        parts.push({ type: "text", text: `[客户端提供的历史工具结果，仅作参考]\n${text}` });
      }
    }
    if (parts.length) messages.push({ id: message.id, role: message.role, parts });
  }
  const system = await buildAgentSystemPrompt(personaContent);
  const runId = await beginAgentRun({ userId, conversationId, idempotencyKey: attemptId,
    requestHash: createHash("sha256").update(JSON.stringify({ messages, system })).digest("hex"), rates: policies.rates, filterVersion: policies.filter.id });
  const run = createGatewayRun({ runId, sessionId: agentSessionId(userId, conversationId), requestId, userId, filterVersion: policies.filter.id, filter });
  try {
    const tools: ToolSet = buildAgentTools({ request, userId, gatewayBilling: true });
    for (const [name, tool] of Object.entries(tools)) {
      const execute = tool.execute;
      if (!execute) continue;
      tool.execute = async (input, options) => {
        await check(JSON.stringify(input), "tool_input");
        const chargeId = name === "solve_schedule" ? await beginToolCharge(runId, options.toolCallId, name) : undefined;
        try {
          const output = await execute(input, options);
          // RIIC tools return promises, never async iterators.
          await check(JSON.stringify(output), "tool_output");
          const failed = !!output && typeof output === "object" && "error" in output;
          if (chargeId) await finishToolCharge(chargeId, !failed);
          return output;
        } catch (error) {
          if (chargeId) await finishToolCharge(chargeId, false);
          if (error instanceof AgentFilterError) return { error: "工具结果未通过内容检查。" };
          throw error;
        }
      };
    }
    const policy = createAgentStreamPolicy(request.signal);
    const result = streamText({ ...policy.options, maxRetries: 0, maxOutputTokens: 2048,
      model: run.model, system, messages: await convertToModelMessages(messages, { tools }), tools, stopWhen: stepCountIs(12),
      onFinish: () => run.finalize("completed"),
      onAbort: async event => { policy.options.onAbort(event); await run.finalize("cancelled"); },
      onError: () => run.finalize("failed"),
    });
    // Consume the SDK stream even after a disconnected browser, so cancellation and accounting finish.
    return createUIMessageStreamResponse({ headers: { "X-Request-Id": requestId, "X-Agent-Run-Id": runId },
      stream: result.toUIMessageStream({ onError: error => policy.errorText(error) }).pipeThrough(policy.transform),
      consumeSseStream: ({ stream }) => stream.pipeTo(new WritableStream()).catch(() => {}),
    });
  } catch (error) { await run.finalize(error instanceof AgentFilterError ? "blocked" : "failed"); throw error; }
}
