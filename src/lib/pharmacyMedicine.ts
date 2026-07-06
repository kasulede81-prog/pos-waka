import type { Product } from "../types";

export const MEDICINE_FORMS = [
  "Tablet",
  "Capsule",
  "Syrup",
  "Injection",
  "Cream",
  "Drops",
  "Other",
] as const;

export type MedicineFormPreset = (typeof MEDICINE_FORMS)[number];

export function normalizeMedicineStrength(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeMedicineForm(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Strength + form suffix, e.g. "500mg · Capsule". */
export function formatMedicineDetailSuffix(product: Product): string | null {
  const strength = normalizeMedicineStrength(product.medicineStrength);
  const form = normalizeMedicineForm(product.medicineForm);
  const bits = [strength, form].filter(Boolean);
  return bits.length ? bits.join(" · ") : null;
}

function nameAlreadyIncludesDetail(name: string, detail: string): boolean {
  return name.toLowerCase().includes(detail.toLowerCase());
}

/** Full label for receipts, cart lines, and search display. */
export function formatMedicineFullLabel(product: Product): string {
  const name = product.name.trim();
  const suffix = formatMedicineDetailSuffix(product);
  if (!suffix) return name;
  const parts = suffix.split(" · ");
  const missing = parts.filter((part) => !nameAlreadyIncludesDetail(name, part));
  if (!missing.length) return name;
  return `${name} ${missing.join(" ")}`.trim();
}

/** Primary line + optional subtitle for cards and lists. */
export function formatMedicineListPrimary(product: Product): string {
  return product.name.trim();
}

export function formatMedicineListSecondary(product: Product): string | null {
  return formatMedicineDetailSuffix(product);
}

/** All searchable text for a medicine. */
export function medicineSearchHaystack(product: Product): string {
  const master = product.pharmacyMaster;
  return [
    product.name,
    master?.brandName,
    master?.genericName,
    master?.manufacturer,
    master?.country,
    master?.registrationNumber,
    master?.medicineCategory,
    master?.supplierSku,
    master?.storageNotes,
    ...(master?.barcodes ?? []),
    product.category,
    product.baseUnit,
    product.sku,
    product.buyingUnit,
    product.medicineStrength,
    product.medicineForm,
    product.expiryDate,
    formatMedicineFullLabel(product),
  ]
    .filter(Boolean)
    .join(" ");
}

/** Exact barcode match against SKU and pharmacy master barcodes. */
export function productMatchesBarcode(product: Product, code: string): boolean {
  const raw = code.trim();
  if (!raw) return false;
  const norm = raw.toLowerCase();
  if (product.sku?.trim().toLowerCase() === norm) return true;
  const barcodes = product.pharmacyMaster?.barcodes ?? [];
  return barcodes.some((b) => b.trim().toLowerCase() === norm);
}

export function findProductByBarcode(products: Product[], code: string): Product | undefined {
  const trimmed = code.trim();
  if (!trimmed) return undefined;
  return products.find((p) => productMatchesBarcode(p, trimmed));
}
