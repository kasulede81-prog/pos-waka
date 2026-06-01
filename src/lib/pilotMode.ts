import type { ShopPreferences, UserRole } from "../types";

/** Owners may enable pilot mode for extra diagnostics (no sale logic changes). */
export function canTogglePilotMode(role: UserRole): boolean {
  return role === "owner";
}

export function isPilotModeActive(role: UserRole, preferences: ShopPreferences): boolean {
  return Boolean(preferences.pilotModeEnabled) && canTogglePilotMode(role);
}
