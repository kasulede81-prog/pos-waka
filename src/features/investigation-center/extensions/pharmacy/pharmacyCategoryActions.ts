import type { AuditAction } from "../../../../types";
import type { PharmacyInvestigationCategory } from "../../types";

export const PHARMACY_INVESTIGATION_CATEGORIES: PharmacyInvestigationCategory[] = [
  "prescriptions",
  "controlled_medicines",
  "dispensing",
  "batch_operations",
  "fefo",
  "expiry",
  "compliance",
  "supplier_returns",
  "controlled_returns",
];

const PRESCRIPTIONS: ReadonlySet<AuditAction> = new Set([
  "pharmacy_prescription_created",
  "pharmacy_prescription_verified",
  "pharmacy_prescription_dispensed",
  "pharmacy_prescription_cancelled",
  "pharmacy_prescription_reopened",
  "pharmacy_prescription_refilled",
]);

const CONTROLLED_MEDICINES: ReadonlySet<AuditAction> = new Set([
  "pharmacy_controlled_dispensed",
  "controlled_dispense",
  "controlled_override",
  "controlled_destroy",
  "controlled_void",
  "pharmacy_manager_approval",
  "witness_signed",
]);

const DISPENSING: ReadonlySet<AuditAction> = new Set([
  "pharmacy_prescription_dispensed",
  "pharmacy_controlled_dispensed",
  "controlled_dispense",
]);

const BATCH_OPERATIONS: ReadonlySet<AuditAction> = new Set([
  "pharmacy_batch_received",
  "pharmacy_batch_dispensed",
  "pharmacy_batch_writeoff",
  "pharmacy_batch_return",
]);

const FEFO: ReadonlySet<AuditAction> = new Set(["pharmacy_fefo_override"]);

const EXPIRY: ReadonlySet<AuditAction> = new Set(["expired_stock_writeoff"]);

const COMPLIANCE: ReadonlySet<AuditAction> = new Set([
  ...CONTROLLED_MEDICINES,
  "pharmacy_patient_updated",
]);

const SUPPLIER_RETURNS: ReadonlySet<AuditAction> = new Set(["pharmacy_batch_return"]);

const CONTROLLED_RETURNS: ReadonlySet<AuditAction> = new Set(["controlled_return", "pharmacy_batch_return"]);

const PHARMACY_CATEGORY_SETS: Record<PharmacyInvestigationCategory, ReadonlySet<AuditAction>> = {
  prescriptions: PRESCRIPTIONS,
  controlled_medicines: CONTROLLED_MEDICINES,
  dispensing: DISPENSING,
  batch_operations: BATCH_OPERATIONS,
  fefo: FEFO,
  expiry: EXPIRY,
  compliance: COMPLIANCE,
  supplier_returns: SUPPLIER_RETURNS,
  controlled_returns: CONTROLLED_RETURNS,
};

export function isPharmacyInvestigationCategory(category: string): category is PharmacyInvestigationCategory {
  return PHARMACY_INVESTIGATION_CATEGORIES.includes(category as PharmacyInvestigationCategory);
}

export function matchesPharmacyCategory(entry: { action: AuditAction }, category: PharmacyInvestigationCategory): boolean {
  return PHARMACY_CATEGORY_SETS[category]?.has(entry.action) ?? false;
}

export function pharmacyCategoryLabelKey(category: PharmacyInvestigationCategory): string {
  return `icPharmacyCategory_${category}`;
}
