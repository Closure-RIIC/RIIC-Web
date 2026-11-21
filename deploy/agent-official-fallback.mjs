// Pure configuration transform. Apply only after publishing the matching rate
// policy and draining runs whose saved policy does not contain the new model.
export function withOfficialDeepSeekFallback(config, source) {
  const key = source.AGENT_LLM_DEEPSEEK_OFFICIAL_API_KEY?.trim();
  const baseURL = source.AGENT_LLM_DEEPSEEK_OFFICIAL_BASE_URL?.trim().replace(/\/+$/, "");
  const model = source.AGENT_LLM_DEEPSEEK_OFFICIAL_MODEL?.trim();
  if (!key || !["https://api.deepseek.com", "https://api.deepseek.com/v1"].includes(baseURL) || model !== "deepseek-flash") {
    throw new Error("Official DeepSeek settings incomplete or unexpected");
  }
  const next = globalThis.structuredClone(config);
  const group = next.groups?.find(row => row.id === "riic-agent");
  const primary = ["riic-deepseek/deepseek-v4.1-flash", "riic-glm/glm-5.3-flash"];
  const fallback = "riic-deepseek-official/deepseek-flash";
  if (!group || ![2, 3].includes(group.members?.length) || primary.some((member, i) => group.members[i] !== member) ||
    (group.members.length === 3 && group.members[2] !== fallback) ||
    primary.some(member => next.providers.filter(row => row.id === member.split("/")[0]).length !== 1)) {
    throw new Error("Unexpected existing Agent routing; inspect before changing it");
  }
  const official = next.providers.filter(row => row.id === "riic-deepseek-official");
  if (official.length > 1) throw new Error("Duplicate official DeepSeek provider");
  const provider = { id: "riic-deepseek-official", name: "RIIC DeepSeek Official", key, chat: baseURL,
    models: [model], maxConcurrency: 4, maxRPM: 60, queueLimit: 8, queueWait: 1 };
  if (official.length) next.providers[next.providers.indexOf(official[0])] = provider;
  else next.providers.push(provider);
  for (const row of next.providers) if (["riic-deepseek", "riic-glm"].includes(row.id)) row.queueWait = 1;
  // Magpie v0.1.1203 emits held response headers at 15 seconds per candidate.
  // Switch before that point to preserve the actual billing identity. Disable
  // group replanning after exhausting members; never replay partial content.
  Object.assign(group, { members: [...primary, fallback], routing: "order", affinity: "turn", firstToken: 10, patience: -1 });
  return next;
}
