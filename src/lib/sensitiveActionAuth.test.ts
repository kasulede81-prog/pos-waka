import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSensitiveActionSession,
  grantSensitiveActionSession,
  isBiometricAuthFeatureEnabled,
  isSensitiveActionSessionActive,
  MAX_BIOMETRIC_FAILURES_BEFORE_PIN,
  sensitiveActionSessionMsRemaining,
  sensitiveAuthSatisfiedByBackOfficeUnlock,
  shouldPromptForSensitiveAction,
  SENSITIVE_ACTION_SESSION_MS,
  verifyOwnerPin,
} from "./sensitiveActionAuth";

describe("sensitiveActionAuth", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearSensitiveActionSession();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("feature is off unless explicitly enabled", () => {
    expect(isBiometricAuthFeatureEnabled({ biometricAuthEnabled: false })).toBe(false);
    expect(isBiometricAuthFeatureEnabled({ biometricAuthEnabled: undefined })).toBe(false);
    expect(isBiometricAuthFeatureEnabled({ biometricAuthEnabled: true })).toBe(true);
  });

  it("grants a 5-minute session", () => {
    expect(isSensitiveActionSessionActive()).toBe(false);
    grantSensitiveActionSession();
    expect(isSensitiveActionSessionActive()).toBe(true);
    expect(sensitiveActionSessionMsRemaining()).toBeLessThanOrEqual(SENSITIVE_ACTION_SESSION_MS);
    vi.advanceTimersByTime(SENSITIVE_ACTION_SESSION_MS + 1);
    expect(isSensitiveActionSessionActive()).toBe(false);
  });

  it("should not prompt when feature disabled or session active", () => {
    expect(shouldPromptForSensitiveAction({ biometricAuthEnabled: false })).toBe(false);
    grantSensitiveActionSession();
    expect(shouldPromptForSensitiveAction({ biometricAuthEnabled: true })).toBe(false);
  });

  it("should prompt when enabled and session expired", () => {
    expect(shouldPromptForSensitiveAction({ biometricAuthEnabled: true })).toBe(true);
  });

  it("verifies owner PIN against backOfficePin", () => {
    expect(verifyOwnerPin("1234", { backOfficePin: "1234" })).toBe(true);
    expect(verifyOwnerPin("12 34", { backOfficePin: "1234" })).toBe(true);
    expect(verifyOwnerPin("9999", { backOfficePin: "1234" })).toBe(false);
    expect(verifyOwnerPin("1234", { backOfficePin: "" })).toBe(false);
  });

  it("requires three biometric failures before PIN fallback constant", () => {
    expect(MAX_BIOMETRIC_FAILURES_BEFORE_PIN).toBe(3);
  });

  it("back office unlock satisfies sensitive auth when pin or biometric is configured", () => {
    expect(
      sensitiveAuthSatisfiedByBackOfficeUnlock(
        { backOfficePin: "1234", biometricAuthEnabled: false },
        false,
      ),
    ).toBe(false);
    expect(
      sensitiveAuthSatisfiedByBackOfficeUnlock(
        { backOfficePin: "1234", biometricAuthEnabled: false },
        true,
      ),
    ).toBe(true);
    expect(
      sensitiveAuthSatisfiedByBackOfficeUnlock(
        { backOfficePin: "", biometricAuthEnabled: true },
        true,
      ),
    ).toBe(true);
  });
});
