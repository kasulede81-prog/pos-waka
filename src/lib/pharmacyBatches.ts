import type {
  PharmacyBatchEvent,
  PharmacyBatchEventType,
  PharmacyBatchReceiveInput,
  PharmacyBatchRecord,
  PharmacyBatchStatus,
  PharmacyMedicineMaster,
  PharmacyWriteOffReason,
  Product,
} from "../types";
import { dateKeyKampala } from "./datesUg";
import { lineCostForProductQuantity } from "./costPrecision";

export type FefoAllocation = {
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
};

export type FefoAllocationResult = {
  allocations: FefoAllocation[];
  remainingUnallocated: number;
  usedOverride: boolean;
};

export type MedicineBatchSummary = {
  batchCount: number;
  activeBatchCount: number;
  nearestExpiry: string | null;
  expiredQty: number;
  nearExpiryQty: number;
  reservedQty: number;
  stockValueUgx: number;
  hasNegativeBatch: boolean;
  hasNoBatch: boolean;
};

export type ExpiryBucketRow = {
  batchId: string;
  batchNumber: string;
  productId: string;
  productName: string;
  genericName: string | null;
  strength: string | null;
  expiryDate: string;
  quantity: number;
  valueUgx: number;
  supplierName: string | null;
  location: string | null;
  bucket: "expired" | "today" | "d7" | "d30" | "d60" | "d90";
};

function newEvent(
  type: PharmacyBatchEventType,
  at: string,
  opts?: Partial<Omit<PharmacyBatchEvent, "id" | "type" | "at">>,
): PharmacyBatchEvent {
  return {
    id: crypto.randomUUID(),
    type,
    at,
    ...opts,
  };
}

export function normalizeBatchRecord(raw: unknown): PharmacyBatchRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  if (!id) return null;
  const legacyQty = Math.max(0, Math.floor(Number(r.quantityBase ?? 0)));
  const received = Math.max(0, Math.floor(Number(r.quantityReceived ?? legacyQty)));
  const remaining = Math.max(
    0,
    Math.floor(Number(r.quantityRemaining ?? legacyQty)),
  );
  const expiry = String(r.expiryDate ?? "").trim();
  const batchNumber = String(r.batchNumber ?? r.lotNumber ?? "—").trim() || "—";
  const timeline = Array.isArray(r.timeline)
    ? (r.timeline as PharmacyBatchEvent[]).filter((e) => e && typeof e === "object")
    : received > 0
      ? [newEvent("received", String(r.receivedAt ?? new Date().toISOString()), { quantityDelta: received })]
      : [];
  let status = (r.status as PharmacyBatchStatus) ?? "active";
  if (!r.status) {
    if (remaining <= 0) status = "depleted";
    else if (expiry && isExpiredDate(expiry)) status = "expired";
    else status = "active";
  }
  return {
    id,
    batchNumber,
    lotNumber: r.lotNumber != null ? String(r.lotNumber) : null,
    supplierBatch: r.supplierBatch != null ? String(r.supplierBatch) : null,
    supplierId: r.supplierId != null ? String(r.supplierId) : null,
    supplierName: r.supplierName != null ? String(r.supplierName) : null,
    purchaseId: r.purchaseId != null ? String(r.purchaseId) : null,
    purchaseInvoice: r.purchaseInvoice != null ? String(r.purchaseInvoice) : null,
    purchaseDate: r.purchaseDate != null ? String(r.purchaseDate) : null,
    manufactureDate: r.manufactureDate != null ? String(r.manufactureDate) : null,
    expiryDate: expiry || dateKeyKampala(new Date()),
    quantityReceived: received,
    quantityRemaining: remaining,
    unitCostUgx: Math.max(0, Math.round(Number(r.unitCostUgx ?? 0))),
    sellingPriceUgx: r.sellingPriceUgx != null ? Math.round(Number(r.sellingPriceUgx)) : null,
    status,
    location: r.location != null ? String(r.location) : null,
    notes: r.notes != null ? String(r.notes) : null,
    receivedAt: String(r.receivedAt ?? new Date().toISOString()),
    timeline,
  };
}

export function getProductBatches(product: Product): PharmacyBatchRecord[] {
  const raw = product.pharmacyPackaging?.batches ?? [];
  return raw.map(normalizeBatchRecord).filter((b): b is PharmacyBatchRecord => Boolean(b));
}

