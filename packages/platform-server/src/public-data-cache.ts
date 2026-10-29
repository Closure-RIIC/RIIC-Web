/** Short-lived cache for already-sanitized public DTOs, never responses or session data. */
export function createPublicDataCache<Key, Value>(ttlMs = 15_000, now = Date.now) {
  type Entry = { expiresAt: number; pending: boolean; promise: Promise<Value> };
  const entries = new Map<Key, Entry>();
  return {
    get(key: Key, load: () => Promise<Value>): Promise<Value> {
      const existing = entries.get(key);
      if (existing && (existing.pending || existing.expiresAt > now())) return existing.promise;
      const entry: Entry = { expiresAt: now() + ttlMs, pending: true, promise: undefined! };
      entry.promise = Promise.resolve().then(load).then((value) => {
        entry.pending = false;
        return value;
      }).catch((error: unknown) => {
        // An invalidated, older load cannot delete or refill the new generation.
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      });
      entries.set(key, entry);
      return entry.promise;
    },
    invalidate(key: Key) { entries.delete(key); },
  };
}

export function cachePublicResponse(response: Response): Response {
  response.headers.set("Cache-Control", "public, max-age=15, must-revalidate");
  return response;
}
