import type { ShopPreferences } from "../types";
import { isBackOfficePinConfigured } from "./lockPos";
import { isBackOfficePinRequired } from "./backOfficeUnlock";

/** Actions that may require biometric or Owner PIN when enabled in settings. */
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

let sessionExpiresAt: number | null = null;

export function isSensitiveActionSessionActive(): boolean {
  return sessionExpiresAt !== null && sessionExpiresAt > Date.now();
}

export function grantSensitiveActionSession(): void {
  sessionExpiresAt = Date.now() + SENSITIVE_ACTION_SESSION_MS;
}

export function clearSensitiveActionSession(): void {
  sessionExpiresAt = null;
}

export function sensitiveActionSessionMsRemaining(): number {
  if (!sessionExpiresAt) return 0;
  return Math.max(0, sessionExpiresAt - Date.now());
}

export function isBiometricAuthFeatureEnabled(preferences: Pick<ShopPreferences, "biometricAuthEnabled">): boolean {
  return preferences.biometricAuthEnabled === true;
}

export function canEnableBiometricAuth(preferences: Pick<ShopPreferences, "backOfficePin">): boolean {
  return isBackOfficePinConfigured(preferences.backOfficePin);
}

/** Owner PIN (Back Office PIN) — permanent backup; never stores biometrics. */
export function verifyOwnerPin(pin: string, preferences: Pick<ShopPreferences, "backOfficePin">): boolean {
  const stored = preferences.backOfficePin?.trim() ?? "";
  if (!stored) return false;
  return pin.replace(/\D/g, "") === stored.replace(/\D/g, "");
}

export function shouldPromptForSensitiveAction(
  preferences: Pick<ShopPreferences, "biometricAuthEnabled">,
): boolean {
  if (!isBiometricAuthFeatureEnabled(preferences)) return false;
  return !isSensitiveActionSessionActive();
}

/** Back Office PIN unlock covers sensitive routes for the same session — avoids double prompts. */
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
