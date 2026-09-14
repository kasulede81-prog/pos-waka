import { getAuthRecoveryUrl } from "./authConfig";
import { hasSupabaseConfig, supabase } from "./supabase";
import type { ShopSecurityPinRecoveryTrigger } from "./shopSecurityPinRecovery";
import { logShopSecurityPinRecoveryStep } from "./shopSecurityPinDiagnostics";
import type { StaffCredentialRecoveryTrigger } from "./staffCredentialRecovery";
import { logStaffRecoveryStep } from "./staffCredentialRecoveryDiagnostics";
import { stripStaffCredentialsForRecovery } from "./staffCredentialRecoveryOps";

const APPLIED_PIN_CLEAR_KEY = "waka.recovery.pinClearApplied.v1";
const APPLIED_STAFF_CLEAR_KEY = "waka.recovery.staffClearApplied.v1";
const APPLIED_FORCE_RESYNC_KEY = "waka.recovery.forceFullResyncApplied.v1";

function appliedPinClearKey(shopId: string): string {
  return `${APPLIED_PIN_CLEAR_KEY}::${shopId}`;
}

function appliedStaffClearKey(shopId: string): string {
  return `${APPLIED_STAFF_CLEAR_KEY}::${shopId}`;
}

function readAppliedPinClearAt(shopId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(appliedPinClearKey(shopId));
  } catch {
    return null;
  }
}

function writeAppliedPinClearAt(shopId: string, at: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(appliedPinClearKey(shopId), at);
  } catch {
    /* ignore */
  }
}

function readAppliedStaffClearAt(shopId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(appliedStaffClearKey(shopId));
  } catch {
    return null;
  }
}

function writeAppliedStaffClearAt(shopId: string, at: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(appliedStaffClearKey(shopId), at);
  } catch {
    /* ignore */
  }
}

function appliedForceResyncKey(shopId: string): string {
  return `${APPLIED_FORCE_RESYNC_KEY}::${shopId}`;
}

function readAppliedForceResyncAt(shopId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(appliedForceResyncKey(shopId));
  } catch {
    return null;
  }
}

function writeAppliedForceResyncAt(shopId: string, at: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(appliedForceResyncKey(shopId), at);
  } catch {
    /* ignore */
  }
}

type RecoverySignalsPayload = {
  clear_back_office_pin_at?: string | null;
  clear_staff_credentials_at?: string | null;
  password_reset_requested_at?: string | null;
  force_full_resync_at?: string | null;
};

async function fetchRecoverySignalsPayload(shopId: string): Promise<RecoverySignalsPayload | null> {
  if (!hasSupabaseConfig || !supabase) return null;
  const rpc = supabase.rpc("shop_fetch_recovery_signal", { p_shop_id: shopId });
  const { data, error } = await Promise.race([
    rpc,
    new Promise<{ data: null; error: { message: string } }>((resolve) => {
      setTimeout(() => resolve({ data: null, error: { message: "timeout" } }), 4_000);
    }),
  ]);
  if (error || !data || typeof data !== "object") return null;
  return data as RecoverySignalsPayload;
}

/**
 * Apply server-side admin Shop Security PIN clear on this device.
 * Bypasses setPreferences auth — support recovery must always win over local session role.
 */
export async function applyAdminBackOfficePinClear(
  shopId: string,
  clearedAt: string,
  reason?: ShopSecurityPinRecoveryTrigger,
): Promise<boolean> {
  const lastApplied = readAppliedPinClearAt(shopId);
  if (lastApplied === clearedAt) return false;

  const { clearLegacySensitiveSession, clearSecuritySession } = await import(
    "./enterpriseSecurity/securitySession"
  );
  clearSecuritySession();
  clearLegacySensitiveSession();

  const { flushPendingPersist, usePosStore } = await import("../store/usePosStore");
  usePosStore.setState((s) => ({
    preferences: {
      ...s.preferences,
      backOfficePin: null,
    },
  }));

  usePosStore.getState().logAuditAction("admin_pin_clear_applied", "Shop Security PIN cleared by support recovery", {
    shopId,
    clearedAt,
    recoveryReason: reason ?? "recovery_signal",
    recoveryCompleted: true,
    recoveryAppliedOnDevice: true,
  });

  writeAppliedPinClearAt(shopId, clearedAt);
  flushPendingPersist();

  const { applyShopSecurityPinRecoveryClear } = await import("./shopSecurityPinSync");
  applyShopSecurityPinRecoveryClear(shopId);

  const { blockShopSecurityPinMigration, setShopSecurityPinRecoveryNotice } = await import(
    "./shopSecurityPinRecovery"
  );
  blockShopSecurityPinMigration(shopId, "admin_clear");
  setShopSecurityPinRecoveryNotice(shopId, clearedAt);

  logShopSecurityPinRecoveryStep("local_cache_cleared", { shopId, reason: reason ?? "recovery_signal" });

  void import("./cloudSnapshotSync").then(({ uploadShopCloudSnapshot }) => {
    void uploadShopCloudSnapshot({ force: true });
  });

  return true;
}

