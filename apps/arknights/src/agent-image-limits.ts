import type { UIMessage } from "ai";

/** Public upload policy, shared by the composer and server admission checks. */
export type AgentImageLimits = { maxImages: number; maxImageBytes: number; maxImagePixels: number };
export const DEFAULT_AGENT_IMAGE_LIMITS: AgentImageLimits = {
  maxImages: 4, maxImageBytes: 8 * 1024 * 1024, maxImagePixels: 16_000_000,
};
export const DEFAULT_IMAGE_TOKEN_RESERVATION = 8192;
export const AGENT_TEXT_PAYLOAD_BYTES = 16 * 1024 * 1024;
export const AGENT_TEXT_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const AGENT_TEXT_ATTACHMENT_COUNT = 4;

export function imageDataUrlLimit(bytes: number): number {
  return 4 * Math.ceil(bytes / 3) + 64;
}

/** Allow configured images, base64 expansion and JSON framing in addition to text. */
export function agentRequestBodyLimit(limits?: AgentImageLimits): number {
  const total = AGENT_TEXT_PAYLOAD_BYTES + (limits ? limits.maxImages * (imageDataUrlLimit(limits.maxImageBytes) + 1024) : 0);
  if (!Number.isSafeInteger(total) || total < AGENT_TEXT_PAYLOAD_BYTES) throw new Error("Invalid attachment transport limits");
  return total;
}

/** Image bytes have their own allowance; text, tool history and metadata do not. */
export function agentTextPayloadBytes(messages: UIMessage[]): number {
  return new TextEncoder().encode(JSON.stringify(messages.map(message => ({ ...message,
    parts: message.parts.map(part => part.type === "file" && part.mediaType?.startsWith("image/") ? { ...part, url: "" } : part),
  })))).byteLength;
}