export function isBatchTrackedProduct(product: Product): boolean {
  if (product.pharmacyMaster?.batchTracked === false) return false;
  const batches = getProductBatches(product);
  if (batches.length > 0) return true;
  return product.pharmacyMaster?.batchTracked ?? true;
}

export function sumBatchRemaining(batches: PharmacyBatchRecord[]): number {
  return batches.reduce((sum, b) => sum + Math.max(0, b.quantityRemaining), 0);
}

export function isExpiredDate(expiryDate: string, today: Date = new Date()): boolean {
  const key = dateKeyKampala(today);
  return expiryDate < key;
}

export function daysUntilExpiry(expiryDate: string, today: Date = new Date()): number {
  const t = new Date(`${dateKeyKampala(today)}T12:00:00`);
  const e = new Date(`${expiryDate}T12:00:00`);
  return Math.floor((e.getTime() - t.getTime()) / (24 * 60 * 60 * 1000));
}

export function expiryBucketForDate(expiryDate: string, today: Date = new Date()): ExpiryBucketRow["bucket"] | null {
  const days = daysUntilExpiry(expiryDate, today);
  if (days < 0) return "expired";
  if (days === 0) return "today";
  if (days <= 7) return "d7";
  if (days <= 30) return "d30";
  if (days <= 60) return "d60";
  if (days <= 90) return "d90";
  return null;
}

/** Earliest expiry among batches with remaining stock. */
export function effectiveProductExpiry(product: Product): string | null {
  const batches = getProductBatches(product).filter((b) => b.quantityRemaining > 0 && b.status === "active");
  if (batches.length > 0) {
    return batches
      .slice()
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))[0]?.expiryDate ?? null;
  }
  return product.expiryDate ?? null;
}

export function reconcileProductExpiryFromBatches(product: Product): Product {
  const expiry = effectiveProductExpiry(product);
  if (!expiry || expiry === product.expiryDate) return product;
  return { ...product, expiryDate: expiry };
}

export function createBatchOnReceive(
  input: PharmacyBatchReceiveInput & {
    supplierId?: string | null;
    supplierName?: string | null;
    purchaseId?: string | null;
    at?: string;
    actorUserId?: string | null;
    actorName?: string | null;
  },
): PharmacyBatchRecord {
  const at = input.at ?? new Date().toISOString();
  const qty = Math.max(0, Math.floor(input.quantityBase));
  const event = newEvent("received", at, {
    quantityDelta: qty,
    actorUserId: input.actorUserId ?? null,
    actorName: input.actorName ?? null,
    refId: input.purchaseId ?? null,
    note: input.notes ?? null,
  });
  return {
    id: crypto.randomUUID(),
    batchNumber: input.batchNumber.trim() || "—",
    lotNumber: input.lotNumber ?? null,
    supplierBatch: input.supplierBatch ?? null,
    supplierId: input.supplierId ?? null,
    supplierName: input.supplierName ?? null,
    purchaseId: input.purchaseId ?? null,
    purchaseInvoice: input.purchaseInvoice ?? null,
    purchaseDate: input.purchaseDate ?? dateKeyKampala(new Date(at)),
    manufactureDate: input.manufactureDate ?? null,
    expiryDate: input.expiryDate,
    quantityReceived: qty,
    quantityRemaining: qty,
    unitCostUgx: Math.max(0, Math.round(input.unitCostUgx)),
    sellingPriceUgx: input.sellingPriceUgx != null ? Math.round(input.sellingPriceUgx) : null,
    status: isExpiredDate(input.expiryDate, new Date(at)) ? "expired" : "active",
    location: input.location ?? null,
    notes: input.notes ?? null,
    receivedAt: at,
    timeline: [newEvent("created", at), event],
  };
}

export function appendBatchToProduct(product: Product, batch: PharmacyBatchRecord): Product {
  const pkg = product.pharmacyPackaging ?? {
    enabled: false,
    baseUnit: product.baseUnit,
    sell: { tablet: true, strip: false, box: false },
    batches: [],
  };
  const batches = [...(pkg.batches ?? []).map(normalizeBatchRecord).filter(Boolean) as PharmacyBatchRecord[], batch];
  const next: Product = {
    ...product,
    pharmacyPackaging: { ...pkg, batches },
    pharmacyMaster: {
      batchTracked: true,
      expiryTracked: true,
      ...product.pharmacyMaster,
    },
  };
  return reconcileProductExpiryFromBatches(next);
}

