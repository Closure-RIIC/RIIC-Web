export const AGENT_PLAN_REFERENCE_LIMIT = 8;
export const AGENT_PLAN_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function agentPlanReferences(messages: readonly { parts: readonly unknown[] }[]): string[] {
  const ids: string[] = [];
  for (const message of messages) for (const part of message.parts) {
    if (!part || typeof part !== "object") continue;
    const tool = part as Record<string, unknown>;
    if (tool.type !== "tool-solve_schedule" || tool.state !== "output-available" || !tool.output || typeof tool.output !== "object") continue;
    const output = tool.output as Record<string, unknown>;
    if (output.solved !== true || typeof output.artifactId !== "string" || !AGENT_PLAN_ID.test(output.artifactId)) continue;
    const old = ids.indexOf(output.artifactId);
    if (old >= 0) ids.splice(old, 1);
    ids.push(output.artifactId);
  }
  return ids.slice(-AGENT_PLAN_REFERENCE_LIMIT);
}
