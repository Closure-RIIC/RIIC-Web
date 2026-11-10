import { DefaultChatTransport, type PrepareSendMessagesRequest, type UIMessage } from "ai";
import { agentPlanReferences } from "./agent-plan-reference.ts";
import { INTERNAL_ANSWER_MARKERS } from "./agent-answer.ts";
import { AGENT_UNAVAILABLE_ERROR } from "./agent-chat-errors.ts";

/** Mirror the server's history allowlist before serialization; never mutate the local chat. */
export function agentRequestMessages(messages: readonly UIMessage[]): UIMessage[] {
  return messages.flatMap(message => {
    const lastTool = message.role === "assistant" ? message.parts.reduce((last, part, index) =>
      part.type.startsWith("tool-") || part.type === "dynamic-tool" ? index : last, -1) : -1;
    const parts: UIMessage["parts"] = [];
    for (const [index, part] of message.parts.entries()) {
      if (part.type === "text") {
        if (message.role === "assistant" && (index <= lastTool || INTERNAL_ANSWER_MARKERS.test(part.text))) continue;
        parts.push({ type: "text", text: part.text });
      } else if (message.role === "user" && part.type === "file") {
        parts.push({ type: "file", mediaType: part.mediaType, url: part.url, ...(part.filename ? { filename: part.filename } : {}) });
      }
    }
    return parts.length ? [{ id: message.id, role: message.role, parts }] : [];
  });
}

export const prepareAgentRequest: PrepareSendMessagesRequest<UIMessage> = ({ id, messages, body, trigger, messageId }) => ({
  body: { ...body, id, trigger, messageId, messages: agentRequestMessages(messages), planArtifactIds: agentPlanReferences(messages) },
});

/** Public API envelopes are structured errors, not text to print verbatim in chat. */
export async function agentChatFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (response.ok) return response;
  let message = AGENT_UNAVAILABLE_ERROR;
  try {
    const envelope: unknown = await response.json();
    if (envelope && typeof envelope === "object" && "error" in envelope && envelope.error && typeof envelope.error === "object") {
      const error = envelope.error as Record<string, unknown>;
      if (typeof error.code === "string" && /^AIC-[A-Z]+-\d{4}$/.test(error.code) && typeof error.message === "string" && error.message.length <= 1000) {
        message = error.message;
        const id = error.requestId;
        if (typeof id === "string" && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id)) message += ` (${id})`;
      }
    }
  } catch { /* HTML proxy failures and malformed bodies retain the safe generic message. */ }
  throw new Error(message);
}

export function createAgentChatTransport() {
  return new DefaultChatTransport({ api: "/api/agent/chat", prepareSendMessagesRequest: prepareAgentRequest, fetch: agentChatFetch });
}
