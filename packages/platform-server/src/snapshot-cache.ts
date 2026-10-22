import { dataIdentityKey, type DataIdentity } from "@riic/contracts/api";

type Entry<T> = { owner: string; expiresAt: number; task: Promise<T> };

/** Bounded, process-local snapshots. Failed or invalidated reads never repopulate the cache. */
export function createSnapshotCache<T>({ ttlMs = 30_000, maxEntries = 100, now = Date.now } = {}) {
  const entries = new Map<string, Entry<T>>();
  return {
    read(identity: DataIdentity, load: () => Promise<T>, force = false): Promise<T> {
      const key = dataIdentityKey(identity);
      const previous = entries.get(key);
      if (previous && (previous.expiresAt === Infinity || !force && previous.expiresAt > now())) return previous.task.then(value => structuredClone(value));
      for (const [id, entry] of entries) if (entry.expiresAt <= now()) entries.delete(id);
      if (entries.size >= maxEntries) return load();
      const entry: Entry<T> = { owner: identity.userId, expiresAt: Infinity, task: Promise.resolve().then(load) };
      entries.set(key, entry);
      entry.task = entry.task.then(value => { entry.expiresAt = now() + ttlMs; return structuredClone(value); }, error => {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      });
      return entry.task.then(value => structuredClone(value));
    },
    invalidateOwner(userId: string) {
      for (const [key, entry] of entries) if (entry.owner === userId) entries.delete(key);
    },
  };
}
