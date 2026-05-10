import { hasSupabaseConfig, supabase } from "../lib/supabase";
import { reportSyncIssue } from "../lib/monitoring";
import type { SyncOperation } from "../types";
import { appendSyncOperation, readSyncQueue, removeSyncOperation } from "./localDb";

export async function enqueueSync(op: Omit<SyncOperation, "attempts"> & { attempts?: number }): Promise<void> {
  const full: SyncOperation = {
    ...op,
    attempts: op.attempts ?? 0,
  };
  await appendSyncOperation(full);
}

/**
 * Best-effort remote push. When Supabase is not configured, ops are cleared so
 * the queue stays small. When configured but signed out, ops are retried later.
 * Wire real inserts (shop-scoped) when backend IDs are available in the client.
 */
async function processOne(op: SyncOperation): Promise<boolean> {
  if (!hasSupabaseConfig || !supabase) return true;

  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return false;

  switch (op.kind) {
    case "sale":
    case "product":
    case "customer":
    case "stock_move":
    case "audit_log":
    default:
      return true;
  }
}

export async function flushSyncQueue(onProgress?: (done: number, total: number) => void): Promise<{
  failed: number;
  remaining: number;
}> {
  const queue = (await readSyncQueue()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let failed = 0;
  const total = queue.length;
  let done = 0;
  for (const op of queue) {
    try {
      const ok = await processOne(op);
      if (ok) {
        await removeSyncOperation(op.id);
      } else {
        failed += 1;
        if (op.attempts < 100) {
          await appendSyncOperation({ ...op, attempts: op.attempts + 1 });
        }
      }
    } catch {
      failed += 1;
      reportSyncIssue("sync_flush_error", { kind: op.kind, attempts: op.attempts + 1 });
      if (op.attempts < 100) {
        try {
          await appendSyncOperation({ ...op, attempts: op.attempts + 1 });
        } catch {
          reportSyncIssue("sync_queue_corrupt", { kind: op.kind });
        }
      }
    }
    done += 1;
    onProgress?.(done, total);
  }
  const remaining = (await readSyncQueue()).length;
  return { failed, remaining };
}