/** FEFO: sort active batches by expiry ascending. */
export function sortBatchesFefo(batches: PharmacyBatchRecord[]): PharmacyBatchRecord[] {
  return batches
    .filter((b) => b.quantityRemaining > 0 && (b.status === "active" || b.status === "expired"))
    .slice()
    .sort((a, b) => {
      const cmp = a.expiryDate.localeCompare(b.expiryDate);
      if (cmp !== 0) return cmp;
      return a.receivedAt.localeCompare(b.receivedAt);
    });
}

export function allocateFefo(
  batches: PharmacyBatchRecord[],
  quantity: number,
  overrideBatchId?: string | null,
): FefoAllocationResult {
  const qty = Math.max(0, Math.floor(quantity));
  if (qty <= 0) return { allocations: [], remainingUnallocated: 0, usedOverride: false };

  if (overrideBatchId) {
    const batch = batches.find((b) => b.id === overrideBatchId);
    if (!batch || batch.quantityRemaining <= 0) {
      return { allocations: [], remainingUnallocated: qty, usedOverride: true };
    }
    const take = Math.min(batch.quantityRemaining, qty);
    return {
      allocations: [
        {
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          expiryDate: batch.expiryDate,
          quantity: take,
        },
      ],
      remainingUnallocated: qty - take,
      usedOverride: true,
    };
  }

  const sorted = sortBatchesFefo(batches);
  const allocations: FefoAllocation[] = [];
  let left = qty;
  for (const batch of sorted) {
    if (left <= 0) break;
    const take = Math.min(batch.quantityRemaining, left);
    if (take <= 0) continue;
    allocations.push({
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
      quantity: take,
    });
    left -= take;
  }
  return { allocations, remainingUnallocated: left, usedOverride: false };
}

/** Restore quantity to specific batches (controlled returns, void restock). */
export function applyBatchRestorations(
  product: Product,
  allocations: FefoAllocation[],
  event: { type: PharmacyBatchEventType; at: string; refId?: string; actorUserId?: string | null; actorName?: string | null; note?: string | null },
): Product {
  const batches = getProductBatches(product);
  if (!batches.length) return product;
  const byId = new Map(allocations.map((a) => [a.batchId, a.quantity]));
  const updated = batches.map((batch) => {
    const add = byId.get(batch.id) ?? 0;
    if (add <= 0) return batch;
    const remaining = batch.quantityRemaining + add;
    const timeline = [
      ...batch.timeline,
      newEvent(event.type, event.at, {
        quantityDelta: add,
        refId: event.refId ?? null,
        actorUserId: event.actorUserId ?? null,
        actorName: event.actorName ?? null,
        note: event.note ?? null,
      }),
    ];
    let status: PharmacyBatchStatus = batch.status;
    if (remaining > 0 && status === "depleted") status = "active";
    else if (remaining > 0 && isExpiredDate(batch.expiryDate, new Date(event.at))) status = "expired";
    return { ...batch, quantityRemaining: remaining, status, timeline };
  });
  const pkg = product.pharmacyPackaging!;
  const next = reconcileProductExpiryFromBatches({
    ...product,
    pharmacyPackaging: { ...pkg, batches: updated },
  });
  return next;
}

export function applyBatchDeductions(
  product: Product,
  allocations: FefoAllocation[],
  event: { type: PharmacyBatchEventType; at: string; refId?: string; actorUserId?: string; actorName?: string; note?: string },
): Product {
  const batches = getProductBatches(product);
  if (!batches.length) return product;
  const byId = new Map(allocations.map((a) => [a.batchId, a.quantity]));
  const updated = batches.map((batch) => {
    const deduct = byId.get(batch.id) ?? 0;
    if (deduct <= 0) return batch;
    const remaining = Math.max(0, batch.quantityRemaining - deduct);
    const timeline = [
      ...batch.timeline,
      newEvent(event.type, event.at, {
        quantityDelta: -deduct,
        refId: event.refId ?? null,
        actorUserId: event.actorUserId ?? null,
        actorName: event.actorName ?? null,
        note: event.note ?? null,
      }),
    ];
    let status: PharmacyBatchStatus = batch.status;
    if (remaining <= 0) status = "depleted";
    else if (isExpiredDate(batch.expiryDate, new Date(event.at))) status = "expired";
    return { ...batch, quantityRemaining: remaining, status, timeline };
  });
  const pkg = product.pharmacyPackaging!;
  return reconcileProductExpiryFromBatches({
    ...product,
    pharmacyPackaging: { ...pkg, batches: updated },
  });
}

