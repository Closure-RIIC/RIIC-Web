import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { convertToModelMessages, createUIMessageStreamResponse, stepCountIs, streamText, type ToolSet, type UIMessage } from "ai";
import { PublicApiError } from "@riic/platform-server/api-contract";
import { activeAgentPolicies, agentSessionId, beginAgentRun, recordFilterEvent, settleAgentRun } from "../billing/agent-accounting.ts";
import { AgentFilterError, compileFilterPolicy } from "./filter-policy.ts";
import { createGatewayRun } from "./gateway-runtime.ts";
import { gatewaySettings } from "./gateway-config.ts";
import { createAccountedRun } from "./accounted-runtime.ts";
import { getAgentModel } from "./llm.ts";
import type { AgentLlmSettings } from "./config.ts";
import { buildAgentSystemPrompt } from "./persona.ts";
import { createAgentStreamPolicy } from "./stream-policy.ts";
import { buildAgentTools } from "./tools.ts";
import { createToolExecutor } from "./tool-executor.ts";
import { prepareAgentHistory } from "./message-history.ts";
import { withAgentAnswerBoundary } from "./answer-boundary.ts";
import type { AgentResourcePolicy } from "./resource-policy.ts";
import { agentPageContextPrompt, type AgentPageContext } from "../../agent-page-context.ts";

export async function agentChat(request: Request, userId: string, requestId: string, body: {
  messages: UIMessage[]; id?: unknown; conversationId?: unknown; attemptId?: unknown; pageContext?: AgentPageContext | null;
}, personaContent?: string | null, resources?: { id: string; policy: AgentResourcePolicy }, direct?: AgentLlmSettings) {
  if (!direct) gatewaySettings();
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
  // Construct the provider inside the protected scope, so setup failures release the run.
  let run: ReturnType<typeof createGatewayRun> | undefined;
  try {
    const context = { runId, requestId, userId, filterVersion: policies.filter.id, filter };
    run = direct
      ? createAccountedRun({ ...context, model: getAgentModel(direct), responseModelIdentity: true, identity: headers => ({
          provider: `riic-${direct.provider}`, model: direct.model, requestId: headers["x-request-id"],
        }) })
      : createGatewayRun({ ...context, sessionId: agentSessionId(userId, conversationId) });
    const runtime = run;
    const executor = createToolExecutor(runId, check);
    const tools: ToolSet = executor.wrap(buildAgentTools({ request, userId, resources: resources?.policy, onSolveEvent: executor.recordSolve }));
    const policy = createAgentStreamPolicy(request.signal);
    const result = streamText({ ...policy.options, maxRetries: 0, maxOutputTokens: 2048,
      model: withAgentAnswerBoundary(runtime.model, runtime.deliver), system, messages: await convertToModelMessages(messages, { tools }), tools, stopWhen: stepCountIs(12),
      onFinish: () => runtime.finalize("completed"),
      onAbort: async event => { policy.options.onAbort(event); await runtime.finalize("cancelled"); },
      onError: () => runtime.finalize("failed"),
    });
    // Consume the SDK stream even after a disconnected browser, so cancellation and accounting finish.
    return createUIMessageStreamResponse({ headers: { "X-Request-Id": requestId, "X-Agent-Run-Id": runId, "X-Agent-Resource-Version": resources?.id ?? "configured" },
      stream: result.toUIMessageStream({ sendReasoning: false, onError: error => policy.errorText(error) }).pipeThrough(policy.transform),
      consumeSseStream: ({ stream }) => stream.pipeTo(new WritableStream()).catch(() => {}),
    });
  } catch (error) {
    const state = error instanceof AgentFilterError ? "blocked" : "failed";
    if (run) await run.finalize(state); else await settleAgentRun(runId, state);
    throw error;
  }
}
