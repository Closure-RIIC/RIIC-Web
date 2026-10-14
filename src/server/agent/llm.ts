import "@tanstack/react-start/server-only";

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";

import { agentLlmSettings, type AgentLlmSettings } from "./config.ts";
import { withAgentModelTimeout } from "./stream-policy.ts";

// Providers like DeepSeek and Zhipu expose two compatible surfaces:
// an OpenAI-style endpoint (/chat/completions) and an Anthropic-style
// endpoint (.../anthropic, /v1/messages) for Claude-protocol clients.
// Route the request by the configured base URL so users can paste either.
export function getAgentModel(settings: AgentLlmSettings = agentLlmSettings()) {
  if (!settings.configured) {
    throw new Error("AGENT_LLM_API_KEY 未配置，agent 聊天不可用。");
  }
  const isAnthropic = /\/anthropic(\/|$)/.test(settings.baseURL);
  if (isAnthropic) {
    // @ai-sdk/anthropic appends "/messages" itself, so the base URL must
    // already contain the version segment (…/anthropic/v1).
    const baseURL = /\/v\d+$/.test(settings.baseURL)
      ? settings.baseURL
      : `${settings.baseURL.replace(/\/+$/, "")}/v1`;
    return withAgentModelTimeout(createAnthropic({ baseURL, apiKey: settings.apiKey })(settings.model));
  }
  const provider = createOpenAICompatible({
    name: `riic-agent-${settings.provider}`,
    baseURL: settings.baseURL,
    apiKey: settings.apiKey,
  });
  return withAgentModelTimeout(provider.chatModel(settings.model));
}
