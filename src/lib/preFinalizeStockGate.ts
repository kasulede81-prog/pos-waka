/**
 * Pre-finalize stock gate: primary register mode + fresh cloud stock pull when online.
 */

import type { SaleLine, ShopPreferences } from "../types";
import { getDeviceOnline } from "./deviceOnline";
import { assertCanFinalizeStockSale } from "./primaryRegisterMode";
import { isLocalStockFresh } from "./stockFreshness";
import { refreshProductStockFromCloud, resolveShopCtx } from "../offline/cloudSync";

export async function gateDraftSaleStockBeforeFinalize(
  preferences: ShopPreferences,
  draftLines: SaleLine[],
): Promise<{ ok: true; stockWasStale?: boolean } | { ok: false; errorKey: string }> {
  const online = getDeviceOnline();
  const stockFreshBefore = isLocalStockFresh();

  const regCheck = assertCanFinalizeStockSale({
    preferences,
    isOnline: online,
    stockFresh: stockFreshBefore,
  });
  if (!regCheck.ok) return regCheck;

  const productIds = draftLines.map((l) => l.productId);
  if (online && productIds.length > 0) {
    const ctx = await resolveShopCtx();
    if (ctx) await refreshProductStockFromCloud(productIds, ctx);
  }

  if (!online && !stockFreshBefore) {
    return { ok: false, errorKey: "staleStockSyncRecommended" };
  }

  return { ok: true, stockWasStale: !stockFreshBefore && online };
}
