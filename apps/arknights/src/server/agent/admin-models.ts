import { SUPPLEMENTAL_MODEL_ID, SUPPLEMENTAL_MODEL_PROVIDER } from "../billing/rate-policy.ts";

type Version = { kind: string; status: string; payload: unknown };
const catalog = [
  { provider: "riic-deepseek", model: "deepseek-v4.1-flash", order: 1, role: "primary" },
  { provider: "riic-glm", model: "glm-5.3-flash", order: 2, role: "secondary" },
  { provider: SUPPLEMENTAL_MODEL_PROVIDER, model: SUPPLEMENTAL_MODEL_ID, order: 3, role: "reserve" },
] as const;

// A billing policy identifies priced models, not the gateway's loaded routes.
export function adminModelDirectory(versions: Version[]) {
  const active = versions.find(row => row.kind === "rates" && row.status === "active");
  const payload = active?.payload as { models?: Array<{ provider?: string; model?: string }> } | undefined;
  const rates = Array.isArray(payload?.models) ? payload.models : [];
  return catalog.map(row => ({ ...row,
    rateConfigured: rates.some(rate => rate.provider === row.provider && rate.model === row.model),
    routeConfigured: null,
    observedAt: null,
  }));
}