export function deductProductBatchesFefo(
  product: Product,
  quantity: number,
  opts?: {
    overrideBatchId?: string | null;
    at?: string;
    refId?: string;
    actorUserId?: string;
    actorName?: string;
    eventType?: PharmacyBatchEventType;
  },
): { product: Product; allocations: FefoAllocation[]; usedOverride: boolean } {
  const batches = getProductBatches(product);
  if (!batches.length || !isBatchTrackedProduct(product)) {
    return { product, allocations: [], usedOverride: false };
  }
  const result = allocateFefo(batches, quantity, opts?.overrideBatchId);
  const at = opts?.at ?? new Date().toISOString();
  const next = applyBatchDeductions(product, result.allocations, {
    type: opts?.eventType ?? "dispensed",
    at,
    refId: opts?.refId,
    actorUserId: opts?.actorUserId,
    actorName: opts?.actorName,
  });
  return { product: next, allocations: result.allocations, usedOverride: result.usedOverride };
}

export function computeMedicineBatchSummary(product: Product): MedicineBatchSummary {
  const batches = getProductBatches(product);
  const active = batches.filter((b) => b.quantityRemaining > 0);
  const today = new Date();
  let expiredQty = 0;
  let nearExpiryQty = 0;
  for (const b of active) {
    const bucket = expiryBucketForDate(b.expiryDate, today);
    if (bucket === "expired") expiredQty += b.quantityRemaining;
    else if (bucket && bucket !== "d90") nearExpiryQty += b.quantityRemaining;
  }
  const nearest = active
    .slice()
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))[0]?.expiryDate ?? null;
  const stockValueUgx = active.reduce(
    (sum, b) => sum + b.quantityRemaining * (b.unitCostUgx || product.costPricePerUnitUgx),
    0,
  );
  const hasNegativeBatch = batches.some((b) => b.quantityRemaining < 0);
  const hasNoBatch = isBatchTrackedProduct(product) && batches.length === 0 && product.stockOnHand > 0;
  return {
    batchCount: batches.length,
    activeBatchCount: active.length,
    nearestExpiry: nearest,
    expiredQty,
    nearExpiryQty,
    reservedQty: 0,
    stockValueUgx: Math.round(stockValueUgx || lineCostForProductQuantity(product, product.stockOnHand)),
    hasNegativeBatch,
    hasNoBatch,
  };
}

export function buildExpiryCenterRows(products: Product[], today: Date = new Date()): ExpiryBucketRow[] {
  const rows: ExpiryBucketRow[] = [];
  for (const product of products) {
    if (product.stockOnHand <= 0) continue;
    const batches = getProductBatches(product);
    const items =
      batches.length > 0
        ? batches.filter((b) => b.quantityRemaining > 0)
        : product.expiryDate
          ? [
              {
                id: `legacy-${product.id}`,
                batchNumber: "—",
                expiryDate: product.expiryDate,
                quantityRemaining: product.stockOnHand,
                unitCostUgx: product.costPricePerUnitUgx,
                supplierName: null,
                location: null,
              } as PharmacyBatchRecord,
            ]
          : [];
    for (const batch of items) {
      const bucket = expiryBucketForDate(batch.expiryDate, today);
      if (!bucket) continue;
      rows.push({
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        productId: product.id,
        productName: product.name,
        genericName: product.pharmacyMaster?.genericName ?? null,
        strength: product.medicineStrength ?? null,
        expiryDate: batch.expiryDate,
        quantity: batch.quantityRemaining,
        valueUgx: Math.round(batch.quantityRemaining * (batch.unitCostUgx || product.costPricePerUnitUgx)),
        supplierName: batch.supplierName ?? null,
        location: batch.location ?? null,
        bucket,
      });
    }
  }
  const order: ExpiryBucketRow["bucket"][] = ["expired", "today", "d7", "d30", "d60", "d90"];
  return rows.sort((a, b) => {
    const bi = order.indexOf(a.bucket) - order.indexOf(b.bucket);
    if (bi !== 0) return bi;
    return a.expiryDate.localeCompare(b.expiryDate);
  });
}

