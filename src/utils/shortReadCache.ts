/** Memory only. Invalidation also prevents an older in-flight read from repopulating the cache. */
export function createShortReadCache<T>(ttlMs: number, now = Date.now) {
  type Entry = { expiresAt: number; promise: Promise<T>; pending: boolean };
  const entries = new Map<string, Entry>();
  return {
    get(key: string, load: () => Promise<T>): Promise<T> {
      const cached = entries.get(key);
      if (cached && (cached.pending || now() < cached.expiresAt)) return cached.promise;
      const entry: Entry = { expiresAt: now() + ttlMs, promise: Promise.resolve().then(load), pending: true };
      entries.set(key, entry);
      void entry.promise.catch(() => {
        if (entries.get(key) === entry) entries.delete(key);
      });
      void entry.promise.then(() => { entry.pending = false; }, () => { entry.pending = false; });
      return entry.promise;
    },
    clear() { entries.clear(); },
  };
}

export const HOME_READ_TTL_MS = 30_000;
