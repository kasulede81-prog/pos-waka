/** Weak fingerprint cache for expensive pure computations (same inputs → same outputs). */

type CacheEntry<T> = {
  fingerprint: string;
  value: T;
  at: number;
};

const cache = new Map<string, CacheEntry<unknown>>();
const MAX_ENTRIES = 32;

export function getCachedComputation<T>(key: string, fingerprint: string, compute: () => T): T {
  const hit = cache.get(key);
  if (hit && hit.fingerprint === fingerprint) {
    return hit.value as T;
  }
  const value = compute();
  cache.set(key, { fingerprint, value, at: Date.now() });
  if (cache.size > MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [k, v] of cache) {
      if (v.at < oldestAt) {
        oldestAt = v.at;
        oldestKey = k;
      }
    }
    if (oldestKey) cache.delete(oldestKey);
  }
  return value;
}

export function buildSalesFingerprint(sales: { id: string; updatedAt?: string | null; pendingSync?: boolean }[]): string {
  if (sales.length === 0) return "0";
  const first = sales[0]?.id ?? "";
  const last = sales[sales.length - 1]?.id ?? "";
  return `${sales.length}:${first}:${last}`;
}
