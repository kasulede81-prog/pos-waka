/**
 * Cached shop id for inventory movement namespace (matches server inventory_movement_uuid).
 * Falls back to account key for offline-only sessions.
 */

import { getActiveAccountKey } from "../offline/accountScope";

let cachedShopId: string | null = null;

/** Short-lived shop/user context reused by entity pulls in one sync tick. Not a permanent auth cache. */
export type ShopTickCtx = { shopId: string; userId: string };

let tickCtx: ShopTickCtx | null = null;
let tickResolveCount = 0;

export function setCachedShopId(shopId: string | null): void {
  const next = shopId && shopId.trim().length > 0 ? shopId : null;
  if (tickCtx && next && tickCtx.shopId !== next) {
    tickCtx = null;
  }
  if (next == null) tickCtx = null;
  cachedShopId = next;
}

export function getCachedShopId(): string | null {
  return cachedShopId;
}

export function rememberShopCtxForTick(ctx: ShopTickCtx): ShopTickCtx {
  tickCtx = ctx;
  cachedShopId = ctx.shopId;
  return ctx;
}

export function getShopCtxForTick(): ShopTickCtx | null {
  return tickCtx;
}

export function clearShopCtxTick(): void {
  tickCtx = null;
}

/** Resolve once per tick; later callers reuse the same shop/user context. */
export async function consumeOrResolveShopCtx(
  resolve: () => Promise<ShopTickCtx | null>,
): Promise<ShopTickCtx | null> {
  if (tickCtx) return tickCtx;
  tickResolveCount += 1;
  const ctx = await resolve();
  if (!ctx) {
    tickCtx = null;
    cachedShopId = null;
    return null;
  }
  return rememberShopCtxForTick(ctx);
}

export function shopCtxTickResolveCount(): number {
  return tickResolveCount;
}

export function resetShopCtxTickForTests(): void {
  tickCtx = null;
  cachedShopId = null;
  tickResolveCount = 0;
}

/** Stable namespace for deterministic inventory movement ids. */
export function inventoryMovementNamespace(): string {
  return cachedShopId ?? getActiveAccountKey() ?? "local";
}

export function clearCachedShopId(): void {
  cachedShopId = null;
  tickCtx = null;
}
