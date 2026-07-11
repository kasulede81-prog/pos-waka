import type { ShopPreferences } from "../../../types";
import type { InventoryViewPreference } from "./types";

const VALID: InventoryViewPreference[] = ["auto", "card", "compact", "table"];

export function readInventoryViewPreference(preferences: ShopPreferences): InventoryViewPreference {
  const raw = preferences.inventoryViewPreference;
  if (raw && VALID.includes(raw)) return raw;
  return "auto";
}

export function writeInventoryViewPreference(
  _preferences: ShopPreferences,
  preference: InventoryViewPreference,
): Partial<ShopPreferences> {
  return { inventoryViewPreference: preference };
}
