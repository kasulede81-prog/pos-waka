import type {
  Customer,
  PharmacyPrescription,
  PharmacyPrescriptionLine,
  PharmacyPrescriptionPriority,
  PharmacyPrescriptionStatus,
  PharmacyPrescriptionType,
  Product,
  Sale,
} from "../types";
import { dateKeyKampala } from "./datesUg";
import { formatMedicineFullLabel } from "./pharmacyMedicine";

export const PHARMACY_PRESCRIPTION_STATUSES: PharmacyPrescriptionStatus[] = [
  "draft",
  "waiting_verification",
  "verified",
  "dispensing",
  "ready",
  "dispensed",
  "cancelled",
  "archived",
];

export const PHARMACY_PRESCRIPTION_TYPES: PharmacyPrescriptionType[] = [
  "walk_in_otc",
  "paper_rx",
  "electronic_rx",
  "repeat",
  "chronic",
  "emergency",
];

const STATUS_TRANSITIONS: Partial<Record<PharmacyPrescriptionStatus, PharmacyPrescriptionStatus[]>> = {
  draft: ["waiting_verification", "verified", "cancelled"],
  waiting_verification: ["verified", "cancelled", "draft"],
  verified: ["dispensing", "ready", "cancelled", "waiting_verification"],
  dispensing: ["ready", "dispensed", "cancelled"],
  ready: ["dispensing", "dispensed", "cancelled"],
  dispensed: ["archived"],
  cancelled: ["draft", "archived"],
};

export function canTransitionPrescriptionStatus(
  from: PharmacyPrescriptionStatus,
  to: PharmacyPrescriptionStatus,
): boolean {
  if (from === to) return true;
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function normalizePrescriptionLine(raw: unknown): PharmacyPrescriptionLine | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  const productId = String(r.productId ?? "").trim();
  if (!id || !productId) return null;
  return {
    id,
    productId,
    productName: String(r.productName ?? "—"),
    strength: r.strength != null ? String(r.strength) : null,
    form: r.form != null ? String(r.form) : null,
    quantityPrescribed: Math.max(0, Math.floor(Number(r.quantityPrescribed ?? 0))),
    quantityDispensed: Math.max(0, Math.floor(Number(r.quantityDispensed ?? 0))),
    directions: r.directions != null ? String(r.directions) : null,
    batchOverrideId: r.batchOverrideId != null ? String(r.batchOverrideId) : null,
    batchNumber: r.batchNumber != null ? String(r.batchNumber) : null,
    batchExpiry: r.batchExpiry != null ? String(r.batchExpiry) : null,
  };
}

export function normalizePrescription(raw: unknown): PharmacyPrescription | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  if (!id) return null;
  const lines = Array.isArray(r.lines)
    ? (r.lines.map(normalizePrescriptionLine).filter(Boolean) as PharmacyPrescriptionLine[])
    : [];
  const type = PHARMACY_PRESCRIPTION_TYPES.includes(r.type as PharmacyPrescriptionType)
    ? (r.type as PharmacyPrescriptionType)
    : "paper_rx";
  const status = PHARMACY_PRESCRIPTION_STATUSES.includes(r.status as PharmacyPrescriptionStatus)
    ? (r.status as PharmacyPrescriptionStatus)
    : "draft";
  const priority: PharmacyPrescriptionPriority = r.priority === "urgent" ? "urgent" : "normal";
  return {
    id,
    prescriptionNumber: String(r.prescriptionNumber ?? id.slice(0, 8)).trim() || id.slice(0, 8),
    type,
    status,
    priority,
    patientId: r.patientId != null ? String(r.patientId) : null,
    patientName: r.patientName != null ? String(r.patientName) : null,
    patientPhone: r.patientPhone != null ? String(r.patientPhone) : null,
    doctorName: r.doctorName != null ? String(r.doctorName) : null,
    diagnosis: r.diagnosis != null ? String(r.diagnosis) : null,
    notes: r.notes != null ? String(r.notes) : null,
    prescriptionDate: String(r.prescriptionDate ?? dateKeyKampala(new Date())),
    refillCount: Math.max(0, Math.floor(Number(r.refillCount ?? 0))),
    refillsUsed: Math.max(0, Math.floor(Number(r.refillsUsed ?? 0))),
    lastRefillAt: r.lastRefillAt != null ? String(r.lastRefillAt) : null,
    nextRefillEligibleAt: r.nextRefillEligibleAt != null ? String(r.nextRefillEligibleAt) : null,
    lines,
    saleId: r.saleId != null ? String(r.saleId) : null,
    verifiedAt: r.verifiedAt != null ? String(r.verifiedAt) : null,
    verifiedByUserId: r.verifiedByUserId != null ? String(r.verifiedByUserId) : null,
    verifiedByName: r.verifiedByName != null ? String(r.verifiedByName) : null,
    dispensedAt: r.dispensedAt != null ? String(r.dispensedAt) : null,
    dispensedByUserId: r.dispensedByUserId != null ? String(r.dispensedByUserId) : null,
    dispensedByName: r.dispensedByName != null ? String(r.dispensedByName) : null,
    controlledMedicinesApproved: Boolean(r.controlledMedicinesApproved),
    controlledApprovalReason: r.controlledApprovalReason != null ? String(r.controlledApprovalReason) : null,
    createdAt: String(r.createdAt ?? new Date().toISOString()),
    updatedAt: String(r.updatedAt ?? r.createdAt ?? new Date().toISOString()),
    version: Math.max(1, Math.floor(Number(r.version ?? 1))),
    pendingSync: r.pendingSync !== false,
  };
}

let rxSeq = 0;
export function generatePrescriptionNumber(at: Date = new Date()): string {
  const day = dateKeyKampala(at).replace(/-/g, "");
  rxSeq = (rxSeq + 1) % 10000;
  return `RX-${day}-${String(rxSeq).padStart(4, "0")}`;
}

