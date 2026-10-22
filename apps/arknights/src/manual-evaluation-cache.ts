import type { ManualPlanResult } from "./manual-plan-result.ts";

export const MANUAL_EVALUATION_CACHE_STORAGE_KEY = "arknights-infra-manual-evaluation-v1";
const CACHE_VERSION = 5;
const EVALUATOR_VERSION = 5;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type CachedEvaluation = {
  version: number;
  evaluatorVersion: number;
  evaluation: ManualPlanResult;
  savedAt: string;
  expiresAt: string;
};

function validEvaluation(value: unknown): value is ManualPlanResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ManualPlanResult>;
  return typeof candidate.elapsedMs === "number"
    && Number.isFinite(candidate.elapsedMs)
    && Array.isArray(candidate.roomsByShift)
    && Array.isArray(candidate.warnings)
    && candidate.kind === "manual"
    && candidate.revision === 1
    && candidate.layout !== undefined
    && candidate.maa !== undefined
    && candidate.rotation !== undefined
    && Array.isArray(candidate.rotation.shifts);
}

export function loadManualEvaluationCache(storage: StorageLike): ManualPlanResult | null {
  try {
    const raw = storage.getItem(MANUAL_EVALUATION_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as CachedEvaluation;
    const structurallyValid = cache.version === CACHE_VERSION
      && cache.evaluatorVersion === EVALUATOR_VERSION
      && Number.isFinite(Date.parse(cache.savedAt))
      && Number.isFinite(Date.parse(cache.expiresAt))
      && Date.parse(cache.expiresAt) > Date.now()
      && validEvaluation(cache.evaluation);
    if (!structurallyValid) {
      storage.removeItem(MANUAL_EVALUATION_CACHE_STORAGE_KEY);
      return null;
    }
    return structuredClone(cache.evaluation);
  } catch {
    storage.removeItem(MANUAL_EVALUATION_CACHE_STORAGE_KEY);
    return null;
  }
}

export function persistManualEvaluationCache(storage: StorageLike, evaluation: ManualPlanResult): void {
  const savedAt = Date.now();
  const cache: CachedEvaluation = {
    version: CACHE_VERSION,
    evaluatorVersion: EVALUATOR_VERSION,
    evaluation: structuredClone(evaluation),
    savedAt: new Date(savedAt).toISOString(),
    expiresAt: new Date(savedAt + CACHE_TTL_MS).toISOString(),
  };
  storage.setItem(MANUAL_EVALUATION_CACHE_STORAGE_KEY, JSON.stringify(cache));
}

export function clearManualEvaluationCache(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(MANUAL_EVALUATION_CACHE_STORAGE_KEY);
}
