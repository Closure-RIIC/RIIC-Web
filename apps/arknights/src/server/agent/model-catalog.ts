import "@tanstack/react-start/server-only";
import { activeAgentPolicies } from "../billing/agent-accounting.ts";
import { AGENT_MODELS, isAgentModelId, type AgentModelChoice, type AgentModelId } from "../../agent-models.ts";
import { agentLlmSettings } from "./config.ts";
import { hasAgentImageBudget, type AgentModelPolicy, type AgentModelSelection, type AgentModelRoute } from "./model-policy.ts";
import type { RatePolicy } from "../billing/rate-policy.ts";

export async function activeAgentModels() {
  return (await activeAgentPolicies()).models;
}
/** Match the deployed text group; entry enablement controls the public selector. */
export function configuredAgentRoutes(id: AgentModelId): AgentModelRoute[] {
  const ready = new Set((process.env.AGENT_GATEWAY_MODELS ?? "deepseek,glm").split(",").map(value => value.trim()));
  const route = (key: AgentModelId) => ({ provider: AGENT_MODELS[key].provider, model: agentLlmSettings(key).model });
  if (!ready.has(id)) return [];
  if (id !== "deepseek") return [route(id)];
  return [route("deepseek"), ...(ready.has("glm") ? [route("glm")] : []),
    ...(process.env.AGENT_GATEWAY_OFFICIAL_FALLBACK_ENABLED === "1" ? [{ provider: "riic-deepseek-official", model: process.env.AGENT_LLM_DEEPSEEK_OFFICIAL_MODEL?.trim() || "deepseek-flash" }] : [])];
}
export function configuredAgentChoices(policy: AgentModelPolicy, rates: RatePolicy): AgentModelChoice[] {
  return policy.models.map(entry => {
    const definition = AGENT_MODELS[entry.id];
    const routes = configuredAgentRoutes(entry.id);
    const priced = routes.every(route => rates.models.some(rate => rate.provider === route.provider && rate.model === route.model));
    const reason = !entry.enabled ? "disabled" : !routes.length ? "route_unconfigured"
      : !priced ? "rate_missing"
      : definition.vision && !hasAgentImageBudget(entry) ? "image_budget_missing" : undefined;
    return { id: entry.id, label: entry.label, vision: definition.vision, available: !reason, ...(reason ? { reason } : {}),
      ...(definition.vision ? { imageLimits: { maxImages: entry.maxImages, maxImageBytes: entry.maxImageBytes, maxImagePixels: entry.maxImagePixels } } : {}) };
  });
}
export function selectAgentModel(value: unknown, catalog: { id: string; policy: AgentModelPolicy }, rates: RatePolicy): AgentModelSelection {
  const id = value === undefined || value === null ? catalog.policy.defaultModel : value;
  if (!isAgentModelId(id)) throw new Error("请选择可用的模型。");
  if (!configuredAgentChoices(catalog.policy, rates).find(choice => choice.id === id)?.available) throw new Error("所选模型暂不可用，请选择其他模型或联系管理员完成配置。");
  return { ...catalog.policy.models.find(row => row.id === id)!, provider: AGENT_MODELS[id].provider,
    model: agentLlmSettings(id).model, vision: AGENT_MODELS[id].vision, protocol: AGENT_MODELS[id].protocol, policyVersion: catalog.id,
    routes: configuredAgentRoutes(id), gatewayModel: id === "deepseek" ? "group/riic-agent" : `${AGENT_MODELS[id].provider}/${agentLlmSettings(id).model}` };
}
