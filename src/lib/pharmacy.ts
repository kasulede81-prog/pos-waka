import type { BusinessType } from "../types";

/** Pharmacy / drug shop business types that use Pharmacy Mode UI. */
export function isPharmacyBusinessType(type: BusinessType | undefined | null): type is "pharmacy" {
  return type === "pharmacy";
}

/** Pharmacy Mode — terminology, dashboard, expiry features. */
export function isPharmacyMode(
  businessType: BusinessType | undefined | null,
  enabled?: boolean | null,
): boolean {
  if (enabled === false) return false;
  return isPharmacyBusinessType(businessType);
}

/** Default medicine categories for new pharmacy shops. */
export const PHARMACY_CATEGORY_PRESETS = [
  "Antibiotics",
  "Pain Relief",
  "Malaria",
  "Cough & Cold",
  "Vitamins",
  "Family Planning",
  "Baby Care",
  "First Aid",
  "Diabetes",
  "Hypertension",
] as const;

export function defaultPharmacyCategoriesForBusinessType(
  businessType: BusinessType | undefined | null,
): string[] {
  if (!isPharmacyBusinessType(businessType)) return [];
  return [...PHARMACY_CATEGORY_PRESETS];
}