/**
 * Apply server-side admin bulk staff credential reset on this device.
 * Clears local staff hashes, sessions, and encrypted cache — not owner auth or Shop Security PIN.
 */
export async function applyAdminStaffCredentialsClear(
  shopId: string,
  reason?: StaffCredentialRecoveryTrigger,
  clearedAtOverride?: string,
): Promise<{ applied: boolean; clearedAt: string; affectedStaffCount: number }> {
  let clearedAt = (clearedAtOverride ?? "").trim();
  if (!clearedAt) {
    const payload = await fetchRecoverySignalsPayload(shopId);
    clearedAt = String(payload?.clear_staff_credentials_at ?? "").trim();
  }
  if (!clearedAt) {
    return { applied: false, clearedAt: "", affectedStaffCount: 0 };
  }

  const lastApplied = readAppliedStaffClearAt(shopId);
  if (lastApplied === clearedAt) {
    return { applied: false, clearedAt, affectedStaffCount: 0 };
  }

  logStaffRecoveryStep("cloud_invalidation", { shopId, reason: reason ?? "recovery_signal" });

  const { clearLegacySensitiveSession, clearSecuritySession } = await import(
    "./enterpriseSecurity/securitySession"
  );
  clearSecuritySession();
  clearLegacySensitiveSession();

  const { clearStaffAuth, clearRememberedStaffDevice } = await import("./staffOfflineAuth");
  clearStaffAuth();
  clearRememberedStaffDevice();

  const { clearOfflineStaffCache } = await import("./offlineStaffCache");
  await clearOfflineStaffCache(shopId).catch(() => undefined);

  const { clearStaffUnlockLimiter } = await import("./auth/staffLoginLimiter");
  clearStaffUnlockLimiter();

  const { flushPendingPersist, usePosStore } = await import("../store/usePosStore");
  const beforeStaff = usePosStore.getState().preferences.staffAccounts ?? [];
  const affectedStaffCount = beforeStaff.filter((row) => row.active).length;

  usePosStore.setState((s) => ({
    preferences: {
      ...s.preferences,
      staffAccounts: stripStaffCredentialsForRecovery(s.preferences.staffAccounts ?? [], clearedAt),
    },
  }));

  usePosStore.getState().logAuditAction(
    "admin_staff_credentials_clear_applied",
    "Staff credentials cleared by support recovery",
    {
      shopId,
      clearedAt,
      recoveryReason: reason ?? "recovery_signal",
      affectedStaffCount,
      recoveryCompleted: true,
      recoveryAppliedOnDevice: true,
    },
  );

  writeAppliedStaffClearAt(shopId, clearedAt);
  flushPendingPersist();

  logStaffRecoveryStep("local_cache_cleared", { shopId, reason: reason ?? "recovery_signal", affectedStaffCount });

  void import("./cloudSnapshotSync").then(({ uploadShopCloudSnapshot }) => {
    void uploadShopCloudSnapshot({ force: true });
  });

  return { applied: true, clearedAt, affectedStaffCount };
}

/**
 * Apply an admin "reset shop business data" signal on this device: instead of
 * replaying whatever sales/products/etc. are still cached locally, force a
 * fresh full pull from cloud (which will now come back empty/near-empty,
 * since the server-side reset already ran). Mirrors applyAdminBackOfficePinClear
 * / applyAdminStaffCredentialsClear's dedupe-by-timestamp shape.
 */
