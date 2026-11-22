import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { hasAgentImageBudget, MAX_AGENT_INPUT_TOKENS, type AgentModelSelection } from "./model-policy.ts";
import type { ModelCallBudget } from "../billing/rate-policy.ts";

/** Reserve text separately from image transport bytes, using the selected budget policy. */
export function modelCallBudget(selection: AgentModelSelection, params: Pick<LanguageModelV4CallOptions, "prompt" | "tools" | "maxOutputTokens">): ModelCallBudget {
  let images = 0;
  const prompt = params.prompt.map(message => ({ ...message,
    content: Array.isArray(message.content) ? message.content.map(part => {
      if (part.type !== "file") return part;
      if (!part.mediaType.startsWith("image/")) throw new Error("Unsupported model attachment");
      images++;
      return { type: "file", mediaType: part.mediaType, image: "reserved-separately" };
    }) : message.content,
  }));
  // Only real message file parts are replaced. Arbitrary JSON in tool results
  // and schemas must retain its text budget even if it contains a type=file key.
  const serialized = JSON.stringify({ prompt, tools: params.tools });
  const textTokens = Buffer.byteLength(serialized) + 8192;
  if (textTokens > MAX_AGENT_INPUT_TOKENS) throw new Error("本轮上下文过长，请减少附件或新建对话。");
  if (images && (!selection.vision || images > selection.maxImages || !hasAgentImageBudget(selection))) throw new Error("Image budget is not configured");
  // The shared limit reserves the whole input allowance, not a claimed supplier image-token bound.
  // Actual upstream usage is still checked against this reservation during settlement.
  const inputTokens = images && selection.imageBudgetMode === "shared-input-limit" ? MAX_AGENT_INPUT_TOKENS
    : textTokens + images * selection.imageTokensPerImage;
  if (inputTokens > MAX_AGENT_INPUT_TOKENS) throw new Error("本轮上下文过长，请减少附件或新建对话。");
  return { provider: selection.provider, model: selection.model, ...(selection.routes ? { routes: selection.routes } : {}), inputTokens, maxOutputTokens: params.maxOutputTokens ?? 2048 };
}
