import type { IncrementalPersistResult } from "../offline/incrementalPersist";

type CloudPullDiagnostics = {
  mode: "full" | "incremental";
  products: number;
  customers: number;
  sales: number;
  deletedProducts: number;
  voidedSales: number;
  expenses: number;
  payloadBytes: number;
  durationMs: number;
};

type NetworkBucket = { minuteKey: string; count: number };

let networkBuckets: NetworkBucket[] = [];
let fullPersistCount = 0;
let incrementalPersistCount = 0;
let lastFullPersistAt: number | null = null;
let lastIncrementalPersistAt: number | null = null;
let lastIncrementalBytes = 0;
let lastIncrementalEntityWrites = 0;
let lastIncrementalDurationMs = 0;
let lastFullBytes = 0;
let lastFullDurationMs = 0;
let lastMergeMs: number | null = null;
let lastSyncMs: number | null = null;
let incrementalCloudPullCount = 0;
let fullCloudPullCount = 0;
let lastCloudPull: CloudPullDiagnostics | null = null;
let totalCloudRecordsPulled = 0;
let totalCloudPayloadBytes = 0;
let longTaskCount = 0;
let fetchPatched = false;
let longTaskObserver: PerformanceObserver | null = null;

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

/** Legacy full snapshot write (backups / merge). */
export function recordPersistWrite(bytesWritten?: number, durationMs?: number): void {
  fullPersistCount += 1;
  lastFullPersistAt = Date.now();
  if (bytesWritten != null) lastFullBytes = bytesWritten;
  if (durationMs != null) lastFullDurationMs = durationMs;
}

export function recordIncrementalPersist(result: IncrementalPersistResult): void {
  incrementalPersistCount += 1;
  lastIncrementalPersistAt = Date.now();
  lastIncrementalBytes = result.bytesWritten;
  lastIncrementalEntityWrites = result.entityWrites;
  lastIncrementalDurationMs = result.durationMs;
}

export function recordCloudMergeDuration(ms: number): void {
  lastMergeMs = ms;
}

export function recordSyncDuration(ms: number): void {
  lastSyncMs = ms;
}

export function recordCloudPullStats(stats: CloudPullDiagnostics): void {
  lastCloudPull = stats;
  const records =
    stats.products +
    stats.customers +
    stats.sales +
    stats.deletedProducts +
    stats.voidedSales +
    stats.expenses;
  totalCloudRecordsPulled += records;
  totalCloudPayloadBytes += stats.payloadBytes;
  if (stats.mode === "full") fullCloudPullCount += 1;
  else incrementalCloudPullCount += 1;
}

export function getCloudPullStats(): {
  incrementalPulls: number;
  fullPulls: number;
  lastPull: CloudPullDiagnostics | null;
  totalRecords: number;
  totalPayloadBytes: number;
} {
  return {
    incrementalPulls: incrementalCloudPullCount,
    fullPulls: fullCloudPullCount,
    lastPull: lastCloudPull,
    totalRecords: totalCloudRecordsPulled,
    totalPayloadBytes: totalCloudPayloadBytes,
  };
}

export function networkRequestsLastMinute(): number {
  const key = minuteKey();
  const bucket = networkBuckets.find((b) => b.minuteKey === key);
  return bucket?.count ?? 0;
}

export function getPersistStats(): {
  fullCount: number;
  incrementalCount: number;
  lastFullAt: number | null;
  lastIncrementalAt: number | null;
  lastIncrementalBytes: number;
  lastIncrementalEntityWrites: number;
  lastIncrementalDurationMs: number;
  lastFullBytes: number;
  lastFullDurationMs: number;
} {
  return {
    fullCount: fullPersistCount,
    incrementalCount: incrementalPersistCount,
    lastFullAt: lastFullPersistAt,
    lastIncrementalAt: lastIncrementalPersistAt,
    lastIncrementalBytes,
    lastIncrementalEntityWrites,
    lastIncrementalDurationMs,
    lastFullBytes,
    lastFullDurationMs,
  };
}

export function getLastMergeMs(): number | null {
  return lastMergeMs;
}

export function getLastSyncMs(): number | null {
  return lastSyncMs;
}

export function getLongTaskCount(): number {
  return longTaskCount;
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

export function installNetworkDiagnosticsProbe(): void {
  if (fetchPatched || typeof window === "undefined") return;
  fetchPatched = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    recordNetworkRequest();
    return nativeFetch(...args);
  };

  if ("PerformanceObserver" in window) {
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        longTaskCount += list.getEntries().length;
      });
      longTaskObserver.observe({ type: "longtask", buffered: true });
    } catch {
      /* unsupported */
    }
  }
}

export function disposeDiagnosticsProbes(): void {
  longTaskObserver?.disconnect();
  longTaskObserver = null;
}
