/**
 * Cached shop id for inventory movement namespace (matches server inventory_movement_uuid).
 * Falls back to account key for offline-only sessions.
 */

import { getActiveAccountKey } from "../offline/accountScope";

let cachedShopId: string | null = null;

export function setCachedShopId(shopId: string | null): void {
  cachedShopId = shopId && shopId.trim().length > 0 ? shopId : null;
}

export function getCachedShopId(): string | null {
  return cachedShopId;
}

/** Stable namespace for deterministic inventory movement ids. */
export function inventoryMovementNamespace(): string {
  return cachedShopId ?? getActiveAccountKey() ?? "local";
}

export function clearCachedShopId(): void {
  cachedShopId = null;
}
