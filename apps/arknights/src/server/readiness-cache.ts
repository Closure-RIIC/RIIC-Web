import type { PublicHealthData } from "../types.ts";

/** One entry per process, including an in-flight probe. Never an HTTP/shared cache. */
export function createReadinessCache(
  probe: () => Promise<PublicHealthData>,
  releaseKey: () => string,
  now: () => number = Date.now,
) {
  let entry: { key: string; expiresAt: number; promise: Promise<PublicHealthData> } | undefined;
  return (): Promise<PublicHealthData> => {
    const key = releaseKey();
    if (entry?.key === key && entry.expiresAt > now()) return entry.promise;
    const next = { key, expiresAt: Infinity, promise: null as unknown as Promise<PublicHealthData> };
    next.promise = Promise.resolve().then(probe).then(
      (data) => {
        next.expiresAt = now() + (data.plannerReady ? 5_000 : 1_000);
        return data;
      },
      (error: unknown) => {
        next.expiresAt = now() + 1_000;
        throw error;
      },
    );
    entry = next;
    return next.promise;
  };
}
