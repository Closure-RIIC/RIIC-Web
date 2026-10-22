import type { SklandBindingSummary } from "./types.ts";

export const SKLAND_BINDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SklandBindingState = "active" | "reauthorize" | "renewal-due" | "unbound";

export function emptySklandBindingSummary(): SklandBindingSummary {
  return {
    totalCount: 0,
    activeCount: 0,
    renewalDueCount: 0,
    nextExpiresAt: null,
    latestExpiredAt: null,
  };
}

export function summarizeSklandBindings(
  lastAuthorizedAtValues: readonly number[],
  now = Date.now(),
): SklandBindingSummary {
  const summary = emptySklandBindingSummary();
  const activeExpiries: number[] = [];
  const expiredExpiries: number[] = [];

  for (const lastAuthorizedAt of lastAuthorizedAtValues) {
    if (!Number.isFinite(lastAuthorizedAt)) continue;
    const expiresAt = lastAuthorizedAt + SKLAND_BINDING_TTL_MS;
    summary.totalCount += 1;
    if (expiresAt > now) {
      summary.activeCount += 1;
      activeExpiries.push(expiresAt);
    } else {
      summary.renewalDueCount += 1;
      expiredExpiries.push(expiresAt);
    }
  }

  summary.nextExpiresAt = activeExpiries.length ? Math.min(...activeExpiries) : null;
  summary.latestExpiredAt = expiredExpiries.length ? Math.max(...expiredExpiries) : null;
  return summary;
}

export function deriveSklandBindingState(
  bindingSummary: SklandBindingSummary,
  credentialCount: number,
): SklandBindingState {
  if (credentialCount > 0) return "active";
  if (bindingSummary.activeCount > 0) return "reauthorize";
  if (bindingSummary.renewalDueCount > 0) return "renewal-due";
  return "unbound";
}
