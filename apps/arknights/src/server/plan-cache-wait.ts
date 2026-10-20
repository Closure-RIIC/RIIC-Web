export function planCacheRetryDelayMs(attempt: number, random = Math.random): number {
  return Math.round(Math.min(2_000, 500 * 2 ** Math.min(attempt, 2)) * (0.9 + random() * 0.2));
}

// Read an existing lease without contending for its row lock on every poll.
// Callers retain their existing bounded execution slots and failure fallback.
export async function waitForPlanCache<T>(options: {
  read: () => Promise<{ hit: T | null; leased: boolean }>;
  acquire: () => Promise<T | null>;
  timeoutMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}): Promise<T | null> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + options.timeoutMs;
  let attempt = 0;
  for (;;) {
    const state = await options.read();
    if (state.hit) return state.hit;
    if (now() >= deadline) return null;
    if (!state.leased) {
      const lease = await options.acquire();
      if (lease) return lease;
    }
    const remaining = deadline - now();
    if (remaining <= 0) return null;
    await sleep(Math.min(remaining, planCacheRetryDelayMs(attempt++, options.random)));
  }
}
