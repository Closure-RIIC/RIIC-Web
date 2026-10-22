import type { TrainingGoal } from "./training-planner.ts";

const STORAGE_PREFIX = "arknights-infra-training-planner-v1";
const HANDOFF_KEY = `${STORAGE_PREFIX}:handoff`;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

export function loadTrainingGoals(identityKey: string): TrainingGoal[] {
  const value = readJson<unknown>(`${STORAGE_PREFIX}:goals:${identityKey}`, []);
  return Array.isArray(value) ? value.filter((item): item is TrainingGoal => Boolean(item && typeof item.operatorId === "string")) : [];
}

export function saveTrainingGoals(identityKey: string, goals: readonly TrainingGoal[]) {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}:goals:${identityKey}`, JSON.stringify(goals));
    return true;
  } catch {
    return false;
  }
}

export function loadTrainingInventory(identityKey: string): Record<string, number> {
  const value = readJson<unknown>(`${STORAGE_PREFIX}:inventory-overrides:${identityKey}`, {});
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, amount]) => (
    typeof amount === "number" && Number.isFinite(amount) && amount >= 0
  )));
}

export function saveTrainingInventory(identityKey: string, inventory: Readonly<Record<string, number>>) {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}:inventory-overrides:${identityKey}`, JSON.stringify(inventory));
    return true;
  } catch {
    return false;
  }
}

export type TrainingPlannerHandoff = Array<{
  operatorId: string;
  targetElite: number;
  targetLevel: number;
}>;

export function setTrainingPlannerHandoff(targets: TrainingPlannerHandoff) {
  try {
    window.localStorage.setItem(HANDOFF_KEY, JSON.stringify(targets));
    return true;
  } catch {
    return false;
  }
}

export function takeTrainingPlannerHandoff(): TrainingPlannerHandoff {
  const value = readJson<unknown>(HANDOFF_KEY, []);
  try {
    window.localStorage.removeItem(HANDOFF_KEY);
  } catch { /* The handoff can still be used for this page load. */ }
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is TrainingPlannerHandoff[number] => (
    Boolean(item && typeof item.operatorId === "string"
      && Number.isInteger(item.targetElite) && item.targetElite >= 0 && item.targetElite <= 2
      && Number.isInteger(item.targetLevel) && item.targetLevel >= 1 && item.targetLevel <= 90)
  ));
}