export function writeOffFromBatches(
  product: Product,
  quantity: number,
  reason: PharmacyWriteOffReason,
  opts?: { batchId?: string; at?: string; actorUserId?: string; actorName?: string; note?: string },
): { product: Product; lossValueUgx: number; writtenOff: number } {
  const batches = getProductBatches(product);
  const at = opts?.at ?? new Date().toISOString();
  let allocations: FefoAllocation[] = [];
  if (opts?.batchId) {
    const batch = batches.find((b) => b.id === opts.batchId);
    if (batch) {
      const take = Math.min(batch.quantityRemaining, quantity);
      allocations = [{ batchId: batch.id, batchNumber: batch.batchNumber, expiryDate: batch.expiryDate, quantity: take }];
    }
  } else if (reason === "expired") {
    const expiredBatches = batches.filter((b) => b.quantityRemaining > 0 && isExpiredDate(b.expiryDate, new Date(at)));
    let left = quantity;
    for (const batch of expiredBatches) {
      if (left <= 0) break;
      const take = Math.min(batch.quantityRemaining, left);
      allocations.push({ batchId: batch.id, batchNumber: batch.batchNumber, expiryDate: batch.expiryDate, quantity: take });
      left -= take;
    }
  } else {
    const fefo = allocateFefo(batches, quantity);
    allocations = fefo.allocations;
  }
  const writtenOff = allocations.reduce((s, a) => s + a.quantity, 0);
  const lossValueUgx = allocations.reduce((s, a) => {
    const batch = batches.find((b) => b.id === a.batchId);
    const cost = batch?.unitCostUgx ?? product.costPricePerUnitUgx;
    return s + a.quantity * cost;
  }, 0);
  let next = applyBatchDeductions(product, allocations, {
    type: "written_off",
    at,
    note: `${reason}${opts?.note ? `: ${opts.note}` : ""}`,
    actorUserId: opts?.actorUserId,
    actorName: opts?.actorName,
  });
  const updatedBatches = getProductBatches(next).map((b) => {
    const alloc = allocations.find((a) => a.batchId === b.id);
    if (!alloc) return b;
    return { ...b, status: "written_off" as PharmacyBatchStatus };
  });
  if (next.pharmacyPackaging) {
    next = { ...next, pharmacyPackaging: { ...next.pharmacyPackaging, batches: updatedBatches } };
  }
  return { product: reconcileProductExpiryFromBatches(next), lossValueUgx: Math.round(lossValueUgx), writtenOff };
}

export function defaultPharmacyMaster(product: Product): PharmacyMedicineMaster {
  return {
    brandName: product.name,
    genericName: product.pharmacyMaster?.genericName ?? null,
    batchTracked: true,
    expiryTracked: true,
    controlledDrug: false,
    refrigerated: false,
    hazardous: false,
    otcOrPrescription: "otc",
    barcodes: product.pharmacyMaster?.barcodes ?? (product.sku ? [product.sku] : []),
    ...product.pharmacyMaster,
  };
}

export function medicineDisplayBrand(product: Product): string {
  return product.pharmacyMaster?.brandName?.trim() || product.name;
}

export function medicineDisplayGeneric(product: Product): string | null {
  return product.pharmacyMaster?.genericName?.trim() || null;
}

