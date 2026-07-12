import { isShopSecurityPinConfigured } from "./enterpriseSecurity/shopPinSecret";

export function isBackOfficePinConfigured(pin: string | null | undefined): boolean {
  return isShopSecurityPinConfigured(pin);
}

export function activeStaffCanUnlock(accounts: import("../types").ShopPreferences["staffAccounts"]): boolean {
  return (accounts ?? []).some(
    (s) =>
      s.active &&
      ((s.pinHash && s.pinHash.length > 0) ||
        (s.pin && s.pin.replace(/\D/g, "").length >= 4) ||
        (s.passwordHash && s.passwordHash.length > 0) ||
        (s.password && s.password.trim().length > 0)),
  );
}

export function canLockPos(preferences: Pick<import("../types").ShopPreferences, "backOfficePin">): boolean {
  return isBackOfficePinConfigured(preferences.backOfficePin);
}

/** Owner staff/setup screens — do not cover with POS lock overlay (same PIN pad UX). */
export function shouldSuppressPosLockScreen(
  pathname: string,
  canManageShopSettings: boolean,
): boolean {
  if (!canManageShopSettings) return false;
  if (pathname === "/staff-access") return true;
  if (pathname.startsWith("/settings/")) return true;
  if (pathname === "/close-day" || pathname.startsWith("/office/")) return true;
  return false;
}
