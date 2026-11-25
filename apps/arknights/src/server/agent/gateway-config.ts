export function agentGatewayEnabled() { return process.env.AGENT_GATEWAY_ENABLED === "1"; }
export function gatewaySettings(selection?: { provider: string; model: string; gatewayModel?: string }) {
  const baseURL = process.env.AGENT_GATEWAY_URL?.trim() || "http://127.0.0.1:3425/v1";
  const url = new URL(baseURL);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.protocol !== "http:") throw new Error("Agent gateway must use loopback HTTP");
  const apiKey = process.env.AGENT_GATEWAY_KEY?.trim();
  if (!apiKey) throw new Error("Agent gateway key is not configured");
  return { baseURL, apiKey, model: selection ? selection.gatewayModel ?? `${selection.provider}/${selection.model}` : "group/riic-agent" };
}
