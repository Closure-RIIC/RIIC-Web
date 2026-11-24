// Pure configuration transform. Apply only after publishing the matching rate
// policy and draining runs whose saved policy does not contain the new model.
export function withSupplementalModelSource(config, source) {
  const key = source.AGENT_LLM_DEEPSEEK_OFFICIAL_API_KEY?.trim();
  const baseURL = source.AGENT_LLM_DEEPSEEK_OFFICIAL_BASE_URL?.trim().replace(/\/+$/, "");
  const model = source.AGENT_LLM_DEEPSEEK_OFFICIAL_MODEL?.trim();
  if (!key || !["https://api.deepseek.com", "https://api.deepseek.com/v1"].includes(baseURL) || model !== "deepseek-flash") {
    throw new Error("Supplemental model settings incomplete or unexpected");
  }
  const next = globalThis.structuredClone(config);
  const group = next.groups?.find(row => row.id === "riic-agent");
  const member = "riic-deepseek-official/deepseek-flash";
  const primary = group?.members?.filter(route => route !== member) ?? [];
  if (!group || !Array.isArray(group.members) || ![1, 2].includes(primary.length)
    || !primary[0].startsWith("riic-deepseek/")
    || (primary.length === 2 && !primary[1].startsWith("riic-glm/"))
    || group.members.some((route, index) => route !== (primary[index] ?? member))
    || primary.some(route => next.providers.filter(row => row.id === route.split("/")[0]).length !== 1)) {
    throw new Error("Unexpected existing Agent routing; inspect before changing it");
  }
  const existing = next.providers.filter(row => row.id === "riic-deepseek-official");
  if (existing.length > 1) throw new Error("Duplicate supplemental provider");
  const provider = { maxConcurrency: 4, maxRPM: 60, queueLimit: 8, ...existing[0],
    id: "riic-deepseek-official", name: existing[0]?.name || "DeepSeek 官网备用", key, chat: baseURL,
    models: [model], queueWait: 1 };
  delete provider.fallback; delete provider.responses; delete provider.anthropic; delete provider.gemini;
  provider.baseAPI = "chat";
  if (existing.length) next.providers[next.providers.indexOf(existing[0])] = provider;
  else next.providers.push(provider);
  for (const row of next.providers) if (["riic-deepseek", "riic-glm"].includes(row.id)) row.queueWait = 1;
  // Magpie v0.1.1203 emits held response headers at 15 seconds per candidate.
  // Switch before that point to preserve the actual billing identity. Disable
  // group replanning after exhausting members; never replay partial content.
  Object.assign(group, { members: [...primary, member], routing: "order", affinity: "turn", firstToken: 10, patience: -1 });
  return next;
}
