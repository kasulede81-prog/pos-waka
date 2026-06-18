/** Read-only performance telemetry (local, owner diagnostics). */

export type PageMark = {
  page: string;
  durationMs: number;
  at: string;
};

export type ComputationMark = {
  label: string;
  durationMs: number;
  at: string;
};

export type PerformanceSnapshot = {
  bootstrapStartedAt: number | null;
  bootstrapDurationMs: number | null;
  bootstrapIdbReads: number;
  bootstrapRecordsScanned: number;
  bootstrapUsedFullTableScan: boolean;
  lastSyncDurationMs: number | null;
  lastSyncLabel: string | null;
  pageMarks: PageMark[];
  computationMarks: ComputationMark[];
  slowestPage: PageMark | null;
};

const MAX_MARKS = 24;

const state: PerformanceSnapshot = {
  bootstrapStartedAt: null,
  bootstrapDurationMs: null,
  bootstrapIdbReads: 0,
  bootstrapRecordsScanned: 0,
  bootstrapUsedFullTableScan: false,
  lastSyncDurationMs: null,
  lastSyncLabel: null,
  pageMarks: [],
  computationMarks: [],
  slowestPage: null,
};

export function markBootstrapStart(): void {
  state.bootstrapStartedAt = performance.now();
  state.bootstrapIdbReads = 0;
  state.bootstrapRecordsScanned = 0;
  state.bootstrapUsedFullTableScan = false;
}

export function recordBootstrapIdbRead(scanned: number, opts?: { fullTable?: boolean }): void {
  state.bootstrapIdbReads += 1;
  state.bootstrapRecordsScanned += Math.max(0, scanned);
  if (opts?.fullTable) state.bootstrapUsedFullTableScan = true;
}

export function markBootstrapEnd(): void {
  if (state.bootstrapStartedAt == null) return;
  state.bootstrapDurationMs = Math.round(performance.now() - state.bootstrapStartedAt);
  state.bootstrapStartedAt = null;
}

export function recordSyncDuration(label: string, durationMs: number): void {
  state.lastSyncLabel = label;
  state.lastSyncDurationMs = Math.round(durationMs);
}

export function markPageLoad(page: string, durationMs: number): void {
  const mark: PageMark = { page, durationMs: Math.round(durationMs), at: new Date().toISOString() };
  state.pageMarks = [mark, ...state.pageMarks].slice(0, MAX_MARKS);
  state.slowestPage =
    state.pageMarks.reduce<PageMark | null>((best, cur) => {
      if (!best || cur.durationMs > best.durationMs) return cur;
      return best;
    }, null) ?? null;
}

export function recordComputationTiming(label: string, durationMs: number): void {
  const mark: ComputationMark = { label, durationMs: Math.round(durationMs), at: new Date().toISOString() };
  state.computationMarks = [mark, ...state.computationMarks].slice(0, MAX_MARKS);
}

export function readPerformanceSnapshot(): PerformanceSnapshot {
  return {
    ...state,
    pageMarks: [...state.pageMarks],
    computationMarks: [...state.computationMarks],
  };
}

export function timedComputation<T>(label: string, fn: () => T): T {
  const start = performance.now();
  const result = fn();
  recordComputationTiming(label, performance.now() - start);
  return result;
}

export async function timedComputationAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await fn();
  recordComputationTiming(label, performance.now() - start);
  return result;
}
