import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { convertToModelMessages, createUIMessageStreamResponse, stepCountIs, streamText, type ToolSet, type UIMessage } from "ai";
import { PublicApiError } from "@riic/platform-server/api-contract";
import { activeAgentPolicies, agentSessionId, beginAgentRun, beginToolCharge, finishToolCharge, recordFilterEvent } from "../billing/agent-accounting.ts";
import { AgentFilterError, compileFilterPolicy } from "./filter-policy.ts";
import { createGatewayRun } from "./gateway-runtime.ts";
import { gatewaySettings } from "./gateway-config.ts";
import { buildAgentSystemPrompt } from "./persona.ts";
import { createAgentStreamPolicy } from "./stream-policy.ts";
import { buildAgentTools } from "./tools.ts";
import { prepareAgentHistory } from "./message-history.ts";
import { withAgentAnswerBoundary } from "./answer-boundary.ts";
import type { AgentResourcePolicy } from "./resource-policy.ts";
import { agentPageContextPrompt, type AgentPageContext } from "../../agent-page-context.ts";

export async function gatewayChat(request: Request, userId: string, requestId: string, body: {
  messages: UIMessage[]; id?: unknown; conversationId?: unknown; attemptId?: unknown; pageContext?: AgentPageContext | null;
}, personaContent?: string, resources?: { id: string; policy: AgentResourcePolicy }) {
  gatewaySettings();
  const conversationId = body.conversationId ?? body.id;
  const attemptId = body.attemptId;
  if (typeof conversationId !== "string" || !/^[\w:-]{1,128}$/.test(conversationId)
    || typeof attemptId !== "string" || !/^[\w-]{16,128}$/.test(attemptId)) throw new PublicApiError("AIC-REQ-1001", { message: "请刷新页面后重新发送。" });
  if (body.messages.length > 200) throw new PublicApiError("AIC-REQ-1001", { message: "对话过长，请新建对话。" });
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
  const messages = await prepareAgentHistory(body.messages, check);
  const system = `${await buildAgentSystemPrompt(personaContent, resources?.policy)}${agentPageContextPrompt(body.pageContext ?? null)}`;
  await check(system, "system");
  const runId = await beginAgentRun({ userId, conversationId, idempotencyKey: attemptId,
    requestHash: createHash("sha256").update(JSON.stringify({ messages, system, resources: resources?.id })).digest("hex"), rates: policies.rates, filterVersion: policies.filter.id });
  const run = createGatewayRun({ runId, sessionId: agentSessionId(userId, conversationId), requestId, userId, filterVersion: policies.filter.id, filter });
  try {
    const tools: ToolSet = buildAgentTools({ request, userId, gatewayBilling: true, resources: resources?.policy });
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
      model: withAgentAnswerBoundary(run.model, run.deliver), system, messages: await convertToModelMessages(messages, { tools }), tools, stopWhen: stepCountIs(12),
      onFinish: () => run.finalize("completed"),
      onAbort: async event => { policy.options.onAbort(event); await run.finalize("cancelled"); },
      onError: () => run.finalize("failed"),
    });
    // Consume the SDK stream even after a disconnected browser, so cancellation and accounting finish.
    return createUIMessageStreamResponse({ headers: { "X-Request-Id": requestId, "X-Agent-Run-Id": runId, "X-Agent-Resource-Version": resources?.id ?? "configured" },
      stream: result.toUIMessageStream({ sendReasoning: false, onError: error => policy.errorText(error) }).pipeThrough(policy.transform),
      consumeSseStream: ({ stream }) => stream.pipeTo(new WritableStream()).catch(() => {}),
    });
  } catch (error) { await run.finalize(error instanceof AgentFilterError ? "blocked" : "failed"); throw error; }
}
