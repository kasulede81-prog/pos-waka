import { getAuthRecoveryUrl } from "./authConfig";
import { hasSupabaseConfig, supabase } from "./supabase";
import type { ShopSecurityPinRecoveryTrigger } from "./shopSecurityPinRecovery";
import { logShopSecurityPinRecoveryStep } from "./shopSecurityPinDiagnostics";
import type { StaffCredentialRecoveryTrigger } from "./staffCredentialRecovery";
import { logStaffRecoveryStep } from "./staffCredentialRecoveryDiagnostics";
import { stripStaffCredentialsForRecovery } from "./staffCredentialRecoveryOps";

const APPLIED_PIN_CLEAR_KEY = "waka.recovery.pinClearApplied.v1";
const APPLIED_STAFF_CLEAR_KEY = "waka.recovery.staffClearApplied.v1";

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

type RecoverySignalsPayload = {
  clear_back_office_pin_at?: string | null;
  clear_staff_credentials_at?: string | null;
  password_reset_requested_at?: string | null;
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
