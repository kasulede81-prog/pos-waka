/**
 * Staff credential recovery orchestration (Phase 21.9).
 * Mirrors Shop Security PIN recovery triggers without changing auth architecture.
 */

import { getDeviceOnline } from "./deviceOnline";
import { logStaffRecoveryStep } from "./staffCredentialRecoveryDiagnostics";

export type StaffCredentialRecoveryTrigger =
  | "app_launch"
  | "app_resume"
  | "owner_login"
  | "cloud_reconnect"
  | "background_sync"
  | "staff_login";

const OWNER_NOTICE_KEY = "waka.staff.recovery.ownerNotice.v1";
const STAFF_NOTICE_KEY = "waka.staff.recovery.staffNotice.v1";

function scopedKey(prefix: string, shopId: string): string {
  return `${prefix}::${shopId}`;
}

function getStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  if (typeof localStorage !== "undefined") return localStorage;
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  return null;
}

export function setStaffCredentialRecoveryOwnerNotice(shopId: string, clearedAt: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(scopedKey(OWNER_NOTICE_KEY, shopId), clearedAt);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("waka:staff-credential-recovery", { detail: { shopId, clearedAt, audience: "owner" } }),
      );
    }
  } catch {
    /* ignore */
  }
}

export function peekStaffCredentialRecoveryOwnerNotice(shopId: string): string | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    return storage.getItem(scopedKey(OWNER_NOTICE_KEY, shopId));
  } catch {
    return null;
  }
}

export function dismissStaffCredentialRecoveryOwnerNotice(shopId: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(scopedKey(OWNER_NOTICE_KEY, shopId));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("waka:staff-credential-recovery-dismissed", { detail: { shopId } }));
    }
  } catch {
    /* ignore */
  }
}

export function setStaffCredentialRecoveryStaffNotice(shopId: string, clearedAt: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(scopedKey(STAFF_NOTICE_KEY, shopId), clearedAt);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("waka:staff-credential-recovery", { detail: { shopId, clearedAt, audience: "staff" } }),
      );
    }
  } catch {
    /* ignore */
  }
}

export function peekStaffCredentialRecoveryStaffNotice(shopId: string): string | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    return storage.getItem(scopedKey(STAFF_NOTICE_KEY, shopId));
  } catch {
    return null;
  }
}

export function dismissStaffCredentialRecoveryStaffNotice(shopId: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(scopedKey(STAFF_NOTICE_KEY, shopId));
  } catch {
    /* ignore */
  }
}

export type StaffCredentialRecoveryCycleResult = {
  applied: boolean;
  affectedStaffCount: number;
  requiresStaffSetup: boolean;
};

export function staffAccountNeedsCredentialSetup(staff: {
  active?: boolean;
  pinHash?: string | null;
  passwordHash?: string | null;
  pin?: string | null;
  password?: string | null;
  credentialsInvalidatedAt?: string | null;
}): boolean {
  if (staff.active === false) return false;
  if (staff.credentialsInvalidatedAt) return true;
  const hasSecret = Boolean(
    staff.pinHash?.trim() ||
      staff.passwordHash?.trim() ||
      staff.pin?.trim() ||
      staff.password?.trim(),
  );
  return !hasSecret;
}

export async function runStaffCredentialRecoveryCycle(
  shopId: string,
  reason: StaffCredentialRecoveryTrigger,
): Promise<StaffCredentialRecoveryCycleResult> {
  if (!shopId) return { applied: false, affectedStaffCount: 0, requiresStaffSetup: false };

  logStaffRecoveryStep("recovery_detected", { shopId, reason });

  const { applyAdminStaffCredentialsClear } = await import("./shopRecoverySignals");
  const result = await applyAdminStaffCredentialsClear(shopId, reason);

  if (result.applied) {
    logStaffRecoveryStep("local_cache_cleared", { shopId, reason, affectedStaffCount: result.affectedStaffCount });
    setStaffCredentialRecoveryOwnerNotice(shopId, result.clearedAt);
    setStaffCredentialRecoveryStaffNotice(shopId, result.clearedAt);
  }

  if (getDeviceOnline()) {
    const { refreshStaffCacheBackground } = await import("./staffCacheSync");
    void refreshStaffCacheBackground({ force: true }).catch(() => undefined);
  } else if (result.applied) {
    logStaffRecoveryStep("offline_recovery_applied", { shopId, reason });
  }

  const { usePosStore } = await import("../store/usePosStore");
  const staff = usePosStore.getState().preferences.staffAccounts ?? [];
  const requiresStaffSetup =
    result.applied || staff.some((row) => row.active && staffAccountNeedsCredentialSetup(row));

  if (requiresStaffSetup) {
    logStaffRecoveryStep("credential_reset_required", { shopId, reason });
  }

  return {
    applied: result.applied,
    affectedStaffCount: result.affectedStaffCount,
    requiresStaffSetup,
  };
}

export async function ensureStaffCredentialRecovery(
  reason: StaffCredentialRecoveryTrigger = "app_launch",
): Promise<StaffCredentialRecoveryCycleResult> {
  const { hasSupabaseConfig, supabase } = await import("./supabase");
  if (!hasSupabaseConfig || !supabase) {
    return { applied: false, affectedStaffCount: 0, requiresStaffSetup: false };
  }

  const { resolveShopCtx } = await import("../offline/cloudSync");
  const ctx = await resolveShopCtx();
  if (!ctx?.shopId) {
    return { applied: false, affectedStaffCount: 0, requiresStaffSetup: false };
  }

  return runStaffCredentialRecoveryCycle(ctx.shopId, reason);
}

let recoveryInFlight: Promise<StaffCredentialRecoveryCycleResult> | null = null;

export function scheduleStaffCredentialRecovery(
  reason: StaffCredentialRecoveryTrigger,
): Promise<StaffCredentialRecoveryCycleResult> {
  if (recoveryInFlight) return recoveryInFlight;
  recoveryInFlight = ensureStaffCredentialRecovery(reason).finally(() => {
    recoveryInFlight = null;
  });
  return recoveryInFlight;
}
