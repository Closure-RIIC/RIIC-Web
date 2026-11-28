/** Public model identities. Credentials and upstream configuration stay server-side. */
import type { AgentImageLimits } from "./agent-image-limits.ts";
export const AGENT_MODEL_IDS = ["deepseek", "glm", "gpt"] as const;
export type AgentModelId = typeof AGENT_MODEL_IDS[number];
export type AgentImageMode = "include" | "exclude";
export type AgentModelChoice = {
  id: AgentModelId; label: string; vision: boolean; available: boolean;
  imageLimits?: AgentImageLimits;
  reason?: "disabled" | "route_unconfigured" | "rate_missing" | "image_budget_missing";
};
export const AGENT_MODELS = {
  deepseek: { label: "DeepSeek Flash", provider: "riic-deepseek", model: "deepseek-v4.1-flash", vision: false, protocol: "chat" },
  glm: { label: "GLM-5.3 Flash", provider: "riic-glm", model: "glm-5.3-flash", vision: false, protocol: "chat" },
  gpt: { label: "GPT-6.1 Sol", provider: "riic-gpt", model: "gpt-6.1-sol", vision: true, protocol: "responses" },
} as const;
export function isAgentModelId(value: unknown): value is AgentModelId {
  return typeof value === "string" && AGENT_MODEL_IDS.some(id => id === value);
}
