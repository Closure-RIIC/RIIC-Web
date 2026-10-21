export interface HealthDemand {
  orundumPlan?: "none" | "planned";
  outputPriority?: "maximize" | "balanced" | "low-maintenance";
  resourceFocus?: "balanced" | "lmd" | "experience";
  layoutChange?: "keep" | "recipes-only" | "rebuild-ok";
  twoPowerPlants?: "accept" | "avoid";
  loginCadence?: "twice-daily" | "daily" | "irregular";
}

export const HEALTH_DEMAND_OPTIONS = {
  orundumPlan: ["none", "planned"],
  outputPriority: ["maximize", "balanced", "low-maintenance"],
  resourceFocus: ["balanced", "lmd", "experience"],
  layoutChange: ["keep", "recipes-only", "rebuild-ok"],
  twoPowerPlants: ["accept", "avoid"],
  loginCadence: ["twice-daily", "daily", "irregular"],
} as const;

export type HealthDemandField = keyof HealthDemand;
export const HEALTH_DEMAND_FIELDS = Object.keys(HEALTH_DEMAND_OPTIONS) as HealthDemandField[];
export const HEALTH_DEMAND_STORAGE_KEY = "riic-account-health-demand-v1";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function normalizeHealthDemand(input: unknown): HealthDemand | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const demand: Record<string, string> = {};
  for (const field of HEALTH_DEMAND_FIELDS) {
    const value = record[field];
    if (typeof value === "string" && (HEALTH_DEMAND_OPTIONS[field] as readonly string[]).includes(value)) {
      demand[field] = value;
    }
  }
  return Object.keys(demand).length ? demand as HealthDemand : null;
}

export function healthDemandStorageKey(identityKey: string): string {
  return `${HEALTH_DEMAND_STORAGE_KEY}:${identityKey}`;
}

export function loadHealthDemand(storage: StorageLike, identityKey: string): HealthDemand | null {
  try {
    const value = storage.getItem(healthDemandStorageKey(identityKey));
    return value ? normalizeHealthDemand(JSON.parse(value)) : null;
  } catch {
    return null;
  }
}

export function persistHealthDemand(storage: StorageLike, identityKey: string, input: HealthDemand): HealthDemand | null {
  const demand = normalizeHealthDemand(input);
  if (demand) storage.setItem(healthDemandStorageKey(identityKey), JSON.stringify(demand));
  else storage.removeItem(healthDemandStorageKey(identityKey));
  return demand;
}
