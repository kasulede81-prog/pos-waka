import type {
  PharmacyControlledOverrideKind,
  PharmacyControlledRegisterEntry,
  PharmacyControlledRegisterKind,
} from "../types";
import { dateKeyKampala } from "./datesUg";

export function normalizeControlledRegisterEntry(raw: unknown): PharmacyControlledRegisterEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  const productId = String(r.productId ?? "").trim();
  if (!id || !productId) return null;
  const kinds: PharmacyControlledRegisterKind[] = ["dispense", "override", "return", "destroy", "void", "witness"];
  const kind = kinds.includes(r.kind as PharmacyControlledRegisterKind)
    ? (r.kind as PharmacyControlledRegisterKind)
    : "dispense";
  const overrideKinds: PharmacyControlledOverrideKind[] = [
    "controlled",
    "quantity",
    "fefo",
    "batch",
    "expired",
    "discount",
    "price",
  ];
  return {
    id,
    kind,
    at: String(r.at ?? r.createdAt ?? new Date().toISOString()),
    businessDate: String(r.businessDate ?? dateKeyKampala(new Date())),
    productId,
    productName: String(r.productName ?? "—"),
    controlledSchedule: r.controlledSchedule != null ? String(r.controlledSchedule) : null,
    regulatoryCategory: r.regulatoryCategory != null ? String(r.regulatoryCategory) : null,
    patientId: r.patientId != null ? String(r.patientId) : null,
    patientName: r.patientName != null ? String(r.patientName) : null,
    prescriptionId: r.prescriptionId != null ? String(r.prescriptionId) : null,
    prescriptionNumber: r.prescriptionNumber != null ? String(r.prescriptionNumber) : null,
    saleId: r.saleId != null ? String(r.saleId) : null,
    returnId: r.returnId != null ? String(r.returnId) : null,
    batchNumber: r.batchNumber != null ? String(r.batchNumber) : null,
    batchExpiry: r.batchExpiry != null ? String(r.batchExpiry) : null,
    quantity: Math.max(0, Number(r.quantity ?? 0)),
    pharmacistUserId: r.pharmacistUserId != null ? String(r.pharmacistUserId) : null,
    pharmacistName: r.pharmacistName != null ? String(r.pharmacistName) : null,
    managerUserId: r.managerUserId != null ? String(r.managerUserId) : null,
    managerName: r.managerName != null ? String(r.managerName) : null,
    pharmacistRole: r.pharmacistRole != null ? String(r.pharmacistRole) : null,
    managerRole: r.managerRole != null ? String(r.managerRole) : null,
    pinVerified: r.pinVerified != null ? Boolean(r.pinVerified) : undefined,
    approvalMethod: r.approvalMethod != null ? String(r.approvalMethod) : null,
    witnessUserId: r.witnessUserId != null ? String(r.witnessUserId) : null,
    witnessName: r.witnessName != null ? String(r.witnessName) : null,
    overrideReason: r.overrideReason != null ? String(r.overrideReason) : null,
    overrideKind:
      r.overrideKind && overrideKinds.includes(r.overrideKind as PharmacyControlledOverrideKind)
        ? (r.overrideKind as PharmacyControlledOverrideKind)
        : null,
    deviceId: r.deviceId != null ? String(r.deviceId) : null,
    immutable: true,
    createdAt: String(r.createdAt ?? r.at ?? new Date().toISOString()),
  };
}

export function createRegisterEntry(
  input: Omit<PharmacyControlledRegisterEntry, "immutable" | "createdAt" | "id"> & { id?: string },
): PharmacyControlledRegisterEntry {
  const now = new Date().toISOString();
  return {
    ...input,
    id: input.id ?? crypto.randomUUID(),
    immutable: true,
    createdAt: now,
    businessDate: input.businessDate || dateKeyKampala(new Date(input.at || now)),
  };
}

export function searchControlledRegister(
  entries: PharmacyControlledRegisterEntry[],
  query: string,
): PharmacyControlledRegisterEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries.slice().sort((a, b) => b.at.localeCompare(a.at));
  return entries
    .filter((e) => {
      if (e.productName.toLowerCase().includes(q)) return true;
      if (e.patientName?.toLowerCase().includes(q)) return true;
      if (e.prescriptionNumber?.toLowerCase().includes(q)) return true;
      if (e.batchNumber?.toLowerCase().includes(q)) return true;
      if (e.pharmacistName?.toLowerCase().includes(q)) return true;
      if (e.saleId?.toLowerCase().includes(q)) return true;
      return false;
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

export function registerEntriesForBusinessDate(
  entries: PharmacyControlledRegisterEntry[],
  dayKey: string,
): PharmacyControlledRegisterEntry[] {
  return entries.filter((e) => e.businessDate === dayKey).sort((a, b) => b.at.localeCompare(a.at));
}
