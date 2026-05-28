/** Waka POS is Uganda-only — all amounts are in shillings. */
export const SHOP_CURRENCY = "UGX" as const;

export function normalizeShopCurrency(_raw?: string | null): typeof SHOP_CURRENCY {
  return SHOP_CURRENCY;
}
