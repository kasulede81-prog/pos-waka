import type { BusinessType } from "../types";
import { isHospitalityMode } from "./hospitality";
import { isPharmacyMode } from "./pharmacy";
import { isWholesaleMode } from "./wholesale";

export type AdjustmentWorkspaceMode = "retail" | "pharmacy" | "wholesale" | "hospitality";

export type AdjustmentReasonId =
  | "increase"
  | "decrease"
  | "damaged"
  | "lost"
  | "correction"
  | "inventory_count"
  | "expired"
  | "supplier_return"
  | "controlled_return"
  | "batch_correction";

export type AdjustmentReasonDef = {
  id: AdjustmentReasonId;
  labelKey: string;
  /** Maps to adjustStock() reason string when applicable */
  storeReason?: string;
  direction?: "in" | "out" | "either";
};

export function adjustmentWorkspaceMode(
  businessType: BusinessType,
  pharmacyModeEnabled?: boolean,
): AdjustmentWorkspaceMode {
  if (isPharmacyMode(businessType, pharmacyModeEnabled)) return "pharmacy";
  if (isHospitalityMode(businessType)) return "hospitality";
  if (isWholesaleMode(businessType)) return "wholesale";
  return "retail";
}

const RETAIL_REASONS: AdjustmentReasonDef[] = [
  { id: "increase", labelKey: "adjReasonIncrease", storeReason: "added", direction: "in" },
  { id: "decrease", labelKey: "adjReasonDecrease", storeReason: "sold", direction: "out" },
  { id: "damaged", labelKey: "adjReasonDamaged", storeReason: "damaged", direction: "out" },
  { id: "lost", labelKey: "adjReasonLost", storeReason: "lost", direction: "out" },
  { id: "correction", labelKey: "adjReasonCorrection", direction: "either" },
  { id: "inventory_count", labelKey: "adjReasonInventoryCount", storeReason: "count correction", direction: "either" },
];

const PHARMACY_EXTRA: AdjustmentReasonDef[] = [
  { id: "expired", labelKey: "adjReasonExpired", direction: "out" },
  { id: "supplier_return", labelKey: "adjReasonSupplierReturn", direction: "out" },
  { id: "controlled_return", labelKey: "adjReasonControlledReturn", direction: "either" },
  { id: "batch_correction", labelKey: "adjReasonBatchCorrection", storeReason: "batch correction", direction: "either" },
];

export function resolveAdjustmentReasons(mode: AdjustmentWorkspaceMode): AdjustmentReasonDef[] {
  if (mode === "pharmacy") return [...RETAIL_REASONS, ...PHARMACY_EXTRA];
  return RETAIL_REASONS;
}

export function adjustmentDeltaForReason(reason: AdjustmentReasonDef, qty: number, direction: "in" | "out"): number {
  const n = Math.abs(qty);
  if (reason.direction === "in") return n;
  if (reason.direction === "out") return -n;
  return direction === "in" ? n : -n;
}

export function adjustStockReasonString(reason: AdjustmentReasonDef, note: string): string {
  const base = reason.storeReason ?? reason.id;
  const trimmed = note.trim();
  if (trimmed.length >= 3) return trimmed;
  return base.length >= 3 ? base : `${base} adjustment`;
}
