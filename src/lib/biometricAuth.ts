/**
 * Native biometric / device credential auth via OS APIs only.
 * No biometric data is stored by Waka POS.
 */

import { Capacitor } from "@capacitor/core";
import {
  BiometricAuth,
  BiometryError,
  BiometryErrorType,
  type CheckBiometryResult,
} from "@aparajita/capacitor-biometric-auth";

export type BiometricCapability = {
  platform: "native" | "web";
  isAvailable: boolean;
  biometryType: CheckBiometryResult["biometryType"];
  deviceIsSecure: boolean;
};

export type NativeBiometricPromptResult =
  | { ok: true }
  | { ok: false; cancelled: boolean; userFallback: boolean; errorKey?: string };

export async function checkBiometricCapability(): Promise<BiometricCapability> {
  const platform = Capacitor.isNativePlatform() ? "native" : "web";
  try {
    const result = await BiometricAuth.checkBiometry();
    return {
      platform,
      isAvailable: Boolean(result.isAvailable),
      biometryType: result.biometryType,
      deviceIsSecure: Boolean(result.deviceIsSecure),
    };
  } catch {
    return {
      platform,
      isAvailable: false,
      biometryType: 0,
      deviceIsSecure: false,
    };
  }
}

export async function promptNativeBiometric(reason: string): Promise<NativeBiometricPromptResult> {
  try {
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: "Cancel",
      allowDeviceCredential: true,
      iosFallbackTitle: "Use PIN",
      androidTitle: "Waka POS",
      androidSubtitle: reason,
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof BiometryError) {
      if (err.code === BiometryErrorType.userCancel) {
        return { ok: false, cancelled: true, userFallback: false };
      }
      if (err.code === BiometryErrorType.userFallback) {
        return { ok: false, cancelled: false, userFallback: true };
      }
      if (err.code === BiometryErrorType.biometryNotAvailable) {
        return { ok: false, cancelled: false, userFallback: true, errorKey: "biometricUnavailable" };
      }
    }
    return { ok: false, cancelled: false, userFallback: false, errorKey: "biometricFailed" };
  }
}
