import type {
  PharmacyControlledSchedule,
  PharmacyDispenseComplianceApproval,
  PharmacyMedicineMaster,
  PharmacyPrescription,
  Product,
  SaleLine,
  ShopPreferences,
} from "../types";
import { formatMedicineFullLabel } from "./pharmacyMedicine";

const SCHEDULES: PharmacyControlledSchedule[] = [
  "none",
  "schedule_2",
  "schedule_3",
  "schedule_4",
  "narcotic",
  "psychotropic",
];

export type ControlledLineInfo = {
  productId: string;
  productName: string;
  quantity: number;
  schedule: PharmacyControlledSchedule;
  regulatoryCategory: string | null;
  maxQuantity: number | null;
  witnessRequired: boolean;
  managerOverrideRequired: boolean;
  prescriptionRequired: boolean;
  batchNumber?: string | null;
  batchExpiry?: string | null;
};

export type ControlledDispenseValidation = {
  requiresGate: boolean;
  controlledLines: ControlledLineInfo[];
  requiresManager: boolean;
  requiresWitness: boolean;
  quantityViolations: ControlledLineInfo[];
  prescriptionRequiredBlocked: boolean;
  messages: string[];
};

export function normalizeControlledSchedule(raw: unknown): PharmacyControlledSchedule {
  if (typeof raw === "string" && SCHEDULES.includes(raw as PharmacyControlledSchedule)) {
    return raw as PharmacyControlledSchedule;
  }
  return "none";
}

export function isControlledProduct(product: Product): boolean {
  const m = product.pharmacyMaster;
  if (!m) return false;
  if (m.controlledDrug) return true;
  const schedule = normalizeControlledSchedule(m.controlledSchedule);
  return schedule !== "none";
}

export function controlledMaster(product: Product): PharmacyMedicineMaster | null {
  if (!product.pharmacyMaster || !isControlledProduct(product)) return null;
  return product.pharmacyMaster;
}

export function defaultCompliancePrefs(): NonNullable<ShopPreferences["pharmacyCompliance"]> {
  return {
    witnessWorkflowEnabled: false,
    largeControlledQuantityThreshold: 30,
    failedApprovalAlertThreshold: 3,
    frequentOverrideWindowHours: 24,
    frequentOverrideThreshold: 5,
  };
}

export function compliancePrefs(prefs: ShopPreferences): NonNullable<ShopPreferences["pharmacyCompliance"]> {
  return { ...defaultCompliancePrefs(), ...prefs.pharmacyCompliance };
}

export function buildControlledLineInfo(product: Product, line: SaleLine): ControlledLineInfo | null {
  const master = controlledMaster(product);
  if (!master) return null;
  return {
    productId: product.id,
    productName: formatMedicineFullLabel(product),
    quantity: line.quantity,
    schedule: normalizeControlledSchedule(master.controlledSchedule ?? (master.controlledDrug ? "schedule_3" : "none")),
    regulatoryCategory: master.regulatoryCategory ?? null,
    maxQuantity: master.maxQuantityPerDispense ?? null,
    witnessRequired: Boolean(master.witnessRequired),
    managerOverrideRequired: Boolean(master.managerOverrideRequired ?? master.controlledDrug),
    prescriptionRequired: master.otcOrPrescription === "prescription",
    batchNumber: line.pharmacyBatchNumber ?? null,
    batchExpiry: line.pharmacyBatchExpiry ?? null,
  };
}

export function validateControlledDispense(input: {
  lines: SaleLine[];
  products: Product[];
  preferences: ShopPreferences;
  prescription: PharmacyPrescription | null;
  compliance: PharmacyDispenseComplianceApproval | null;
}): ControlledDispenseValidation {
  const prefs = compliancePrefs(input.preferences);
  const controlledLines: ControlledLineInfo[] = [];
  const quantityViolations: ControlledLineInfo[] = [];
  let requiresManager = false;
  let requiresWitness = false;
  let prescriptionRequiredBlocked = false;
  const messages: string[] = [];

  const productById = new Map(input.products.map((p) => [p.id, p]));
  for (const line of input.lines) {
    const product = productById.get(line.productId);
    if (!product) continue;
    const info = buildControlledLineInfo(product, line);
    if (!info) continue;
    controlledLines.push(info);
    if (info.managerOverrideRequired) requiresManager = true;
    if (info.witnessRequired && prefs.witnessWorkflowEnabled) requiresWitness = true;
    if (info.prescriptionRequired && !input.prescription) {
      prescriptionRequiredBlocked = true;
      messages.push(`prescription_required:${info.productName}`);
    }
    if (info.maxQuantity != null && line.quantity > info.maxQuantity) {
      quantityViolations.push(info);
      requiresManager = true;
      messages.push(`quantity_exceeded:${info.productName}`);
    }
    if (line.pharmacyBatchOverrideId) requiresManager = true;
  }

  const largeThreshold = prefs.largeControlledQuantityThreshold ?? 30;
  for (const info of controlledLines) {
    if (info.quantity >= largeThreshold) {
      requiresManager = true;
      messages.push(`large_quantity:${info.productName}`);
    }
  }

  const requiresGate =
    controlledLines.length > 0 &&
    (!input.compliance ||
      (requiresManager && !input.compliance.managerApproved) ||
      (requiresWitness && !input.compliance.witnessUserId) ||
      !input.compliance.patientVerified ||
      (input.prescription != null && !input.compliance.prescriptionVerified));

  return {
    requiresGate: requiresGate || prescriptionRequiredBlocked,
    controlledLines,
    requiresManager,
    requiresWitness,
    quantityViolations,
    prescriptionRequiredBlocked,
    messages,
  };
}

export function controlledStockCount(products: Product[]): number {
  return products.filter((p) => isControlledProduct(p) && p.stockOnHand > 0).length;
}
