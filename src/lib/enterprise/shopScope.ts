import { getActiveAccountKey } from "../../offline/accountScope";

/**
 * Shop-scoped account key foundation for multi-branch devices.
 * Legacy single-shop: returns base account key unchanged (backward compatible).
 */
export function shopScopedAccountKey(shopId: string | null | undefined): string | null {
  const base = getActiveAccountKey();
  if (!base) return null;
  if (!shopId) return base;
  if (base.includes(`:${shopId}`)) return base;
  return `${base}:${shopId}`;
}

export function parseShopIdFromAccountKey(key: string): string | null {
  const parts = key.split(":");
  const last = parts[parts.length - 1];
  if (last && /^[0-9a-f-]{36}$/i.test(last)) return last;
  return null;
}

export function isLegacySingleShopAccountKey(key: string): boolean {
  return parseShopIdFromAccountKey(key) === null;
}
