export type RestrictedFeature = "agent" | "billing";
export type FeatureAccessMode = "admin" | "public" | "disabled";
export type FeatureAccess = Record<RestrictedFeature, boolean>;

export const NO_FEATURE_ACCESS: FeatureAccess = { agent: false, billing: false };

// Unknown or missing configuration must never accidentally publish a beta.
export function featureAccessMode(feature: RestrictedFeature, env: Record<string, string | undefined> = process.env): FeatureAccessMode {
  const value = env[feature === "agent" ? "AGENT_ACCESS_MODE" : "BILLING_ACCESS_MODE"]?.trim();
  return value === "public" || value === "disabled" ? value : "admin";
}

export function canAccessFeature(mode: FeatureAccessMode, isAdmin: boolean): boolean {
  return mode === "public" || (mode === "admin" && isAdmin);
}
