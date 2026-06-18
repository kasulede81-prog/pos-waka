/**
 * Sync queue diagnostics — read-only queue health for disaster recovery visibility.
 */

import { nextQueueRetryMs } from "../offline/syncEngine";
import { readSyncQueue } from "../offline/localDb";
import { hasSupabaseConfig } from "./supabase";
import type { SyncOperation } from "../types";

export type QueueSyncDiagnosticSnapshot = {
  checkedAt: string;
  queuedCount: number;
  oldestOpAgeMs: number | null;
  maxAttempts: number;
  localOnlyMode: boolean;
  nextRetryMs: number | null;
  byKind: Record<string, number>;
  rawQueue: SyncOperation[];
};

function groupByKind(queue: SyncOperation[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const op of queue) {
    out[op.kind] = (out[op.kind] ?? 0) + 1;
  }
  return out;
}

export async function buildQueueSyncDiagnosticSnapshot(): Promise<QueueSyncDiagnosticSnapshot> {
  const queue = await readSyncQueue();
  const now = Date.now();
  let oldestMs: number | null = null;
  let maxAttempts = 0;
  for (const op of queue) {
    maxAttempts = Math.max(maxAttempts, op.attempts);
    const created = new Date(op.createdAt).getTime();
    if (!Number.isNaN(created)) {
      const age = now - created;
      oldestMs = oldestMs == null ? age : Math.max(oldestMs, age);
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    queuedCount: queue.length,
    oldestOpAgeMs: oldestMs,
    maxAttempts,
    localOnlyMode: !hasSupabaseConfig,
    nextRetryMs: nextQueueRetryMs(queue, now),
    byKind: groupByKind(queue),
    rawQueue: queue,
  };
}
