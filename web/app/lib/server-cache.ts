type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const valueCache = new Map<string, CacheEntry<unknown>>();
const inflightCache = new Map<string, Promise<unknown>>();

export async function readThroughServerCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const cached = valueCache.get(key);

  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }

  const inflight = inflightCache.get(key);
  if (inflight) {
    return inflight as Promise<T>;
  }

  const promise = loader()
    .then((value) => {
      valueCache.set(key, {
        expiresAt: Date.now() + Math.max(0, ttlMs),
        value,
      });
      inflightCache.delete(key);
      return value;
    })
    .catch((error) => {
      inflightCache.delete(key);
      throw error;
    });

  inflightCache.set(key, promise);
  return promise;
}
