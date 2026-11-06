import "@tanstack/react-start/server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAccountedRun } from "./accounted-runtime.ts";
import { gatewaySettings } from "./gateway-config.ts";
import { recordGatewayRoute } from "./gateway-route.ts";
import { withAgentModelTimeout } from "./stream-policy.ts";
import type { CompiledFilter } from "./filter-policy.ts";
export { agentGatewayEnabled, gatewaySettings } from "./gateway-config.ts";

export function createGatewayRun(input: { runId: string; sessionId: string; requestId: string; userId: string; filterVersion: string; filter: CompiledFilter }) {
  const settings = gatewaySettings();
  const provider = createOpenAICompatible({ name: "riic-magpie", baseURL: settings.baseURL, apiKey: settings.apiKey,
    headers: { "X-Magpie-Session": input.sessionId, "User-Agent": "RIIC-Agent/1" } });
  return createAccountedRun({ ...input, model: withAgentModelTimeout(provider.chatModel(settings.model)), validateIdentity: true,
    identity(headers) {
      const provider = headers["x-magpie-provider"] ?? "";
      const model = headers["x-magpie-model"] ?? "";
      return { provider, model: model.startsWith(`${provider}/`) ? model.slice(provider.length + 1) : model,
        requestId: headers["x-request-id"] ?? headers["x-magpie-request-id"] };
    },
    trace: data => recordGatewayRoute({ ...data, runId: input.runId, sessionId: input.sessionId }),
  });
}
