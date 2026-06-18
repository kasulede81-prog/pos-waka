import type { StaffAccount } from "../types";
import { maxStaffAccountsForTier, type SubscriptionPlanCode } from "./subscriptionEntitlements";
import type { StoreAuthResult } from "./storeAuthorization";

/**
 * Block net-new staff rows when the plan cap is reached.
 * Updates to existing staff and restore merges that do not add IDs are allowed.
 */
export function validateStaffAccountsPatch(
  current: readonly StaffAccount[],
  next: readonly StaffAccount[],
  tier: SubscriptionPlanCode,
): StoreAuthResult {
  const max = maxStaffAccountsForTier(tier);
  const currentIds = new Set(current.map((s) => s.id));
  const newRows = next.filter((s) => !currentIds.has(s.id));
  if (newRows.length === 0) return { ok: true };
  if (max <= 0) return { ok: false, errorKey: "planStaffLimit" };
  if (next.length > max) return { ok: false, errorKey: "planStaffLimit" };
  return { ok: true };
}

export function validateCanAddStaffAccount(
  currentCount: number,
  tier: SubscriptionPlanCode,
): StoreAuthResult {
  const max = maxStaffAccountsForTier(tier);
  if (max <= 0) return { ok: false, errorKey: "planStaffLimit" };
  if (currentCount >= max) return { ok: false, errorKey: "planStaffLimit" };
  return { ok: true };
}
