import type { UIMessage } from "ai";
import { INTERNAL_ANSWER_MARKERS } from "../../agent-answer.ts";

export class AgentHistoryError extends Error {}

/** Prepare untrusted browser history for the model, never execute historical tools. */
export async function prepareAgentHistory(messages: UIMessage[], check: (text: string, stage: string) => Promise<void>) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 200
    || Buffer.byteLength(JSON.stringify(messages)) > 16_000_000) throw new AgentHistoryError("对话过长，请新建对话或缩小附件。");
  const prepared: UIMessage[] = [];
  let attachments = 0;
  for (const message of messages) {
    if (!message || !["user", "assistant"].includes(message.role) || !Array.isArray(message.parts)) throw new AgentHistoryError("对话格式无效。");
    const parts: UIMessage["parts"] = [];
    // Preserve only the final answer after the last historical tool, not narration.
    const lastTool = message.role === "assistant" ? message.parts.reduce((last, part, index) => part && typeof part.type === "string" && (part.type.startsWith("tool-") || part.type === "dynamic-tool") ? index : last, -1) : -1;
    for (const [index, part] of message.parts.entries()) {
      if (!part || typeof part.type !== "string") throw new AgentHistoryError("对话格式无效。");
      if (part.type === "text") {
        if (typeof part.text !== "string") throw new AgentHistoryError("对话格式无效。");
        if (message.role === "assistant" && (index <= lastTool || INTERNAL_ANSWER_MARKERS.test(part.text))) continue;
        await check(part.text, "input");
        parts.push({ type: "text", text: part.text });
      } else if (part.type === "file" && message.role === "user") {
        attachments++;
        if (attachments > 4 || typeof part.url !== "string" || part.url.length > 12_000_000) throw new AgentHistoryError("附件过多或过大，请压缩后重试。");
        const match = /^data:(image\/(?:png|jpeg|webp)|text\/plain);base64,([A-Za-z0-9+/]*={0,2})$/.exec(part.url);
        if (!match || match[1] !== part.mediaType) throw new AgentHistoryError("仅支持 PNG、JPEG、WebP 图片与文本附件。");
        if (part.mediaType === "text/plain") {
          const text = Buffer.from(match[2], "base64").toString("utf8");
          await check(text, "attachment"); parts.push({ type: "text", text });
        } else parts.push({ type: "file", url: part.url, mediaType: part.mediaType });
      }
      // Browser tool results, reasoning, metadata and executable states are discarded.
    }
    if (parts.length) prepared.push({ id: message.id, role: message.role, parts });
  }
  if (!prepared.length || prepared.at(-1)?.role !== "user") throw new AgentHistoryError("请发送新的问题后重试。");
  return prepared;
}
