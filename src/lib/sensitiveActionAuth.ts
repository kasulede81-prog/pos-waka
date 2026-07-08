import type { ShopPreferences } from "../types";
import { isBackOfficePinRequired } from "./backOfficeUnlock";
import {
  clearSecuritySession,
  createSecuritySession,
  getSecuritySession,
  grantLegacySensitiveSession,
  isLegacySensitiveSessionActive,
  isSecuritySessionActive,
  refreshSecuritySession,
  securitySessionMsRemaining,
  clearLegacySensitiveSession,
} from "./enterpriseSecurity/securitySession";
import { verifyManagerApprovalPinSync } from "./enterpriseSecurity/EnterpriseSecurityService";
import { isShopPinConfigured } from "./enterpriseSecurity/EnterpriseSecurityService";

/** Actions that may require biometric or security PIN when enabled in settings. */
export type SensitiveActionKind =
  | "refund_sale"
  | "void_sale"
  | "delete_transaction"
  | "access_reports"
  | "change_settings"
  | "manage_users"
  | "export_data";

export const SENSITIVE_ACTION_SESSION_MS = 5 * 60 * 1000;
export const MAX_BIOMETRIC_FAILURES_BEFORE_PIN = 3;

export function isSensitiveActionSessionActive(): boolean {
  return isSecuritySessionActive();
}

export function grantSensitiveActionSession(): void {
  if (getSecuritySession()) {
    refreshSecuritySession();
    return;
  }
  grantLegacySensitiveSession();
}

export function clearSensitiveActionSession(): void {
  clearSecuritySession();
}

export function sensitiveActionSessionMsRemaining(): number {
  return securitySessionMsRemaining();
}

export function isBiometricAuthFeatureEnabled(
  preferences: Pick<ShopPreferences, "biometricAuthEnabled">,
): boolean {
  return preferences.biometricAuthEnabled === true;
}

export function canEnableBiometricAuth(preferences: Pick<ShopPreferences, "backOfficePin">): boolean {
  return isShopPinConfigured(preferences);
}

/**
 * @deprecated Use verifyManagerApprovalPin / verifyManagerApprovalPinSync from enterpriseSecurity.
 * Sync verification — staff PIN (legacy) or shop security PIN (legacy plaintext).
 */
export function verifyOwnerPin(
  pin: string,
  preferences: Pick<ShopPreferences, "backOfficePin" | "staffAccounts">,
): boolean {
  return verifyManagerApprovalPinSync(pin, preferences as ShopPreferences);
}

export function shouldPromptForSensitiveAction(
  preferences: Pick<ShopPreferences, "biometricAuthEnabled">,
): boolean {
  if (!isBiometricAuthFeatureEnabled(preferences)) return false;
  return !isSensitiveActionSessionActive();
}

/** Enterprise session covers sensitive routes after back-office unlock — avoids double prompts. */
export function sensitiveAuthSatisfiedByBackOfficeUnlock(
  preferences: {
    backOfficePin?: string | null;
    staffAccounts?: ShopPreferences["staffAccounts"];
    biometricAuthEnabled?: boolean;
  },
  backOfficeUnlocked: boolean,
): boolean {
  if (!backOfficeUnlocked) return false;
  return isBackOfficePinRequired(preferences) || isBiometricAuthFeatureEnabled(preferences);
}

export function grantSecuritySessionForScope(
  scope: SensitiveActionKind | "back_office_shell" | "all",
  deviceId: string,
  user: import("./enterpriseSecurity/types").VerifiedSecurityUser,
  credential: import("./enterpriseSecurity/types").SecurityCredentialType,
  auditId: string,
): void {
  createSecuritySession({
    scopes: scope === "all" ? "all" : [scope],
    credential,
    user,
    deviceId,
    auditId,
  });
}

export { isSecuritySessionActive, clearLegacySensitiveSession, isLegacySensitiveSessionActive };
