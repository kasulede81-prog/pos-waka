import type { Product } from "../types";
import { isPharmacyMode } from "./pharmacy";
import { isProductExpired, shouldBlockExpiredSale, type PharmacyExpiredSaleBehavior } from "./pharmacyExpiry";

export type ExpiredSaleGate =
  | { action: "proceed" }
  | { action: "block" }
  | { action: "confirm" };

export function gateExpiredMedicineSale(
  product: Product,
  behavior: PharmacyExpiredSaleBehavior | null | undefined,
  pharmacyMode: boolean,
): ExpiredSaleGate {
  if (!pharmacyMode || !isProductExpired(product)) return { action: "proceed" };
  if (shouldBlockExpiredSale(behavior)) return { action: "block" };
  return { action: "confirm" };
}

export function isPharmacyModeFromPreferences(prefs: {
  businessType?: import("../types").BusinessType;
  pharmacyModeEnabled?: boolean | null;
}): boolean {
  return isPharmacyMode(prefs.businessType, prefs.pharmacyModeEnabled);
}