export function normalizePharmacyMaster(raw: unknown): PharmacyMedicineMaster | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    brandName: r.brandName != null ? String(r.brandName) : null,
    genericName: r.genericName != null ? String(r.genericName) : null,
    manufacturer: r.manufacturer != null ? String(r.manufacturer) : null,
    country: r.country != null ? String(r.country) : null,
    registrationNumber: r.registrationNumber != null ? String(r.registrationNumber) : null,
    medicineCategory: r.medicineCategory != null ? String(r.medicineCategory) : null,
    otcOrPrescription: r.otcOrPrescription === "prescription" ? "prescription" : r.otcOrPrescription === "otc" ? "otc" : null,
    controlledDrug: Boolean(r.controlledDrug),
    controlledSchedule:
      r.controlledSchedule === "schedule_2" ||
      r.controlledSchedule === "schedule_3" ||
      r.controlledSchedule === "schedule_4" ||
      r.controlledSchedule === "narcotic" ||
      r.controlledSchedule === "psychotropic"
        ? r.controlledSchedule
        : r.controlledDrug
          ? "schedule_3"
          : "none",
    regulatoryCategory: r.regulatoryCategory != null ? String(r.regulatoryCategory) : null,
    maxQuantityPerDispense:
      r.maxQuantityPerDispense != null ? Math.max(0, Math.floor(Number(r.maxQuantityPerDispense))) : null,
    managerOverrideRequired: r.managerOverrideRequired != null ? Boolean(r.managerOverrideRequired) : Boolean(r.controlledDrug),
    witnessRequired: Boolean(r.witnessRequired),
    refrigerated: Boolean(r.refrigerated),
    hazardous: Boolean(r.hazardous),
    batchTracked: r.batchTracked !== false,
    expiryTracked: r.expiryTracked !== false,
    barcodes: Array.isArray(r.barcodes) ? r.barcodes.map(String) : [],
    supplierSku: r.supplierSku != null ? String(r.supplierSku) : null,
    storageNotes: r.storageNotes != null ? String(r.storageNotes) : null,
  };
}

export type BatchIntegrityResult = {
  ok: boolean;
  stockOnHand: number;
  batchSum: number;
  delta: number;
  batchTracked: boolean;
  batches: PharmacyBatchRecord[];
};

/** Compare sum(batch remaining) with stockOnHand — never auto-repairs. */
export function computeBatchIntegrity(product: Product): BatchIntegrityResult {
  const batches = getProductBatches(product);
  const batchTracked = isBatchTrackedProduct(product);
  const batchSum = sumBatchRemaining(batches);
  const stockOnHand = Math.max(0, Math.floor(product.stockOnHand));
  if (!batchTracked || batches.length === 0) {
    return { ok: true, stockOnHand, batchSum, delta: 0, batchTracked, batches };
  }
  return {
    ok: batchSum === stockOnHand,
    stockOnHand,
    batchSum,
    delta: stockOnHand - batchSum,
    batchTracked,
    batches,
  };
}

/** Attach FEFO preview fields to a draft sale line. */
export function withPharmacyFefoPreview(
  line: import("../types").SaleLine,
  product: Product,
  overrideBatchId?: string | null,
): import("../types").SaleLine {
  if (!isBatchTrackedProduct(product)) return line;
  const batches = getProductBatches(product);
  if (!batches.length) return line;
  const batchId = overrideBatchId ?? line.pharmacyBatchOverrideId ?? null;
  const result = allocateFefo(batches, line.quantity, batchId);
  const first = result.allocations[0];
  return {
    ...line,
    pharmacyBatchOverrideId: batchId,
    pharmacyBatchNumber: first?.batchNumber ?? null,
    pharmacyBatchExpiry: first?.expiryDate ?? null,
  };
}

export const BATCH_EVENT_I18N: Record<PharmacyBatchEventType, string> = {
  created: "pharmacyBatchEventCreated",
  received: "pharmacyBatchEventReceived",
  adjusted: "pharmacyBatchEventAdjusted",
  transferred: "pharmacyBatchEventTransferred",
  dispensed: "pharmacyBatchEventDispensed",
  returned: "pharmacyBatchEventReturned",
  written_off: "pharmacyBatchEventWrittenOff",
  expired: "pharmacyBatchEventExpired",
  fefo_override: "pharmacyBatchEventFefoOverride",
};

export function formatBatchEventMeta(ev: PharmacyBatchEvent, lang: import("../types").Language): string {
  const parts: string[] = [];
  if (ev.actorName?.trim()) parts.push(ev.actorName.trim());
  if (ev.businessDate?.trim()) parts.push(ev.businessDate.trim());
  if (ev.deviceId?.trim()) parts.push(ev.deviceId.trim().slice(0, 8));
  if (ev.online === false) parts.push(lang === "sw" ? "offline" : "offline");
  return parts.join(" · ");
}
