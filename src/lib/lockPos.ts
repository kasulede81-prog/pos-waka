import type { ShopPreferences } from "../types";

export function isBackOfficePinConfigured(pin: string | null | undefined): boolean {
  return (pin ?? "").replace(/\D/g, "").length >= 4;
}

export function activeStaffCanUnlock(accounts: ShopPreferences["staffAccounts"]): boolean {
  return (accounts ?? []).some(
    (s) =>
      s.active &&
      ((s.pinHash && s.pinHash.length > 0) ||
        (s.pin && s.pin.replace(/\D/g, "").length >= 4) ||
        (s.passwordHash && s.passwordHash.length > 0) ||
        (s.password && s.password.trim().length > 0)),
  );
}

export function canLockPos(preferences: Pick<ShopPreferences, "backOfficePin">): boolean {
  return isBackOfficePinConfigured(preferences.backOfficePin);
}
