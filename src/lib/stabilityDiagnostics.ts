/** Dev-only runtime probes for production stability investigation. */

type NetworkBucket = { minuteKey: string; count: number };

let networkBuckets: NetworkBucket[] = [];
let persistWriteCount = 0;
let lastPersistAt: number | null = null;
let lastMergeMs: number | null = null;
let fetchPatched = false;

function minuteKey(now = Date.now()): string {
  return String(Math.floor(now / 60_000));
}

export function recordNetworkRequest(): void {
  const key = minuteKey();
  const head = networkBuckets[networkBuckets.length - 1];
  if (head?.minuteKey === key) {
    head.count += 1;
  } else {
    networkBuckets.push({ minuteKey: key, count: 1 });
  }
  if (networkBuckets.length > 10) networkBuckets = networkBuckets.slice(-10);
}

export function recordPersistWrite(): void {
  persistWriteCount += 1;
  lastPersistAt = Date.now();
}

export function recordCloudMergeDuration(ms: number): void {
  lastMergeMs = ms;
}

export function networkRequestsLastMinute(): number {
  const key = minuteKey();
  const bucket = networkBuckets.find((b) => b.minuteKey === key);
  return bucket?.count ?? 0;
}

export function getPersistStats(): { total: number; lastAt: number | null } {
  return { total: persistWriteCount, lastAt: lastPersistAt };
}

export function getLastMergeMs(): number | null {
  return lastMergeMs;
}

export function readJsHeapMb(): number | null {
  if (typeof performance === "undefined") return null;
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  if (!mem?.usedJSHeapSize) return null;
  return Math.round((mem.usedJSHeapSize / (1024 * 1024)) * 10) / 10;
}

export function isDiagnosticsEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return localStorage.getItem("waka-diag") === "1";
  } catch {
    return false;
  }
}

/** Patch global fetch once to count Supabase/API traffic. */
export function installNetworkDiagnosticsProbe(): void {
  if (fetchPatched || typeof window === "undefined") return;
  fetchPatched = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    recordNetworkRequest();
    return nativeFetch(...args);
  };
}
