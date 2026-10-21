import { normalizePersistedPlanData, SESSION_TTL_MS } from "./persistence.ts";
import { DEFAULT_ROTATION_PROFILE } from "./rotation-settings.ts";
import type { PublicPlanData } from "./types.ts";

export const PLAN_HISTORY_KEY = "arknights-infra-plan-history-v1";

export type PlanHistoryEntry = { savedAt: string; result: PublicPlanData };

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parsePlanHistory(raw: string | null, now = Date.now()): PlanHistoryEntry[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(value)) return [];
    const entries: PlanHistoryEntry[] = [];
    for (const candidate of value) {
      if (!isObject(candidate) || typeof candidate.savedAt !== "string") continue;
      const savedAt = Date.parse(candidate.savedAt);
      if (!Number.isFinite(savedAt) || savedAt > now || now - savedAt >= SESSION_TTL_MS) continue;
      const result = normalizePersistedPlanData(candidate.result, DEFAULT_ROTATION_PROFILE);
      if (!result) continue;
      entries.push({ savedAt: new Date(savedAt).toISOString(), result });
      if (entries.length === 5) break;
    }
    return entries;
  } catch {
    return [];
  }
}

export function readPlanHistory(storage: Pick<Storage, "getItem">, now = Date.now()): PlanHistoryEntry[] {
  return parsePlanHistory(storage.getItem(PLAN_HISTORY_KEY), now);
}

export function writePlanHistory(storage: Pick<Storage, "setItem">, entries: PlanHistoryEntry[]): void {
  storage.setItem(PLAN_HISTORY_KEY, JSON.stringify(entries.slice(0, 5)));
}