export async function applyAdminForceFullResync(
  shopId: string,
  signalAt: string,
  reason?: string,
): Promise<boolean> {
  const lastApplied = readAppliedForceResyncAt(shopId);
  if (lastApplied === signalAt) return false;

  // `pullShopDataFromCloud` only fetches and returns a CloudPullResult — it
  // never touches the store. `pullCloudAndMergeIntoStore` is the caller that
  // actually merges that result into `usePosStore` via `setState`. Calling
  // the former here silently fetched-and-discarded the reset shop's (now
  // empty) server state and never updated the local store at all.
  const { pullCloudAndMergeIntoStore } = await import("../offline/cloudSync");
  const merged = await pullCloudAndMergeIntoStore({
    forceFull: true,
    pullReason: reason ?? "admin_shop_reset_signal",
  });
  // Never mark this signal "applied" on a failed pull (network error,
  // organization check failure, store not hydrated, etc.) — doing so would
  // permanently stop retrying the authoritative full pull AND disarm the
  // outbox (Step 6) and snapshot (Step 5) guards while local state is still
  // the stale pre-reset data. Leaving the signal outstanding lets the next
  // boot/flush try again.
  if (!merged) return false;

  writeAppliedForceResyncAt(shopId, signalAt);

  const { usePosStore } = await import("../store/usePosStore");
  usePosStore.getState().logAuditAction(
    "admin_shop_reset_resync_applied",
    "Fresh full sync applied after admin business-data reset",
    { shopId, signalAt, recoveryReason: reason ?? "admin_shop_reset_signal", recoveryAppliedOnDevice: true },
  );

  return true;
}

/**
 * Read-only: the shop's current `force_full_resync_at`, but only when THIS
 * device has not yet applied it (same dedupe check `applyAdminForceFullResync`
 * uses). Returns null when there is no signal, this device already
 * acknowledged it, OR the lookup itself failed/timed out — i.e. null means
 * "no *confirmed* outstanding signal," not "confirmed safe."
 *
 * Used to gate outbox drains (Step 6), where that ambiguity is the SAFE
 * default: failing to detect a signal here costs at most one op that gets
 * pushed and is corrected by the next authoritative full pull, whereas
 * treating a lookup failure as "there IS a cutoff" with no known timestamp
 * would force dropping every guarded-kind op in the queue — real,
 * unrecoverable data loss for a merely transient check failure.
 *
 * Do NOT reuse this for anything that publishes local state outward (see
 * `canPublishShopCloudSnapshot` below) — there, the same ambiguity must fail
 * closed instead.
 */
export async function staleForceFullResyncCutoff(shopId: string): Promise<string | null> {
  if (!hasSupabaseConfig || !supabase) return null;
  const payload = await fetchRecoverySignalsPayload(shopId);
  if (!payload) return null;
  const forceResyncAt = String(payload.force_full_resync_at ?? "").trim();
  if (!forceResyncAt) return null;
  const lastApplied = readAppliedForceResyncAt(shopId);
  return lastApplied === forceResyncAt ? null : forceResyncAt;
}

/** True when this device has a *confirmed* outstanding, unacknowledged admin reset signal (see caveat on `staleForceFullResyncCutoff`). */
export async function hasUnacknowledgedForceFullResync(shopId: string): Promise<boolean> {
  return (await staleForceFullResyncCutoff(shopId)) !== null;
}

/**
 * Snapshot-publish safety check (Step 5). Unlike `hasUnacknowledgedForceFullResync`
 * above, this must fail CLOSED: `uploadShopCloudSnapshot` re-seeds
 * `shop_cloud_snapshots`, which `restoreShopFromCloudSnapshot` hands to any
 * other device that restores from it. A device that cannot currently confirm
 * "no outstanding reset signal" must not publish — the cost of skipping one
 * upload cycle is near zero (it retries on the next call, at most
 * `MIN_UPLOAD_INTERVAL_MS` later), while wrongly publishing a stale,
 * pre-reset snapshot can resurrect the old business data on every device
 * that later restores from it.
 *
 * Does its own direct RPC call (rather than reusing
 * `staleForceFullResyncCutoff`) specifically so a network error or timeout
 * resolves `false` here instead of being folded into "no signal."
 */
export async function canPublishShopCloudSnapshot(shopId: string): Promise<boolean> {
  if (!hasSupabaseConfig || !supabase) return true;
  try {
    const rpc = supabase.rpc("shop_fetch_recovery_signal", { p_shop_id: shopId });
    const { data, error } = await Promise.race([
      rpc,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("recovery_signal_check_timeout")), 4_000);
      }),
    ]);
    if (error) throw new Error(typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : "recovery_signal_check_failed");
    if (!data || typeof data !== "object") return true;
    const forceResyncAt = String((data as Record<string, unknown>).force_full_resync_at ?? "").trim();
    if (!forceResyncAt) return true;
    return readAppliedForceResyncAt(shopId) === forceResyncAt;
  } catch {
    return false;
  }
}

