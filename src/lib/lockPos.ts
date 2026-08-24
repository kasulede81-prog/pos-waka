import type { UserRole } from "../types";
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

/**
 * Shared-terminal operators may use Choose seller / PIN lock.
 * Personal Path L staff (cashier/manager email login) must not.
 */
export function isSharedTerminalLockOperator(input: {
  authOperatorRole: UserRole;
  hasPathSStaffSession: boolean;
}): boolean {
  return input.authOperatorRole === "owner" || input.hasPathSStaffSession;
}

/**
 * Whether AppShell should render EnterpriseStaffLockScreen.
 * Shop `posLocked` alone is not enough — personal staff devices may inherit it from cloud.
 */
export function shouldShowEnterpriseStaffLockScreen(input: {
  posLocked: boolean;
  authOperatorRole: UserRole;
  hasPathSStaffSession: boolean;
  pathname: string;
  canManageShopSettings: boolean;
}): boolean {
  if (!input.posLocked) return false;
  if (!isSharedTerminalLockOperator(input)) return false;
  if (shouldSuppressPosLockScreen(input.pathname, input.canManageShopSettings)) return false;
  return true;
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
