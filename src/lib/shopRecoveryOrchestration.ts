/**
 * Unified shop recovery scheduling — Shop Security PIN + staff credentials (Phase 21.9).
 */

import { scheduleShopSecurityPinRecovery, type ShopSecurityPinRecoveryTrigger } from "./shopSecurityPinRecovery";
import { scheduleStaffCredentialRecovery, type StaffCredentialRecoveryTrigger } from "./staffCredentialRecovery";

export type ShopRecoveryTrigger = ShopSecurityPinRecoveryTrigger | StaffCredentialRecoveryTrigger;

function pinRecoveryReason(reason: ShopRecoveryTrigger): ShopSecurityPinRecoveryTrigger {
  if (reason === "staff_login") return "background_sync";
  return reason;
}

function staffRecoveryReason(reason: ShopRecoveryTrigger): StaffCredentialRecoveryTrigger {
  return reason;
}

export async function scheduleShopRecovery(reason: ShopRecoveryTrigger = "app_launch") {
  const [pin, staff] = await Promise.all([
    scheduleShopSecurityPinRecovery(pinRecoveryReason(reason)),
    scheduleStaffCredentialRecovery(staffRecoveryReason(reason)),
  ]);
  return { pin, staff };
}
