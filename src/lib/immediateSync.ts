/**
 * Phase 24.1B — event-driven immediate push orchestration.
 */

import type { SyncOperationKind } from "../types";
import { syncKindPriority, coalesceKeyForOp } from "./syncQueuePriority";
import { logSync, coalesceMsForConnection } from "./syncDiagnostics";
import { getDeviceOnline } from "./deviceOnline";
import { IMMEDIATE_PUSH_COALESCE_MS } from "./syncTiming";

const coalesceTimers = new Map<string, ReturnType<typeof setTimeout>>();
let immediatePushTimer: ReturnType<typeof setTimeout> | null = null;

function extractSaleId(payload: unknown): string | null {
  const p = payload as Record<string, unknown> | null;
  if (!p) return null;
  const id = String(p.saleId ?? p.id ?? "").trim();
  return id || null;
}

function scheduleImmediatePushUpload(opts?: { force?: boolean; source?: string }): void {
  if (immediatePushTimer != null) clearTimeout(immediatePushTimer);
  immediatePushTimer = globalThis.setTimeout(() => {
    immediatePushTimer = null;
    void import("./posPushScheduler").then(async ({ runPosPushOnlyUpload }) => {
      try {
        await runPosPushOnlyUpload({ force: opts?.force ?? true, source: opts?.source ?? "immediate" });
      } catch {
        // fire-and-forget push scheduler
      }
    });
  }, 0);
}

export function scheduleImmediatePull(reason: string, opts?: { force?: boolean }): void {
  logSync("pull_scheduled", { reason, force: opts?.force ?? false });
  void import("../offline/cloudSync").then(({ scheduleIncrementalCloudPull }) => {
    scheduleIncrementalCloudPull(reason, opts);
  });
}

/** Staff cloud ACK — immediate staff cache refresh + event-driven pull (Phase 25.1). */
export function scheduleImmediateStaffPull(source: string): void {
  const pullReason = source === "staff_realtime" ? "staff_realtime" : "staff_ack";
  void import("./staffRecovery").then(({ pullAndMergeStaffDuringCloudSync }) => {
    void pullAndMergeStaffDuringCloudSync({ force: true, reason: pullReason });
  });
  scheduleImmediatePull(pullReason, { force: true });
}

/** Fire immediate sale push + queue drain; triggers pull on ACK. */
export async function runImmediateSaleSync(saleId: string): Promise<void> {
  logSync("enqueue", { kind: "sale", saleId, priority: 0 });
  const { syncSaleImmediately } = await import("../offline/cloudSync");
  const started = performance.now();
  logSync("push_start", { kind: "sale", saleId });
  const ok = await syncSaleImmediately(saleId);
  recordPushIfNeeded(started);
  if (ok) {
    scheduleImmediatePull("sale_ack", { force: true });
  }
  await (await import("./posPushScheduler")).runPosPushOnlyUpload({
    force: true,
    source: "immediate_sale",
  });
}

function recordPushIfNeeded(started: number): void {
  void import("./syncDiagnostics").then(({ recordPushDuration }) => {
    recordPushDuration(performance.now() - started);
  });
}

function scheduleCoalescedPush(kind: SyncOperationKind, key: string): void {
  const existing = coalesceTimers.get(key);
  if (existing != null) clearTimeout(existing);
  const delay = coalesceMsForConnection(getDeviceOnline(), IMMEDIATE_PUSH_COALESCE_MS);
  coalesceTimers.set(
    key,
    globalThis.setTimeout(() => {
      coalesceTimers.delete(key);
      logSync("coalesce", { kind, key });
      scheduleImmediatePushUpload({ force: true, source: `coalesce_${kind}` });
    }, delay),
  );
}

/** Called after every local queue enqueue — routes to immediate or coalesced push. */
export function scheduleImmediateSyncForKind(kind: SyncOperationKind, payload?: unknown): void {
  const priority = syncKindPriority(kind);
  logSync("enqueue", { kind, priority });

  if (kind === "pending_sales" || kind === "sale") {
    const saleId = extractSaleId(payload);
    if (saleId) {
      void runImmediateSaleSync(saleId);
      return;
    }
  }

  const coalesceKey = coalesceKeyForOp(kind, payload);
  if (coalesceKey && (kind === "product" || kind === "customer" || kind === "supplier" || kind === "pending_staff")) {
    scheduleCoalescedPush(kind, coalesceKey);
    return;
  }

  if (priority === 0) {
    scheduleImmediatePushUpload({ force: true, source: `immediate_${kind}` });
    return;
  }

  if (priority === 1) {
    scheduleImmediatePushUpload({ force: true, source: `priority1_${kind}` });
    return;
  }

  scheduleImmediatePushUpload({ force: false, source: `priority2_${kind}` });
}

/** Backward-compatible alias for checkout debounce — now immediate-first. */
export function scheduleImmediatePushAfterMutation(): void {
  scheduleImmediatePushUpload({ force: true, source: "post_mutation" });
}