export function prescriptionLineFromProduct(
  product: Product,
  quantity: number,
  directions?: string | null,
): PharmacyPrescriptionLine {
  return {
    id: crypto.randomUUID(),
    productId: product.id,
    productName: formatMedicineFullLabel(product),
    strength: product.medicineStrength ?? null,
    form: product.medicineForm ?? null,
    quantityPrescribed: Math.max(1, Math.floor(quantity)),
    quantityDispensed: 0,
    directions: directions?.trim() || null,
  };
}

export function prescriptionHasControlledMedicines(
  prescription: PharmacyPrescription,
  products: Product[],
): boolean {
  const byId = new Map(products.map((p) => [p.id, p]));
  return prescription.lines.some((l) => byId.get(l.productId)?.pharmacyMaster?.controlledDrug);
}

export function prescriptionRequiresRxMedicines(
  prescription: PharmacyPrescription,
  products: Product[],
): boolean {
  const byId = new Map(products.map((p) => [p.id, p]));
  return prescription.lines.some((l) => byId.get(l.productId)?.pharmacyMaster?.otcOrPrescription === "prescription");
}

export function remainingRefills(prescription: PharmacyPrescription): number {
  return Math.max(0, prescription.refillCount - prescription.refillsUsed);
}

export function isRefillEligible(prescription: PharmacyPrescription, today: Date = new Date()): boolean {
  if (remainingRefills(prescription) <= 0) return false;
  if (prescription.status !== "dispensed" && prescription.status !== "archived") return false;
  if (!prescription.nextRefillEligibleAt) return true;
  return prescription.nextRefillEligibleAt <= dateKeyKampala(today);
}

export function computeNextRefillDate(prescription: PharmacyPrescription, daysBetween = 30): string {
  const base = prescription.lastRefillAt ?? prescription.dispensedAt ?? prescription.createdAt;
  const d = new Date(base);
  d.setDate(d.getDate() + daysBetween);
  return dateKeyKampala(d);
}

export type PrescriptionSearchRow = PharmacyPrescription & { matchHint?: string };

export function searchPrescriptions(
  prescriptions: PharmacyPrescription[],
  query: string,
  customers: Customer[],
): PrescriptionSearchRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return prescriptions.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const customerById = new Map(customers.map((c) => [c.id, c]));
  return prescriptions
    .filter((rx) => {
      if (rx.prescriptionNumber.toLowerCase().includes(q)) return true;
      if (rx.doctorName?.toLowerCase().includes(q)) return true;
      if (rx.patientName?.toLowerCase().includes(q)) return true;
      if (rx.patientPhone?.toLowerCase().includes(q)) return true;
      if (rx.diagnosis?.toLowerCase().includes(q)) return true;
      const patient = rx.patientId ? customerById.get(rx.patientId) : null;
      if (patient?.name.toLowerCase().includes(q)) return true;
      if (patient?.phone.toLowerCase().includes(q)) return true;
      return rx.lines.some(
        (l) =>
          l.productName.toLowerCase().includes(q) ||
          l.strength?.toLowerCase().includes(q) ||
          l.batchNumber?.toLowerCase().includes(q),
      );
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function prescriptionsForPatient(
  prescriptions: PharmacyPrescription[],
  patientId: string,
): PharmacyPrescription[] {
  return prescriptions
    .filter((rx) => rx.patientId === patientId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function activePrescriptionQueue(
  prescriptions: PharmacyPrescription[],
): PharmacyPrescription[] {
  const active: PharmacyPrescriptionStatus[] = [
    "draft",
    "waiting_verification",
    "verified",
    "dispensing",
    "ready",
  ];
  return prescriptions
    .filter((rx) => active.includes(rx.status))
    .sort((a, b) => {
      if (a.priority === "urgent" && b.priority !== "urgent") return -1;
      if (b.priority === "urgent" && a.priority !== "urgent") return 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
}

export function mergePrescriptionLww(
  local: PharmacyPrescription,
  remote: PharmacyPrescription,
): PharmacyPrescription {
  if (remote.version > local.version) return remote;
  if (remote.version < local.version) return local;
  return remote.updatedAt >= local.updatedAt ? remote : local;
}

export function prescriptionStatusLabelKey(status: PharmacyPrescriptionStatus): string {
  const map: Record<PharmacyPrescriptionStatus, string> = {
    draft: "pharmacyRxStatusDraft",
    waiting_verification: "pharmacyRxStatusWaiting",
    verified: "pharmacyRxStatusVerified",
    dispensing: "pharmacyRxStatusDispensing",
    ready: "pharmacyRxStatusReady",
    dispensed: "pharmacyRxStatusDispensed",
    cancelled: "pharmacyRxStatusCancelled",
    archived: "pharmacyRxStatusArchived",
  };
  return map[status];
}

export function prescriptionTypeLabelKey(type: PharmacyPrescriptionType): string {
  const map: Record<PharmacyPrescriptionType, string> = {
    walk_in_otc: "pharmacyRxTypeOtc",
    paper_rx: "pharmacyRxTypePaper",
    electronic_rx: "pharmacyRxTypeElectronic",
    repeat: "pharmacyRxTypeRepeat",
    chronic: "pharmacyRxTypeChronic",
    emergency: "pharmacyRxTypeEmergency",
  };
  return map[type];
}

export function otcSalesFromHistory(sales: Sale[]): Sale[] {
  return sales.filter((s) => s.dispenseType === "otc" || (!s.prescriptionId && s.status !== "cancelled"));
}

export function prescriptionSalesFromHistory(sales: Sale[]): Sale[] {
  return sales.filter((s) => Boolean(s.prescriptionId));
}
