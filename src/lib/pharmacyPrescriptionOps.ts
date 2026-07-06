import type {
  Customer,
  PharmacyPrescription,
  PharmacyPrescriptionLine,
  PharmacyPrescriptionStatus,
  PharmacyPrescriptionType,
  Product,
  SaleLine,
} from "../types";
import { dateKeyKampala } from "../lib/datesUg";
import { getOrCreateDeviceId } from "../lib/deviceId";
import { buildSaleLine } from "../lib/sellingEngine";
import { withPharmacyFefoPreview } from "../lib/pharmacyBatches";
import {
  canTransitionPrescriptionStatus,
  computeNextRefillDate,
  generatePrescriptionNumber,
  normalizePrescription,
  prescriptionLineFromProduct,
  remainingRefills,
} from "../lib/pharmacyPrescriptions";
import { ensureSaleLineId } from "../lib/pendingSaleMerge";
import { resolvePackCostUnitsDepleted } from "../lib/costPrecision";

export type CreatePrescriptionInput = {
  type?: PharmacyPrescriptionType;
  patientId?: string | null;
  patientName?: string | null;
  patientPhone?: string | null;
  doctorName?: string | null;
  prescriptionNumber?: string | null;
  diagnosis?: string | null;
  notes?: string | null;
  prescriptionDate?: string | null;
  refillCount?: number;
  priority?: "normal" | "urgent";
  lines?: PharmacyPrescriptionLine[];
};

export function buildNewPrescription(
  input: CreatePrescriptionInput,
  actor?: { userId?: string; displayName?: string } | null,
): PharmacyPrescription {
  const now = new Date().toISOString();
  return normalizePrescription({
    id: crypto.randomUUID(),
    prescriptionNumber: input.prescriptionNumber?.trim() || generatePrescriptionNumber(),
    type: input.type ?? "paper_rx",
    status: "draft",
    priority: input.priority ?? "normal",
    patientId: input.patientId ?? null,
    patientName: input.patientName ?? null,
    patientPhone: input.patientPhone ?? null,
    doctorName: input.doctorName ?? null,
    diagnosis: input.diagnosis ?? null,
    notes: input.notes ?? null,
    prescriptionDate: input.prescriptionDate ?? dateKeyKampala(new Date()),
    refillCount: Math.max(0, Math.floor(input.refillCount ?? 0)),
    refillsUsed: 0,
    lines: input.lines ?? [],
    createdAt: now,
    updatedAt: now,
    version: 1,
    pendingSync: true,
    verifiedByUserId: actor?.userId ?? null,
  })!;
}

export function patchPrescription(
  prev: PharmacyPrescription,
  patch: Partial<PharmacyPrescription>,
): PharmacyPrescription {
  const now = new Date().toISOString();
  return normalizePrescription({
    ...prev,
    ...patch,
    lines: patch.lines ?? prev.lines,
    updatedAt: now,
    version: prev.version + 1,
    pendingSync: true,
  })!;
}

export function transitionPrescription(
  prev: PharmacyPrescription,
  nextStatus: PharmacyPrescriptionStatus,
): { ok: true; prescription: PharmacyPrescription } | { ok: false; errorKey: string } {
  if (!canTransitionPrescriptionStatus(prev.status, nextStatus)) {
    return { ok: false, errorKey: "pharmacyRxInvalidTransition" };
  }
  return { ok: true, prescription: patchPrescription(prev, { status: nextStatus }) };
}

export function verifyPrescriptionRecord(
  prev: PharmacyPrescription,
  actor: { userId: string; displayName?: string },
): PharmacyPrescription {
  const now = new Date().toISOString();
  return patchPrescription(prev, {
    status: prev.status === "waiting_verification" ? "verified" : prev.status,
    verifiedAt: now,
    verifiedByUserId: actor.userId,
    verifiedByName: actor.displayName ?? null,
  });
}

export function markPrescriptionDispensed(
  prev: PharmacyPrescription,
  saleId: string,
  actor: { userId: string; displayName?: string },
  lines?: PharmacyPrescriptionLine[],
): PharmacyPrescription {
  const now = new Date().toISOString();
  const updatedLines = (lines ?? prev.lines).map((l) => ({
    ...l,
    quantityDispensed: l.quantityPrescribed,
  }));
  return patchPrescription(prev, {
    status: "dispensed",
    saleId,
    dispensedAt: now,
    dispensedByUserId: actor.userId,
    dispensedByName: actor.displayName ?? null,
    lines: updatedLines,
  });
}

export function createRefillFromPrescription(prev: PharmacyPrescription): PharmacyPrescription | null {
  if (remainingRefills(prev) <= 0) return null;
  const now = new Date().toISOString();
  return normalizePrescription({
    ...prev,
    id: crypto.randomUUID(),
    prescriptionNumber: `${prev.prescriptionNumber}-R${prev.refillsUsed + 1}`,
    type: "repeat",
    status: "verified",
    refillsUsed: prev.refillsUsed,
    refillCount: prev.refillCount,
    saleId: null,
    verifiedAt: now,
    dispensedAt: null,
    lines: prev.lines.map((l) => ({
      ...l,
      id: crypto.randomUUID(),
      quantityDispensed: 0,
    })),
    createdAt: now,
    updatedAt: now,
    version: 1,
    pendingSync: true,
  });
}

export function applyRefillConsumption(prev: PharmacyPrescription): PharmacyPrescription {
  const used = prev.refillsUsed + 1;
  return patchPrescription(prev, {
    refillsUsed: used,
    lastRefillAt: new Date().toISOString(),
    nextRefillEligibleAt: computeNextRefillDate({ ...prev, refillsUsed: used }),
  });
}

export function prescriptionToDraftLines(
  prescription: PharmacyPrescription,
  products: Product[],
): SaleLine[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines: SaleLine[] = [];
  for (const pl of prescription.lines) {
    const product = byId.get(pl.productId);
    if (!product) continue;
    const qty = Math.max(1, pl.quantityPrescribed - pl.quantityDispensed);
    const built = buildSaleLine(product, "quantity", qty, {
      packSlotStart: resolvePackCostUnitsDepleted(product),
    });
    if (!built.line) continue;
    let line = ensureSaleLineId(built.line);
    if (pl.batchOverrideId) {
      line = {
        ...line,
        pharmacyBatchOverrideId: pl.batchOverrideId,
        pharmacyBatchNumber: pl.batchNumber ?? null,
        pharmacyBatchExpiry: pl.batchExpiry ?? null,
      };
    }
    line = withPharmacyFefoPreview(line, product, pl.batchOverrideId);
    lines.push(line);
  }
  return lines;
}

export function resolvePatientFromPrescription(
  prescription: PharmacyPrescription,
  customers: Customer[],
): Customer | null {
  if (!prescription.patientId) return null;
  return customers.find((c) => c.id === prescription.patientId) ?? null;
}

export function pharmacyPrescriptionAuditPayload(
  rx: PharmacyPrescription,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    prescriptionId: rx.id,
    prescriptionNumber: rx.prescriptionNumber,
    patientId: rx.patientId,
    status: rx.status,
    type: rx.type,
    deviceId: getOrCreateDeviceId(),
    businessDate: dateKeyKampala(new Date()),
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
    ...extra,
  };
}

export function addLineToPrescription(
  prescription: PharmacyPrescription,
  product: Product,
  quantity: number,
  directions?: string | null,
): PharmacyPrescription {
  const line = prescriptionLineFromProduct(product, quantity, directions);
  return patchPrescription(prescription, { lines: [...prescription.lines, line] });
}
