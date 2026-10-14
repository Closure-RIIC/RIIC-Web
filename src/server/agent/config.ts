import "@tanstack/react-start/server-only";

export type AgentLlmProviderId = "deepseek" | "glm";

export interface AgentLlmSettings {
  provider: AgentLlmProviderId;
  baseURL: string;
  model: string;
  apiKey: string;
  configured: boolean;
}

const PROVIDER_PRESETS: Record<AgentLlmProviderId, { baseURL: string; model: string }> = {
  deepseek: { baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  glm: { baseURL: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4.6" },
};

function normalizeProvider(value: string | undefined): AgentLlmProviderId {
  const trimmed = value?.trim().toLowerCase();
  return trimmed === "glm" ? "glm" : "deepseek";
}

export function agentLlmSettings(selection?: AgentLlmProviderId): AgentLlmSettings {
  const defaultProvider = normalizeProvider(process.env.AGENT_LLM_PROVIDER);
  const provider = selection ?? defaultProvider;
  const preset = PROVIDER_PRESETS[provider];
  const prefix = `AGENT_LLM_${provider.toUpperCase()}_`;
  // Legacy single-model settings apply only to the default provider. Never
  // send one provider's credential to a different provider's endpoint.
  const legacy = (key: string) => provider === defaultProvider ? process.env[`AGENT_LLM_${key}`]?.trim() : undefined;
  const baseURL = process.env[`${prefix}BASE_URL`]?.trim() || legacy("BASE_URL") || preset.baseURL;
  const model = process.env[`${prefix}MODEL`]?.trim() || legacy("MODEL") || preset.model;
  const apiKey = process.env[`${prefix}API_KEY`]?.trim() || legacy("API_KEY") || "";
  return { provider, baseURL, model, apiKey, configured: apiKey.length > 0 };
}

export function agentModelChoices() {
  return (["deepseek", "glm"] as const).map(agentLlmSettings)
    .filter((settings) => settings.configured)
    .map(({ provider, model }) => ({ id: provider, label: model }));
}

export function agentKnowledgeDir(): string {
  // 知识库（RIIC-knowledge）是独立的外部仓库，不随本仓库分发；
  // 克隆后把本地路径配置到 AGENT_KB_DIR（见 .env.example 与 docs/AGENT_EXPLORATION.md）。
  return process.env.AGENT_KB_DIR?.trim() ?? "";
}
