import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { hasAgentImageBudget, type AgentModelSelection } from "./model-policy.ts";
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
  if (images && (!selection.vision || images > selection.maxImages || !hasAgentImageBudget(selection))) throw new Error("Image budget is not configured");
  const inputTokens = textTokens + images * selection.imageTokensPerImage;
  if (!Number.isSafeInteger(inputTokens)) throw new Error("Invalid model token reservation");
  return { provider: selection.provider, model: selection.model, ...(selection.routes ? { routes: selection.routes } : {}), inputTokens, maxOutputTokens: params.maxOutputTokens ?? 2048 };
}
