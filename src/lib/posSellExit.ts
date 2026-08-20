import { activeStaffCanUnlock, canLockPos } from "./lockPos";
import { usePosStore } from "../store/usePosStore";
import type { ShopPreferences } from "../types";
import { PHARMACY_DISPENSE_ROUTE } from "./pharmacyNav";
import { isPosAutoLockEnabled } from "./auth/staffSession";

export function isPosSellPath(pathname: string): boolean {
  return (
    pathname === "/pos" ||
    pathname.startsWith("/pos/") ||
    pathname === PHARMACY_DISPENSE_ROUTE
  );
}

export function canLockAfterSellExit(preferences: Pick<ShopPreferences, "backOfficePin" | "staffAccounts">): boolean {
  return canLockPos(preferences) || activeStaffCanUnlock(preferences.staffAccounts ?? []);
}

export function shouldLockAfterSellExit(preferences: ShopPreferences): boolean {
  return isPosAutoLockEnabled(preferences) && canLockAfterSellExit(preferences);
}

/** Require PIN/password again after leaving the sell screen — skipped when Auto-lock is Never. */
export function lockPosAfterSellExit(): void {
  const prefs = usePosStore.getState().preferences;
  if (!shouldLockAfterSellExit(prefs)) return;
  usePosStore.getState().setPosLocked(true);
}

export function notifyLeavingSellScreen(fromPathname: string, toPath: string): void {
  if (isPosSellPath(fromPathname) && !isPosSellPath(toPath)) {
    lockPosAfterSellExit();
  }
}
