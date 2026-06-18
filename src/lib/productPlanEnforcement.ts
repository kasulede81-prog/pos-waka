import type { Product } from "../types";
import { lockedProductIds } from "./productPlanLock";
import {
  maxProductsForTier,
  resolveEffectivePlanTier,
  type SubscriptionPlanCode,
  type SubscriptionSnapshot,
} from "./subscriptionEntitlements";
import type { StoreAuthResult } from "./storeAuthorization";

export function resolveStorePlanTier(
  snapshot: SubscriptionSnapshot,
  authMode: "supabase" | "local",
): SubscriptionPlanCode {
  if (authMode === "local") return "waka_plus";
  return resolveEffectivePlanTier(snapshot);
}

/** Reject creating a product when the plan product cap is reached. */
export function validateCanAddProduct(
  productCount: number,
  tier: SubscriptionPlanCode,
): StoreAuthResult {
  const limit = maxProductsForTier(tier);
  if (limit !== null && productCount >= limit) {
    return { ok: false, errorKey: "planProductLimit" };
  }
  return { ok: true };
}

/** Reject selling or cart operations on plan-locked SKUs. */
export function validateProductPlanAccess(
  productId: string,
  products: readonly Product[],
  tier: SubscriptionPlanCode,
): StoreAuthResult {
  const locked = lockedProductIds(products, maxProductsForTier(tier));
  if (locked.has(productId)) {
    return { ok: false, errorKey: "planProductLocked" };
  }
  return { ok: true };
}

export function validateDraftLinesPlanAccess(
  lines: readonly { productId: string }[],
  products: readonly Product[],
  tier: SubscriptionPlanCode,
): StoreAuthResult {
  for (const line of lines) {
    const check = validateProductPlanAccess(line.productId, products, tier);
    if (!check.ok) return check;
  }
  return { ok: true };
}
