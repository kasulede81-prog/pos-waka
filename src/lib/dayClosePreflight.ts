import { getDeviceOnline } from "./deviceOnline";
import { readSyncHealthMeta } from "./syncMeta";
import { usePosStore } from "../store/usePosStore";

export type DayClosePreflightResult = {
  ok: boolean;
  warnings: string[];
  errorKey?: string;
};

const STALE_RECONCILIATION_MS = 15 * 60_000;

/** Verify cloud state and pending cash sync before day close. */
export async function runDayClosePreflight(): Promise<DayClosePreflightResult> {
  const warnings: string[] = [];
  const state = usePosStore.getState();

  const pendingCash =
    state.dayCloses.filter((d) => d.pendingSync).length +
    state.cashExpenses.filter((e) => e.pendingSync && !e.deletedAt).length +
    state.cashDrawerAdjustments.filter((a) => a.pendingSync).length +
    state.dayDrawerOpens.filter((d) => d.pendingSync).length;

  if (pendingCash > 0) {
    warnings.push(`pending_cash_sync:${pendingCash}`);
  }

  const health = readSyncHealthMeta();
  if (health.lastPullAt) {
    const age = Date.now() - new Date(health.lastPullAt).getTime();
    if (age > STALE_RECONCILIATION_MS) {
      warnings.push("cloud_reconciliation_stale");
    }
  } else if (getDeviceOnline()) {
    warnings.push("cloud_reconciliation_never_pulled");
  }

  if (health.queueHealth !== "healthy") {
    warnings.push(`sync_queue_${health.queueHealth}`);
  }

  if (getDeviceOnline()) {
    try {
      const { syncShopWithCloud } = await import("../offline/cloudSync");
      const result = await syncShopWithCloud({ pull: true });
      if (result.queueFailed > 0 || result.push.fail > 0) {
        warnings.push("cloud_preflight_push_incomplete");
      }
      if (!result.pulled && health.lastPullAt == null) {
        warnings.push("cloud_preflight_pull_skipped");
      }
    } catch {
      warnings.push("cloud_preflight_failed");
    }
  }

  return { ok: true, warnings };
}
