/** Step registry for enterprise product wizards — business modes register step ids only. */

export const RETAIL_PRODUCT_WIZARD_STEPS = [
  "name",
  "shelf",
  "sellUnit",
  "pack",
  "piecesPerPack",
  "stock",
  "sellPrice",
  "buyPrice",
] as const;

export const PHARMACY_PRODUCT_WIZARD_STEPS = [
  "details",
  "stockCost",
  "selling",
] as const;

export type RetailProductWizardStep = (typeof RETAIL_PRODUCT_WIZARD_STEPS)[number];
export type PharmacyProductWizardStep = (typeof PHARMACY_PRODUCT_WIZARD_STEPS)[number];

export type ProductWizardMode = "retail" | "pharmacy";

export function productWizardStepsForMode(mode: ProductWizardMode): readonly string[] {
  return mode === "pharmacy" ? PHARMACY_PRODUCT_WIZARD_STEPS : RETAIL_PRODUCT_WIZARD_STEPS;
}
