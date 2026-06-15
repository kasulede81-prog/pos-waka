import { activeStaffCanUnlock, canLockPos } from "./lockPos";
import { usePosStore } from "../store/usePosStore";
import type { ShopPreferences } from "../types";

export function isPosSellPath(pathname: string): boolean {
  return pathname === "/pos" || pathname.startsWith("/pos/");
}

export function canLockAfterSellExit(preferences: Pick<ShopPreferences, "backOfficePin" | "staffAccounts">): boolean {
  return canLockPos(preferences) || activeStaffCanUnlock(preferences.staffAccounts ?? []);
}

/** Require PIN/password again after leaving the sell screen. */
export function lockPosAfterSellExit(): void {
  const prefs = usePosStore.getState().preferences;
  if (!canLockAfterSellExit(prefs)) return;
  usePosStore.getState().setPosLocked(true);
}

export function notifyLeavingSellScreen(fromPathname: string, toPath: string): void {
  if (isPosSellPath(fromPathname) && !isPosSellPath(toPath)) {
    lockPosAfterSellExit();
  }
}
