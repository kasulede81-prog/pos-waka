/**
 * Authorization for full-shop backup export (JSON envelope).
 */

import type { SessionActor } from "./sessionActor";
import { canUseBackupRestore, type SubscriptionSnapshot } from "./subscriptionEntitlements";
import { checkStorePermission, type StoreAuthResult } from "./storeAuthorization";

export function authorizeBackupExport(input: {
  actor: SessionActor | null;
  snapshot: SubscriptionSnapshot;
  authMode: "supabase" | "local";
}): StoreAuthResult {
  const roleCheck = checkStorePermission(input.actor, "settings.shop");
  if (!roleCheck.ok) return roleCheck;
  if (!canUseBackupRestore(input.snapshot, input.authMode)) {
    return { ok: false, errorKey: "forbidden" };
  }
  return { ok: true };
}
