import type { AgentModelPolicy } from "./server/agent/model-policy.ts";
import type { RatePolicy } from "./server/billing/rate-policy.ts";

export type AgentModelSettingsPayload = { schema: 1; rates: RatePolicy; models: AgentModelPolicy };
export type AgentModelSettingsVersion = {
  id: string; version: number; status: "draft" | "active" | "retired";
  payload: AgentModelSettingsPayload; created_at: string;
  ratesId: string | null; modelsId: string | null;
};
export type ModelSettingsData = {
  active: { id: string; ratesId: string; modelsId: string; payload: AgentModelSettingsPayload } | null;
  initialPayload: AgentModelSettingsPayload;
  expectedActive: { ratesId: string | null; modelsId: string | null };
  versions: AgentModelSettingsVersion[];
};
export type AgentModelSettingsChange = {
  action: "draft" | "publish" | "rollback"; reason: string;
  expectedActive: { ratesId: string | null; modelsId: string | null };
  payload?: AgentModelSettingsPayload; id?: string;
};
