import type { UIMessage } from "ai";
import { createInlineThinkingFilter, INTERNAL_ANSWER_MARKERS } from "../../agent-answer.ts";
import { hasAgentImageBudget, type AgentModelSelection } from "./model-policy.ts";
import { AGENT_TEXT_ATTACHMENT_BYTES, AGENT_TEXT_ATTACHMENT_COUNT, AGENT_TEXT_PAYLOAD_BYTES, agentTextPayloadBytes, imageDataUrlLimit } from "../../agent-image-limits.ts";

export class AgentHistoryError extends Error {}

/** Prepare untrusted browser history for the model, never execute historical tools. */
export async function prepareAgentHistory(messages: UIMessage[], check: (text: string, stage: string) => Promise<void>, options?: { selection?: AgentModelSelection; images?: unknown }) {
  if (options?.images !== undefined && options.images !== "include" && options.images !== "exclude") throw new AgentHistoryError("图片上下文选项无效。");
  if (!Array.isArray(messages) || !messages.length || messages.length > 200) throw new AgentHistoryError("对话过长，请新建对话或缩小附件。");
  let imageCount = 0;
  for (const message of messages) {
    if (!message || !["user", "assistant"].includes(message.role) || !Array.isArray(message.parts)) throw new AgentHistoryError("对话格式无效。");
    for (const part of message.parts) {
      if (!part || typeof part.type !== "string") throw new AgentHistoryError("对话格式无效。");
      if (part.type === "file" && typeof part.mediaType !== "string") throw new AgentHistoryError("附件格式无效。");
      if (message.role === "user" && part.type === "file" && part.mediaType.startsWith("image/") && options?.images !== "exclude") imageCount++;
    }
  }
  const selection = options?.selection;
  if (imageCount && (!selection?.vision || !hasAgentImageBudget(selection))) throw new AgentHistoryError("当前模型不支持图片，请选择已配置的识图模型，或仅携带文字继续。");
  // Count the whole conversation before any image decoding or filtering work.
  if (imageCount > (selection?.maxImages ?? 0)) throw new AgentHistoryError("本轮图片超过模型限制，请减少图片或新建对话。");
  if (agentTextPayloadBytes(messages) > AGENT_TEXT_PAYLOAD_BYTES) throw new AgentHistoryError("对话过长，请新建对话或缩小文本附件。");
  const prepared: UIMessage[] = [];
  let textAttachments = 0;
  for (const message of messages) {
    if (!message || !["user", "assistant"].includes(message.role) || !Array.isArray(message.parts)) throw new AgentHistoryError("对话格式无效。");
    const parts: UIMessage["parts"] = [];
    let stripThinking = createInlineThinkingFilter();
    // Preserve only the final answer after the last historical tool, not narration.
    const lastTool = message.role === "assistant" ? message.parts.reduce((last, part, index) => part && typeof part.type === "string" && (part.type.startsWith("tool-") || part.type === "dynamic-tool") ? index : last, -1) : -1;
    for (const [index, part] of message.parts.entries()) {
      if (!part || typeof part.type !== "string") throw new AgentHistoryError("对话格式无效。");
      if (part.type === "step-start" || part.type.startsWith("tool-") || part.type === "dynamic-tool") {
        stripThinking = createInlineThinkingFilter();
      }
      if (part.type === "text") {
        if (typeof part.text !== "string") throw new AgentHistoryError("对话格式无效。");
        if (message.role === "assistant" && index <= lastTool) continue;
        const text = message.role === "assistant" ? stripThinking(part.text) : part.text;
        if (message.role === "assistant" && (!text.trim() || INTERNAL_ANSWER_MARKERS.test(text))) continue;
        await check(text, "input");
        parts.push({ type: "text", text });
      } else if (part.type === "file" && message.role === "user") {
        if (part.mediaType.startsWith("image/") && options?.images === "exclude") continue;
        const textAttachment = part.mediaType === "text/plain" || part.mediaType === "text/markdown";
        if (!textAttachment && !["image/png", "image/jpeg", "image/webp"].includes(part.mediaType)) throw new AgentHistoryError("仅支持 PNG、JPEG、WebP 图片与文本附件。");
        const byteLimit = textAttachment ? AGENT_TEXT_ATTACHMENT_BYTES : (selection?.maxImageBytes ?? 0);
        if (typeof part.url !== "string" || part.url.length > imageDataUrlLimit(byteLimit)) throw new AgentHistoryError("附件过大，请压缩后重试。");
        const match = /^data:(image\/(?:png|jpeg|webp)|text\/(?:plain|markdown));base64,([A-Za-z0-9+/]*={0,2})$/.exec(part.url);
        if (!match || match[1] !== part.mediaType) throw new AgentHistoryError("仅支持 PNG、JPEG、WebP 图片与文本附件。");
        if (textAttachment) {
          if (++textAttachments > AGENT_TEXT_ATTACHMENT_COUNT || Buffer.byteLength(match[2], "base64") > AGENT_TEXT_ATTACHMENT_BYTES) throw new AgentHistoryError("文本附件过多或过大，请压缩后重试。");
          const text = Buffer.from(match[2], "base64").toString("utf8");
          await check(text, "attachment"); parts.push({ type: "text", text });
        } else {
          if (options?.images === "exclude") continue;
          const selection = options?.selection;
          if (!selection?.vision || !hasAgentImageBudget(selection)) throw new AgentHistoryError("当前模型不支持图片，请选择已配置的识图模型，或仅携带文字继续。");
          const data = Buffer.from(match[2], "base64");
          if (!data.length || data.length > selection.maxImageBytes || data.toString("base64") !== match[2]) throw new AgentHistoryError("图片数据无效或超过大小限制。");
          try {
            const { default: sharp } = await import("sharp");
            const image = sharp(data, { failOn: "error", limitInputPixels: selection.maxImagePixels, animated: false });
            const metadata = await image.metadata();
            if (`image/${metadata.format}` !== part.mediaType || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) throw new Error("Invalid image format");
            // Decode before upstream, strip metadata, and keep a fixed maximum image dimension.
            const normalized = await image.rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).png().toBuffer();
            if (normalized.length > selection.maxImageBytes) throw new Error("Image exceeds normalized byte limit");
            parts.push({ type: "file", url: `data:image/png;base64,${normalized.toString("base64")}`, mediaType: "image/png" });
          } catch { throw new AgentHistoryError("图片无法读取或尺寸过大，请上传有效的 PNG、JPEG、WebP 静态图片。"); }
        }
      }
      // Browser tool results, reasoning, metadata and executable states are discarded.
    }
    if (parts.length) prepared.push({ id: message.id, role: message.role, parts });
  }
  if (!prepared.length || prepared.at(-1)?.role !== "user") throw new AgentHistoryError("请发送新的问题后重试。");
  return prepared;
}