/**
 * Boot-time gate (Step 3): check for — and apply — an outstanding admin
 * force-full-resync signal for the active shop, BEFORE the caller lets stale
 * locally-hydrated business data become visible. Narrow on purpose: unlike
 * `ensureShopRecoveryApplied`, this does not also run PIN/staff-credential
 * recovery, so it is cheap and safe to call unconditionally very early in
 * boot. Fails closed (returns false) on any error/timeout/offline — the
 * caller must never let this block app startup.
 */
export async function applyPendingForceFullResyncForCurrentShop(): Promise<boolean> {
  if (!hasSupabaseConfig || !supabase) return false;
  try {
    const { resolveShopCtx } = await import("../offline/cloudSync");
    const ctx = await resolveShopCtx();
    if (!ctx) return false;

    const rpc = supabase.rpc("shop_fetch_recovery_signal", { p_shop_id: ctx.shopId });
    const { data, error } = await Promise.race([
      rpc,
      new Promise<{ data: null; error: { message: string } }>((resolve) => {
        setTimeout(() => resolve({ data: null, error: { message: "timeout" } }), 4_000);
      }),
    ]);
    if (error || !data || typeof data !== "object") return false;

    const forceResyncAt = String((data as Record<string, unknown>).force_full_resync_at ?? "").trim();
    if (!forceResyncAt) return false;

    return await applyAdminForceFullResync(ctx.shopId, forceResyncAt, "app_boot_gate");
  } catch {
    return false;
  }
}

/** Apply server-side admin Shop Security PIN clear on this device (after cloud sync / login). */
export async function applyShopRecoverySignalsForCurrentShop(
  reason?: ShopSecurityPinRecoveryTrigger,
): Promise<boolean> {
  if (!hasSupabaseConfig || !supabase) return false;

  const { resolveShopCtx } = await import("../offline/cloudSync");
  const ctx = await resolveShopCtx();
  if (!ctx) return false;

  return applyShopRecoverySignalsForShop(ctx.shopId, reason);
}

/** Fetch and apply recovery signals for a shop — safe to call before cloud pull. */
export async function applyShopRecoverySignalsForShop(
  shopId: string,
  reason?: ShopSecurityPinRecoveryTrigger,
): Promise<boolean> {
  if (!hasSupabaseConfig || !supabase) return false;

  const payload = await fetchRecoverySignalsPayload(shopId);
  if (!payload) return false;

  let applied = false;
  const pinClearedAt = String(payload.clear_back_office_pin_at ?? "").trim();
  if (pinClearedAt) {
    applied = (await applyAdminBackOfficePinClear(shopId, pinClearedAt, reason)) || applied;
  }

  const staffClearedAt = String(payload.clear_staff_credentials_at ?? "").trim();
  if (staffClearedAt) {
    const staffResult = await applyAdminStaffCredentialsClear(shopId, reason as StaffCredentialRecoveryTrigger, staffClearedAt);
    applied = staffResult.applied || applied;
  }

  const forceResyncAt = String(payload.force_full_resync_at ?? "").trim();
  if (forceResyncAt) {
    applied = (await applyAdminForceFullResync(shopId, forceResyncAt, reason)) || applied;
  }

  return applied;
}

/** Proactive check on app load / unlock screens — does not require full sync. */
export async function ensureShopRecoveryApplied(
  reason?: ShopSecurityPinRecoveryTrigger,
): Promise<boolean> {
  const { scheduleShopRecovery } = await import("./shopRecoveryOrchestration");
  const result = await scheduleShopRecovery(reason ?? "app_launch");
  return result.pin.applied || result.staff.applied;
}

/** Send Supabase password recovery email to shop owner (after admin RPC audit). */
export async function sendOwnerPasswordResetEmail(ownerEmail: string): Promise<{ ok: boolean; message?: string }> {
  if (!hasSupabaseConfig || !supabase) {
    return { ok: false, message: "Offline" };
  }
  const email = ownerEmail.trim().toLowerCase();
  if (!email.includes("@")) return { ok: false, message: "Invalid owner email." };

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: getAuthRecoveryUrl(),
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
