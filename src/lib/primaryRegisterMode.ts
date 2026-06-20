/**
 * Primary register mode — optional single-register offline oversell guard.
 */

import type { ShopPreferences } from "../types";
import { getOrCreateDeviceId } from "./deviceId";

export type RegisterMode = "single" | "multi";

export function resolveRegisterMode(preferences: ShopPreferences): RegisterMode {
  const mode = preferences.registerMode;
  if (mode === "single" || mode === "multi") return mode;
  return "multi";
}

export function isPrimaryRegisterDevice(preferences: ShopPreferences): boolean {
  const fp = getOrCreateDeviceId();
  const primary = preferences.primaryDeviceFingerprint?.trim();
  if (!primary) return true;
  return primary === fp;
}

export function assertCanFinalizeStockSale(input: {
  preferences: ShopPreferences;
  isOnline: boolean;
  stockFresh: boolean;
}): { ok: true } | { ok: false; errorKey: string } {
  if (resolveRegisterMode(input.preferences) !== "single") return { ok: true };
  if (isPrimaryRegisterDevice(input.preferences)) return { ok: true };
  if (input.isOnline && input.stockFresh) return { ok: true };
  return { ok: false, errorKey: "primaryRegisterSyncRequired" };
}
