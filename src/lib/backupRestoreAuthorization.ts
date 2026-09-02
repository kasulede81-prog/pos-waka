/**
 * Authorization for full-shop backup restore (JSON envelope).
 */

import type { SessionActor } from "./sessionActor";
import { canUseBackupRestore, type SubscriptionSnapshot } from "./subscriptionEntitlements";
import { checkStorePermission, type StoreAuthErrorKey, type StoreAuthResult } from "./storeAuthorization";
import { isDeviceAuthorizedForManagementSync } from "./deviceAuthority";

/** User JSON import vs system cloud recovery bootstrap on a new device. */
export type BackupRestorePurpose = "user_import" | "cloud_recovery";

export function authorizeBackupRestore(input: {
  actor: SessionActor | null;
  snapshot: SubscriptionSnapshot;
  authMode: "supabase" | "local";
  purpose?: BackupRestorePurpose;
}): StoreAuthResult {
  if (input.purpose === "cloud_recovery") {
    return { ok: true };
  }

  const roleCheck = checkStorePermission(input.actor, "settings.shop");
  if (!roleCheck.ok) return roleCheck;
  if (!canUseBackupRestore(input.snapshot, input.authMode)) {
    return { ok: false, errorKey: "backupRestoreNotEntitled" };
  }
  if (input.authMode === "supabase" && !isDeviceAuthorizedForManagementSync()) {
    return { ok: false, errorKey: "deviceNotAuthorized" };
  }
  return { ok: true };
}

/** Map store auth failures to existing i18n keys (never pretend the file was unreadable). */
export function backupSurfaceDeniedMessageKey(
  errorKey: StoreAuthErrorKey | undefined,
  fallback: "backupExportFail" | "backupRestoreFail",
): "backupUpgradeRequired" | "deviceNotAuthorized" | "forbidden" | "backupExportFail" | "backupRestoreFail" {
  if (errorKey === "backupRestoreNotEntitled") return "backupUpgradeRequired";
  if (errorKey === "deviceNotAuthorized") return "deviceNotAuthorized";
  if (errorKey === "forbidden" || errorKey === "noSelection") return "forbidden";
  return fallback;
}

export async function authorizeBackupRestoreAsync(input: {
  actor: SessionActor | null;
  snapshot: SubscriptionSnapshot;
  authMode: "supabase" | "local";
  purpose?: BackupRestorePurpose;
}): Promise<StoreAuthResult> {
  if (input.purpose === "cloud_recovery") {
    return { ok: true };
  }
  const base = authorizeBackupRestore(input);
  if (!base.ok) return base;
  if (input.authMode === "supabase") {
    const { canPerformDeviceAuthorizedAction } = await import("./deviceAuthority");
    const allowed = await canPerformDeviceAuthorizedAction("backup_import");
    if (!allowed) return { ok: false, errorKey: "deviceNotAuthorized" };
  }
  return { ok: true };
}
