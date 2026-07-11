/**
 * POS-safe push-only upload scheduler — no cloud pull, no heavy merge.
 */

import { getDeviceOnline } from "./deviceOnline";
import { isGlobalSyncInFlight } from "./globalSyncMutex";
import { hasSupabaseConfig, supabase } from "./supabase";
import { shouldPausePosBackgroundPush } from "./backgroundWorkPolicy";
import { readSyncHealthMeta, writeSyncHealthMeta } from "./syncMeta";
import { countUnsyncedSales } from "../offline/cloudSync";
import {
  MIN_POS_PUSH_GAP_MS,
  POS_PUSH_INTERVAL_MS,
  POST_SALE_PUSH_DEBOUNCE_MS,
} from "./syncTiming";

export type PosPushSkipReason =
  | "offline"
  | "no_config"
  | "no_session"
  | "recovery_lock"
  | "org_blocked"
  | "push_paused"
  | "sync_busy"
  | "no_pending";

export type PosPushDiagnostics = {
  attempts: number;
  successes: number;
  failures: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastSkipReason: PosPushSkipReason | null;
};

export type PosPushUploadResult = {
  ran: boolean;
  skipped: boolean;
  skipReason?: PosPushSkipReason;
  pushOk: number;
  pushFail: number;
  queueFailed: number;
};

const POST_SALE_DEBOUNCE_MS = POST_SALE_PUSH_DEBOUNCE_MS;
export { POS_PUSH_INTERVAL_MS };

let postSaleTimer: ReturnType<typeof setTimeout> | null = null;
let pushInFlight = false;
let lastPushStartedAt = 0;

function readPosPushDiagnostics(): PosPushDiagnostics {
  const meta = readSyncHealthMeta();
  return {
    attempts: meta.posPushAttempts ?? 0,
    successes: meta.posPushSuccesses ?? 0,
    failures: meta.posPushFailures ?? 0,
    lastAttemptAt: meta.lastPosPushAt ?? null,
    lastSuccessAt: meta.lastPosPushSuccessAt ?? null,
    lastSkipReason: (meta.lastPosPushSkipReason as PosPushSkipReason | null) ?? null,
  };
}

function recordPosPushAttempt(skipReason?: PosPushSkipReason): void {
  const d = readPosPushDiagnostics();
  writeSyncHealthMeta({
    posPushAttempts: d.attempts + (skipReason ? 0 : 1),
    lastPosPushAt: new Date().toISOString(),
    lastPosPushSkipReason: skipReason ?? null,
    posPushUploadActive: !skipReason,
  });
}

function recordPosPushSuccess(pushOk: number, pushFail: number, queueFailed: number): void {
  const d = readPosPushDiagnostics();
  const ok = pushFail === 0 && queueFailed === 0;
  writeSyncHealthMeta({
    posPushSuccesses: ok ? d.successes + 1 : d.successes,
    posPushFailures: ok ? d.failures : d.failures + 1,
    lastPosPushSuccessAt: ok ? new Date().toISOString() : d.lastSuccessAt,
    posPushUploadActive: false,
    lastPosPushSkipReason: null,
  });
  void pushOk;
}

function recordPosPushFailure(): void {
  const d = readPosPushDiagnostics();
  writeSyncHealthMeta({
    posPushFailures: d.failures + 1,
    posPushUploadActive: false,
  });
}

export function readPosPushUploadDiagnostics(): PosPushDiagnostics {
  return readPosPushDiagnostics();
}

export function isPosPushUploadActive(): boolean {
  return readSyncHealthMeta().posPushUploadActive === true || pushInFlight;
}

export async function canRunPosPushUpload(opts?: {
  requirePending?: boolean;
}): Promise<{ ok: true } | { ok: false; reason: PosPushSkipReason }> {
  if (!hasSupabaseConfig || !supabase) return { ok: false, reason: "no_config" };
  if (!getDeviceOnline()) return { ok: false, reason: "offline" };
  if (shouldPausePosBackgroundPush()) return { ok: false, reason: "push_paused" };

  const { data } = await supabase.auth.getSession();
  if (!data.session?.user) return { ok: false, reason: "no_session" };

  const { isCloudRecoveryLockActive } = await import("./cloudRecoverySession");
  if (isCloudRecoveryLockActive()) return { ok: false, reason: "recovery_lock" };

  const { assertOrganizationOperationsAllowed } = await import("./organizationDeletionState");
  try {
    await assertOrganizationOperationsAllowed();
  } catch {
    return { ok: false, reason: "org_blocked" };
  }

  if (isGlobalSyncInFlight() && !pushInFlight) return { ok: false, reason: "sync_busy" };

  if (opts?.requirePending !== false) {
    const { readSyncQueue } = await import("../offline/localDb");
    const queue = await readSyncQueue();
    if (queue.length === 0 && countUnsyncedSales() === 0) {
      return { ok: false, reason: "no_pending" };
    }
  }

  return { ok: true };
}

/** Fire-and-forget debounced push after checkout — never blocks sale completion. */
export function schedulePushPendingUploads(): void {
  if (postSaleTimer != null) clearTimeout(postSaleTimer);
  postSaleTimer = globalThis.setTimeout(() => {
    postSaleTimer = null;
    void runPosPushOnlyUpload({ source: "post_sale", force: true });
  }, POST_SALE_DEBOUNCE_MS);
}

/** Push pending sales + drain sync queue — no cloud pull. */
export async function runPosPushOnlyUpload(opts?: {
  source?: string;
  force?: boolean;
}): Promise<PosPushUploadResult> {
  if (pushInFlight) {
    return { ran: false, skipped: true, skipReason: "sync_busy", pushOk: 0, pushFail: 0, queueFailed: 0 };
  }
  const now = Date.now();
  if (!opts?.force && now - lastPushStartedAt < MIN_POS_PUSH_GAP_MS) {
    return { ran: false, skipped: true, skipReason: "sync_busy", pushOk: 0, pushFail: 0, queueFailed: 0 };
  }

  const gate = await canRunPosPushUpload({ requirePending: !opts?.force });
  if (!gate.ok) {
    writeSyncHealthMeta({ lastPosPushSkipReason: gate.reason, posPushUploadActive: false });
    return { ran: false, skipped: true, skipReason: gate.reason, pushOk: 0, pushFail: 0, queueFailed: 0 };
  }

  if (pushInFlight) {
    return { ran: false, skipped: true, skipReason: "sync_busy", pushOk: 0, pushFail: 0, queueFailed: 0 };
  }

  pushInFlight = true;
  lastPushStartedAt = now;
  recordPosPushAttempt();

  try {
    const { pushShopPendingToCloud } = await import("../offline/cloudSync");
    const { push, queueFailed } = await pushShopPendingToCloud();
    recordPosPushSuccess(push.ok, push.fail, queueFailed);
    const attemptAt = new Date().toISOString();
    if (push.fail === 0 && queueFailed === 0) {
      writeSyncHealthMeta({
        lastSuccessAt: attemptAt,
        lastIssueCode: "none",
        lastIssueAt: null,
      });
    } else if (push.fail > 0 || queueFailed > 0) {
      writeSyncHealthMeta({ lastIssueAt: attemptAt, lastIssueCode: "partial" });
    }
    return {
      ran: true,
      skipped: false,
      pushOk: push.ok,
      pushFail: push.fail,
      queueFailed,
    };
  } catch {
    recordPosPushFailure();
    return { ran: true, skipped: false, pushOk: 0, pushFail: 1, queueFailed: 0 };
  } finally {
    pushInFlight = false;
    writeSyncHealthMeta({ posPushUploadActive: false });
  }
}
