import { AGENT_MODEL_IDS, AGENT_MODELS, isAgentModelId, type AgentModelId } from "../../agent-models.ts";
import { agentRequestBodyLimit, DEFAULT_AGENT_IMAGE_LIMITS, DEFAULT_IMAGE_TOKEN_RESERVATION } from "../../agent-image-limits.ts";

export type AgentModelEntry = {
  id: AgentModelId; label: string; enabled: boolean;
  maxImages: number; maxImageBytes: number; maxImagePixels: number; imageTokensPerImage: number;
};
export type AgentModelPolicy = { schema: 1; defaultModel: AgentModelId; models: AgentModelEntry[] };
export type AgentModelRoute = { provider: string; model: string };
export type AgentModelSelection = AgentModelEntry & {
  provider: string; model: string; vision: boolean; protocol: "chat" | "responses"; policyVersion: string;
  routes?: AgentModelRoute[];
  gatewayModel?: string;
};
export function hasAgentImageBudget(entry: AgentModelEntry): boolean {
  return entry.maxImages > 0 && Number.isSafeInteger(entry.imageTokensPerImage) && entry.imageTokensPerImage > 0;
}
export function defaultModelPolicy(): AgentModelPolicy {
  return { schema: 1, defaultModel: "deepseek", models: AGENT_MODEL_IDS.map(id => ({
    ...DEFAULT_AGENT_IMAGE_LIMITS,
    id, label: AGENT_MODELS[id].label, enabled: id !== "gpt", maxImages: AGENT_MODELS[id].vision ? DEFAULT_AGENT_IMAGE_LIMITS.maxImages : 0,
    imageTokensPerImage: AGENT_MODELS[id].vision ? DEFAULT_IMAGE_TOKEN_RESERVATION : 0,
  })) };
}
export function parseModelPolicy(value: unknown): AgentModelPolicy {
  if (!value || typeof value !== "object") throw new Error("Invalid model policy");
  // Normalize copies on read, including old active/draft/rollback snapshots.
  // Stored snapshots and budgets of already-started calls are never rewritten.
  const p = structuredClone(value) as AgentModelPolicy;
  if (p.schema !== 1 || !isAgentModelId(p.defaultModel) || !Array.isArray(p.models) || p.models.length !== 3) throw new Error("Invalid model catalog");
  const remaining = new Set<string>(AGENT_MODEL_IDS);
  for (const row of p.models) {
    if (!row || !remaining.delete(row.id) || typeof row.label !== "string" || !row.label.trim() || row.label.length > 60 || [...row.label].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || typeof row.enabled !== "boolean") throw new Error("Invalid model entry");
    const legacy = row as AgentModelEntry & { imageBudgetMode?: unknown };
    if (legacy.imageBudgetMode !== undefined && legacy.imageBudgetMode !== "per-image" && legacy.imageBudgetMode !== "shared-input-limit") throw new Error("Invalid image budget mode");
    for (const [key, min] of [["maxImages", 0], ["maxImageBytes", 1024], ["maxImagePixels", 1024], ["imageTokensPerImage", 0]] as const) {
      if (!Number.isSafeInteger(row[key]) || row[key] < min) throw new Error("Invalid attachment limits");
    }
    if (!AGENT_MODELS[row.id].vision && (row.maxImages !== 0 || row.imageTokensPerImage !== 0 || legacy.imageBudgetMode === "shared-input-limit")) throw new Error("Text model cannot accept images");
    // The old shared-mode per-image field was unused, so it is not a trusted
    // reservation. Start with the explicit new default and let admins adjust it.
    if (legacy.imageBudgetMode === "shared-input-limit") row.imageTokensPerImage = DEFAULT_IMAGE_TOKEN_RESERVATION;
    delete legacy.imageBudgetMode;
    agentRequestBodyLimit(row);
  }
  if (!p.models.find(row => row.id === p.defaultModel)?.enabled) throw new Error("Default model must be enabled");
  return p;
}
