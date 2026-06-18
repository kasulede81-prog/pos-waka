import { hasSupabaseConfig, supabase } from "../lib/supabase";
import { reportSyncIssue } from "../lib/monitoring";
import type { SyncOperation } from "../types";
import { computeSyncBackoffMs, markSyncOpFailed, shouldRetrySyncOp } from "../lib/autoSync";
import { processCloudSyncOperation } from "./cloudSync";
import { appendSyncOperation, readSyncQueue, removeSyncOperation } from "./localDb";

export async function enqueueSync(op: Omit<SyncOperation, "attempts"> & { attempts?: number }): Promise<void> {
  const full: SyncOperation = {
    ...op,
    attempts: op.attempts ?? 0,
    lastAttemptAt: op.lastAttemptAt ?? null,
  };
  await appendSyncOperation(full);
}

/**
 * Best-effort remote push. When Supabase is not configured, ops are retained
 * (local-only mode) so they can sync once cloud is configured.
 * When configured but signed out, ops are retried later.
 */
async function processOne(op: SyncOperation): Promise<boolean> {
  if (!hasSupabaseConfig || !supabase) return false;

  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return false;

  try {
    return await processCloudSyncOperation(op);
  } catch {
    return false;
  }
}

export async function flushSyncQueue(onProgress?: (done: number, total: number) => void): Promise<{
  failed: number;
  remaining: number;
  skippedBackoff: number;
}> {
  const { withGlobalSyncMutex } = await import("../lib/globalSyncMutex");
  return withGlobalSyncMutex("flushSyncQueue", () => flushSyncQueueInner(onProgress));
}

async function flushSyncQueueInner(onProgress?: (done: number, total: number) => void): Promise<{
  failed: number;
  remaining: number;
  skippedBackoff: number;
}> {
  const queue = (await readSyncQueue()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let failed = 0;
  let skippedBackoff = 0;
  const total = queue.length;
  let done = 0;
  for (const op of queue) {
    if (!shouldRetrySyncOp(op)) {
      skippedBackoff += 1;
      done += 1;
      onProgress?.(done, total);
      continue;
    }
    try {
      const ok = await processOne(op);
      if (ok) {
        await removeSyncOperation(op.id);
      } else {
        failed += 1;
        if (op.attempts < 100) {
          await appendSyncOperation(markSyncOpFailed(op));
        }
      }
    } catch {
      failed += 1;
      reportSyncIssue("sync_flush_error", { kind: op.kind, attempts: op.attempts + 1 });
      if (op.attempts < 100) {
        try {
          await appendSyncOperation(markSyncOpFailed(op));
        } catch {
          reportSyncIssue("sync_queue_corrupt", { kind: op.kind });
        }
      }
    }
    done += 1;
    onProgress?.(done, total);
  }
  const remaining = (await readSyncQueue()).length;
  return { failed, remaining, skippedBackoff };
}

/** Next retry delay for the most-backed-off op (for diagnostics). */
export function nextQueueRetryMs(queue: SyncOperation[], nowMs = Date.now()): number | null {
  let minWait: number | null = null;
  for (const op of queue) {
    if (shouldRetrySyncOp(op, nowMs)) continue;
    const last = op.lastAttemptAt ? new Date(op.lastAttemptAt).getTime() : nowMs;
    const wait = computeSyncBackoffMs(op.attempts) - (nowMs - last);
    if (wait > 0) minWait = minWait == null ? wait : Math.min(minWait, wait);
  }
  return minWait;
}
