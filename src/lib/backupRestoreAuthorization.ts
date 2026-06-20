/**
 * Authorization for full-shop backup restore (JSON envelope).
 */

import type { SessionActor } from "./sessionActor";
import { canUseBackupRestore, type SubscriptionSnapshot } from "./subscriptionEntitlements";
import { checkStorePermission, type StoreAuthResult } from "./storeAuthorization";

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
  return { ok: true };
}
