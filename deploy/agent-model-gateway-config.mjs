// Pure deployment planning: never read secrets, write files or contact an upstream here.
import { withSupplementalModelSource } from "./agent-model-source.mjs";
const entries = [
  { id: "deepseek", provider: "riic-deepseek", name: "RIIC DeepSeek", protocol: "chat" },
  { id: "glm", provider: "riic-glm", name: "RIIC GLM", protocol: "chat" },
  { id: "gpt", provider: "riic-gpt", name: "RIIC GPT", protocol: "responses" },
];
const value = input => typeof input === "string" ? input.trim() : "";
const managedProviders = new Set([...entries.map(entry => entry.provider), "riic-deepseek-official"]);

export function buildAgentGatewayConfig(previous, source) {
  if (!previous || typeof previous !== "object" || Array.isArray(previous)
    || (previous.providers !== undefined && !Array.isArray(previous.providers))
    || (previous.groups !== undefined && !Array.isArray(previous.groups))) throw new Error("Invalid gateway provider configuration");
  let config = globalThis.structuredClone(previous);
  config.providers ??= [];
  config.groups ??= [];
  const models = []; const routes = []; const modelEnvironment = {};
  const defaultProvider = value(source.AGENT_LLM_PROVIDER).toLowerCase() || "deepseek";
  for (const entry of entries) {
    const matches = config.providers.filter(provider => provider.id === entry.provider);
    if (matches.length > 1) throw new Error(`Duplicate managed provider: ${entry.provider}`);
    const old = matches[0];
    const prefix = `AGENT_LLM_${entry.id.toUpperCase()}_`;
    // A provider never borrows another provider's key, including GPT.
    const setting = name => value(source[`${prefix}${name}`])
      || (entry.id === defaultProvider && entry.id !== "gpt" ? value(source[`AGENT_LLM_${name}`]) : "");
    const key = setting("API_KEY") || value(old?.key);
    const base = setting("BASE_URL") || value(old?.[entry.protocol]);
    const model = setting("MODEL") || (old?.models?.length === 1 ? value(old.models[0]) : "");
    if (!key || !base || !model) continue;
    let url;
    try { url = new globalThis.URL(base); } catch { throw new Error(`Invalid upstream URL for ${entry.id}`); }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(`Invalid upstream URL for ${entry.id}`);
    if (url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error(`Upstream URL must use HTTPS for ${entry.id}`);
    if (/\s|\//.test(model)) throw new Error(`Invalid upstream model for ${entry.id}`);
    const provider = { maxConcurrency: 4, maxRPM: 60, queueLimit: 8, queueWait: 15,
      ...old, id: entry.provider, name: old?.name || entry.name, key, models: [model], [entry.protocol]: base.replace(/\/+$/, "") };
    // Only the managed group may fall back; explicit GLM/GPT routes stay exact.
    delete provider.fallback;
    if (entry.id === "gpt") {
      delete provider.chat; delete provider.anthropic; delete provider.gemini;
      provider.baseAPI = "responses";
    }
    if (old) config.providers[config.providers.indexOf(old)] = provider;
    else config.providers.push(provider);
    if (provider.off === true) continue;
    models.push(entry.id); routes.push(`${entry.provider}/${model}`);
    modelEnvironment[`${prefix}MODEL`] = model;
  }
  if (!models.includes("deepseek")) throw new Error("Complete enabled DeepSeek upstream settings are required");
  const groups = config.groups.filter(group => group.id === "riic-agent");
  if (groups.length > 1) throw new Error("Duplicate managed group: riic-agent");
  const textRoutes = routes.filter(route => !route.startsWith("riic-gpt/"));
  // This group is deployment-owned. Rebuild it so old match/rules, disabled
  // members, reasoning overrides and future routing fields cannot change the
  // published DS -> GLM -> optional official policy. Only its display name is
  // user metadata; unrelated groups remain untouched.
  const group = { id: "riic-agent", name: value(groups[0]?.name) || "RIIC Agent",
    members: textRoutes, routing: "order", affinity: "turn", firstToken: 10, patience: -1 };
  if (groups.length) config.groups[config.groups.indexOf(groups[0])] = group;
  else config.groups.push(group);
  for (const provider of config.providers) if (textRoutes.some(route => route.startsWith(`${provider.id}/`))) provider.queueWait = 1;
  const officialRows = config.providers.filter(provider => provider.id === "riic-deepseek-official");
  if (officialRows.length > 1) throw new Error("Duplicate supplemental provider");
  const official = officialRows[0];
  const officialSource = {
    AGENT_LLM_DEEPSEEK_OFFICIAL_API_KEY: value(source.AGENT_LLM_DEEPSEEK_OFFICIAL_API_KEY) || value(official?.key),
    AGENT_LLM_DEEPSEEK_OFFICIAL_BASE_URL: value(source.AGENT_LLM_DEEPSEEK_OFFICIAL_BASE_URL) || value(official?.chat),
    AGENT_LLM_DEEPSEEK_OFFICIAL_MODEL: value(source.AGENT_LLM_DEEPSEEK_OFFICIAL_MODEL) || (official?.models?.length === 1 ? value(official.models[0]) : ""),
  };
  const officialEnabled = source.AGENT_GATEWAY_OFFICIAL_FALLBACK_ENABLED === "1"
    && official?.off !== true && Object.values(officialSource).every(Boolean);
  if (officialEnabled) {
    config = withSupplementalModelSource(config, officialSource);
    routes.push(`riic-deepseek-official/${officialSource.AGENT_LLM_DEEPSEEK_OFFICIAL_MODEL}`);
    modelEnvironment.AGENT_LLM_DEEPSEEK_OFFICIAL_MODEL = officialSource.AGENT_LLM_DEEPSEEK_OFFICIAL_MODEL;
  }
  return { config, models, routes, modelEnvironment, officialEnabled };
}

export function agentCallerModels(previous, routes) {
  if (!Array.isArray(routes) || !routes.length) throw new Error("At least one explicit agent route is required");
  if (previous !== undefined && !Array.isArray(previous)) throw new Error("Invalid application key models");
  const unrelated = (previous ?? []).filter(model => typeof model === "string"
    && model !== "group/riic-agent" && !managedProviders.has(model.split("/")[0]));
  return [...new Set([...unrelated, "group/riic-agent", ...routes])];
}

export function updateAgentGatewayEnv(text, changes) {
  const pending = new Map(Object.entries(changes));
  const lines = text.split(/\r?\n/).filter((line, index, all) => index !== all.length - 1 || line !== "");
  const seen = new Set();
  const output = lines.map(line => {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (!match || !pending.has(match[1])) return line;
    if (seen.has(match[1])) throw new Error(`Duplicate managed environment setting: ${match[1]}`);
    seen.add(match[1]);
    return `${match[1]}=${JSON.stringify(pending.get(match[1]))}`;
  });
  for (const [name, setting] of pending) if (!seen.has(name)) output.push(`${name}=${JSON.stringify(setting)}`);
  return output.join("\n") + "\n";
}
