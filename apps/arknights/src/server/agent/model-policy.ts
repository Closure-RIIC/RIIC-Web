import { AGENT_MODEL_IDS, AGENT_MODELS, isAgentModelId, type AgentModelId } from "../../agent-models.ts";

export const MAX_AGENT_INPUT_TOKENS = 262_144;

export type AgentModelEntry = {
  id: AgentModelId; label: string; enabled: boolean;
  maxImages: number; maxImageBytes: number; maxImagePixels: number; imageTokensPerImage: number;
  imageBudgetMode?: "per-image" | "shared-input-limit";
};
export type AgentModelPolicy = { schema: 1; defaultModel: AgentModelId; models: AgentModelEntry[] };
export type AgentModelRoute = { provider: string; model: string };
export type AgentModelSelection = AgentModelEntry & {
  provider: string; model: string; vision: boolean; protocol: "chat" | "responses"; policyVersion: string;
  routes?: AgentModelRoute[];
  gatewayModel?: string;
};
export function hasAgentImageBudget(entry: AgentModelEntry): boolean {
  return entry.maxImages > 0 && (entry.imageBudgetMode === "shared-input-limit"
    || ((entry.imageBudgetMode === undefined || entry.imageBudgetMode === "per-image") && entry.imageTokensPerImage > 0));
}
export function defaultModelPolicy(): AgentModelPolicy {
  return { schema: 1, defaultModel: "deepseek", models: AGENT_MODEL_IDS.map(id => ({
    id, label: AGENT_MODELS[id].label, enabled: id !== "gpt", maxImages: AGENT_MODELS[id].vision ? 4 : 0,
    maxImageBytes: 8 * 1024 * 1024, maxImagePixels: 16_000_000,
    // Legacy per-image mode requires a verified bound; shared-input-limit is an explicit policy choice.
    imageTokensPerImage: 0,
  })) };
}
export function parseModelPolicy(value: unknown): AgentModelPolicy {
  if (!value || typeof value !== "object") throw new Error("Invalid model policy");
  const p = value as AgentModelPolicy;
  if (p.schema !== 1 || !isAgentModelId(p.defaultModel) || !Array.isArray(p.models) || p.models.length !== 3) throw new Error("Invalid model catalog");
  const remaining = new Set<string>(AGENT_MODEL_IDS);
  for (const row of p.models) {
    if (!row || !remaining.delete(row.id) || typeof row.label !== "string" || !row.label.trim() || row.label.length > 60 || [...row.label].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || typeof row.enabled !== "boolean") throw new Error("Invalid model entry");
    if (row.imageBudgetMode !== undefined && row.imageBudgetMode !== "per-image" && row.imageBudgetMode !== "shared-input-limit") throw new Error("Invalid image budget mode");
    for (const [key, min, max] of [["maxImages", 0, 4], ["maxImageBytes", 1024, 8 * 1024 * 1024], ["maxImagePixels", 1024, 16_000_000], ["imageTokensPerImage", 0, 60_000]] as const) {
      if (!Number.isSafeInteger(row[key]) || row[key] < min || row[key] > max) throw new Error("Invalid attachment limits");
    }
    if (!AGENT_MODELS[row.id].vision && (row.maxImages !== 0 || row.imageTokensPerImage !== 0 || row.imageBudgetMode === "shared-input-limit")) throw new Error("Text model cannot accept images");
  }
  if (!p.models.find(row => row.id === p.defaultModel)?.enabled) throw new Error("Default model must be enabled");
  return structuredClone(p);
}
