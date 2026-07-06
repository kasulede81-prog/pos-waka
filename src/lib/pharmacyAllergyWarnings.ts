import type { Customer, Product } from "../types";
import { ensurePharmacyPatientProfile } from "./pharmacyPatientProfile";
import { formatMedicineFullLabel } from "./pharmacyMedicine";

/** Configurable allergy class → medicine name tokens (no clinical engine). */
export const PHARMACY_ALLERGY_CLASS_TOKENS: Record<string, string[]> = {
  penicillin: ["penicillin", "amoxicillin", "ampicillin", "flucloxacillin"],
  sulfa: ["sulfa", "sulfamethoxazole", "cotrimoxazole", "sulfadiazine"],
  aspirin: ["aspirin", "salicylate", "diclofenac"],
  nsaid: ["ibuprofen", "diclofenac", "naproxen", "indomethacin"],
  latex: ["latex"],
  iodine: ["iodine", "povidone"],
};

export type PharmacyAllergyWarning = {
  productId: string;
  productName: string;
  allergyToken: string;
  matchedIn: string;
  severity: "warning";
};

function productSearchHaystack(product: Product): string {
  const parts = [
    product.name,
    product.medicineStrength,
    product.pharmacyMaster?.genericName,
    product.pharmacyMaster?.brandName,
    product.category,
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function patientAllergyTokens(patient: Customer): string[] {
  const profile = ensurePharmacyPatientProfile(patient);
  const tokens = new Set<string>();
  for (const a of profile.allergies ?? []) {
    const t = a.trim().toLowerCase();
    if (t) tokens.add(t);
  }
  if (profile.allergiesText) {
    for (const part of profile.allergiesText.split(/[,;]+/)) {
      const t = part.trim().toLowerCase();
      if (t) tokens.add(t);
    }
  }
  return [...tokens];
}

export function checkAllergyWarnings(patient: Customer | null, products: Product[]): PharmacyAllergyWarning[] {
  if (!patient) return [];
  const allergies = patientAllergyTokens(patient);
  if (allergies.length === 0) return [];
  const warnings: PharmacyAllergyWarning[] = [];
  const seen = new Set<string>();

  for (const product of products) {
    const haystack = productSearchHaystack(product);
    for (const allergy of allergies) {
      if (haystack.includes(allergy)) {
        const key = `${product.id}:${allergy}`;
        if (!seen.has(key)) {
          seen.add(key);
          warnings.push({
            productId: product.id,
            productName: formatMedicineFullLabel(product),
            allergyToken: allergy,
            matchedIn: product.name,
            severity: "warning",
          });
        }
      }
      const classTokens = PHARMACY_ALLERGY_CLASS_TOKENS[allergy];
      if (classTokens) {
        for (const token of classTokens) {
          if (haystack.includes(token)) {
            const key = `${product.id}:${allergy}:${token}`;
            if (!seen.has(key)) {
              seen.add(key);
              warnings.push({
                productId: product.id,
                productName: formatMedicineFullLabel(product),
                allergyToken: allergy,
                matchedIn: token,
                severity: "warning",
              });
            }
          }
        }
      }
    }
  }
  return warnings;
}

export function checkSingleProductAllergy(
  patient: Customer | null,
  product: Product,
): PharmacyAllergyWarning[] {
  return checkAllergyWarnings(patient, [product]);
}
