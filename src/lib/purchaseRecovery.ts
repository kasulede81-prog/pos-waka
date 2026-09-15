/**
 * Purchase void cloud sync — push payload, pull parse, and void-aware merge.
 */

import type { Purchase, PurchaseLine, Supplier, SupplierPayment } from "../types";
import { isPurchaseVoided } from "./purchaseCorrections";
import { isWalkInSupplierId } from "./walkInSupplier";
import { parsePurchaseLineFromCloud, serializePurchaseLineForCloud } from "./purchaseLineSync";
import { inventoryValueAtCostUgx as inventoryValueAtCostPrecise } from "./costPrecision";

export type CloudPurchaseRow = {
  record: Purchase;
  updatedAt: string;
};

export type CloudSupplierRow = {
  record: Supplier;
  updatedAt: string;
};

function recencyMs(createdAt: string, updatedAt?: string): number {
  const u = updatedAt ? new Date(updatedAt).getTime() : Number.NaN;
  if (!Number.isNaN(u)) return u;
  const c = new Date(createdAt).getTime();
  return Number.isNaN(c) ? 0 : c;
}

function voidRecencyMs(purchase: Purchase): number {
  if (purchase.voidedAt) return new Date(purchase.voidedAt).getTime();
  return 0;
}

function parseVoidFields(row: Record<string, unknown>): { voidedAt?: string; voidReason?: string } {
  const meta = row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {};
  const voidedRaw =
    row.voided_at ??
    row.voidedAt ??
    meta.voided_at ??
    meta.voidedAt;
  const voidedAt = voidedRaw != null && String(voidedRaw).trim() ? String(voidedRaw) : undefined;
  const reasonRaw = row.void_reason ?? row.voidReason ?? meta.void_reason ?? meta.voidReason;
  const voidReason = reasonRaw != null ? String(reasonRaw).trim() : undefined;
  return {
    ...(voidedAt ? { voidedAt } : {}),
    ...(voidReason ? { voidReason } : {}),
  };
}

function parsePurchaseLines(raw: unknown): PurchaseLine[] {
  if (!Array.isArray(raw)) return [];
  const lines: PurchaseLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const parsed = parsePurchaseLineFromCloud(item as Record<string, unknown>);
    if (parsed) lines.push(parsed);
  }
  return lines;
}

/** Build cloud push payload for shop_push_purchase RPC. */
export function buildPurchaseCloudPushPayload(purchase: Purchase): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: purchase.id,
    supplier_id: purchase.supplierId,
    supplier_name: purchase.supplierName,
    total_cost_ugx: purchase.totalCostUgx,
    amount_paid_ugx: purchase.amountPaidUgx,
    balance_delta_ugx: purchase.balanceDeltaUgx,
    notes: purchase.notes,
    created_at: purchase.createdAt,
    lines: purchase.lines.map(serializePurchaseLineForCloud),
    metadata: { wakaClient: true },
  };
  if (purchase.voidedAt) {
    payload.voided_at = purchase.voidedAt;
    payload.void_reason = purchase.voidReason ?? "";
  }
  return payload;
}

export function rowToPurchase(row: Record<string, unknown>): CloudPurchaseRow | null {
  const id = String(row.id ?? "").trim();
  if (!id) return null;

  const lines = parsePurchaseLines(row.lines);
  if (lines.length === 0) return null;

  const createdAt = String(row.created_at ?? new Date().toISOString());
  const updatedAt = String(row.updated_at ?? createdAt);
  const totalCostUgx = Math.max(0, Math.floor(Number(row.total_cost_ugx ?? 0)));
  const voidFields = parseVoidFields(row);

  const record: Purchase = {
    id,
    supplierId: String(row.supplier_id ?? ""),
    supplierName: String(row.supplier_name ?? ""),
    lines,
    totalCostUgx,
    amountPaidUgx: Math.max(0, Math.floor(Number(row.amount_paid_ugx ?? 0))),
    balanceDeltaUgx: Math.floor(Number(row.balance_delta_ugx ?? totalCostUgx)),
    notes: String(row.notes ?? ""),
    createdAt,
    pendingSync: false,
    ...voidFields,
  };

  return { record, updatedAt };
}

export function isSupplierDeletedMetadata(row: Record<string, unknown>): boolean {
  const meta = row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {};
  if (meta.deleted === true || meta.deleted === "true") return true;
  const deletedAt = meta.deletedAt ?? meta.deleted_at;
  return deletedAt != null && String(deletedAt).trim() !== "";
}

export function rowToSupplier(row: Record<string, unknown>): CloudSupplierRow | null {
  if (isSupplierDeletedMetadata(row)) return null;
  const id = String(row.id ?? "").trim();
  if (!id || isWalkInSupplierId(id)) return null;

  const createdAt = String(row.created_at ?? new Date().toISOString());
  const updatedAt = String(row.updated_at ?? createdAt);

  const record: Supplier = {
    id,
    name: String(row.name ?? "").trim() || "Supplier",
    phone: String(row.phone ?? ""),
    location: String(row.location ?? ""),
    notes: String(row.notes ?? ""),
    balanceOwedUgx: Math.max(0, Math.floor(Number(row.balance_owed_ugx ?? 0))),
    totalPurchasesUgx: Math.max(0, Math.floor(Number(row.total_purchases_ugx ?? 0))),
    lastSupplyAt: row.last_supply_at != null ? String(row.last_supply_at) : null,
    createdAt,
    version: 1,
  };

  return { record, updatedAt };
}

export function rowToSupplierPayment(row: Record<string, unknown>): SupplierPayment | null {
  const id = String(row.id ?? "").trim();
  const supplierId = String(row.supplier_id ?? "").trim();
  if (!id || !supplierId || isWalkInSupplierId(supplierId)) return null;

  const amountUgx = Math.max(0, Math.floor(Number(row.amount_ugx ?? 0)));
  if (amountUgx <= 0) return null;

  return {
    id,
    supplierId,
    amountUgx,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    pendingSync: false,
  };
}

/** Merge two purchase records — never unvoid; voided state wins by voidedAt recency. */
export function mergePurchaseRecord(local: Purchase, remote: Purchase): Purchase {
  const localVoid = isPurchaseVoided(local);
  const remoteVoid = isPurchaseVoided(remote);

  if (localVoid && !remoteVoid) return local;
  if (remoteVoid && !localVoid) return remote;
  if (localVoid && remoteVoid) {
    return voidRecencyMs(remote) >= voidRecencyMs(local) ? remote : local;
  }

  if (recencyMs(local.createdAt) <= recencyMs(remote.createdAt)) return remote;
  return local;
}

export function mergePurchasesForRecovery(local: Purchase[], remote: CloudPurchaseRow[]): Purchase[] {
  const map = new Map<string, { record: Purchase; updatedAt: string }>();

  for (const p of local) {
    map.set(p.id, { record: p, updatedAt: p.createdAt });
  }

  for (const { record, updatedAt } of remote) {
    const existing = map.get(record.id);
    if (!existing) {
      map.set(record.id, { record, updatedAt });
      continue;
    }
    const merged = mergePurchaseRecord(existing.record, record);
    const winnerUpdatedAt =
      merged === record
        ? updatedAt
        : existing.updatedAt;
    map.set(record.id, { record: merged, updatedAt: winnerUpdatedAt });
  }

  return [...map.values()]
    .map((x) => x.record)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export function mergeSuppliersForRecovery(local: Supplier[], remote: CloudSupplierRow[]): Supplier[] {
  const map = new Map<string, { record: Supplier; updatedAt: string }>();

  for (const s of local) {
    if (isWalkInSupplierId(s.id)) continue;
    map.set(s.id, { record: s, updatedAt: s.createdAt });
  }

  for (const { record, updatedAt } of remote) {
    const existing = map.get(record.id);
    if (!existing) {
      map.set(record.id, { record, updatedAt });
      continue;
    }
    if (recencyMs(existing.record.createdAt, existing.updatedAt) <= recencyMs(record.createdAt, updatedAt)) {
      map.set(record.id, { record, updatedAt });
    }
  }

  return [...map.values()].map((x) => x.record);
}

export function mergeSupplierPaymentsForRecovery(
  local: SupplierPayment[],
  remote: SupplierPayment[],
): SupplierPayment[] {
  const map = new Map<string, SupplierPayment>();
  for (const p of local) map.set(p.id, p);
  for (const p of remote) {
    const existing = map.get(p.id);
    if (!existing || existing.createdAt <= p.createdAt) map.set(p.id, p);
  }
  return [...map.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * Rebuild supplier owed / lifetime purchase totals from purchase + payment history
 * (authoritative for recovery; preserves name/phone from merged master rows).
 */
export function reconcileSuppliersFromPurchaseHistory(
  suppliers: Supplier[],
  purchases: Purchase[],
  payments: SupplierPayment[],
): Supplier[] {
  const byId = new Map<string, Supplier>();

  for (const s of suppliers) {
    if (isWalkInSupplierId(s.id)) continue;
    byId.set(s.id, { ...s, totalPurchasesUgx: 0, balanceOwedUgx: 0 });
  }

  for (const p of purchases) {
    if (isWalkInSupplierId(p.supplierId) || isPurchaseVoided(p)) continue;
    let s = byId.get(p.supplierId);
    if (!s) {
      s = {
        id: p.supplierId,
        name: p.supplierName || "Supplier",
        phone: "",
        location: "",
        notes: "",
        balanceOwedUgx: 0,
        totalPurchasesUgx: 0,
        lastSupplyAt: null,
        createdAt: p.createdAt,
        version: 1,
      };
    }
    const lastSupplyAt = !s.lastSupplyAt || p.createdAt > s.lastSupplyAt ? p.createdAt : s.lastSupplyAt;
    byId.set(p.supplierId, {
      ...s,
      name: s.name || p.supplierName,
      totalPurchasesUgx: s.totalPurchasesUgx + p.totalCostUgx,
      balanceOwedUgx: s.balanceOwedUgx + p.balanceDeltaUgx,
      lastSupplyAt,
    });
  }

  for (const pay of payments) {
    if (isWalkInSupplierId(pay.supplierId)) continue;
    const s = byId.get(pay.supplierId);
    if (!s) continue;
    byId.set(pay.supplierId, {
      ...s,
      balanceOwedUgx: Math.max(0, s.balanceOwedUgx - pay.amountUgx),
    });
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function mergePurchaseRecoveryBundle(
  local: {
    purchases: Purchase[];
    suppliers: Supplier[];
    supplierPayments: SupplierPayment[];
  },
  remote: {
    purchaseCloudRows: CloudPurchaseRow[];
    supplierCloudRows: CloudSupplierRow[];
    supplierPayments: SupplierPayment[];
  },
): { purchases: Purchase[]; suppliers: Supplier[]; supplierPayments: SupplierPayment[] } {
  const purchases = mergePurchasesForRecovery(local.purchases, remote.purchaseCloudRows);
  const supplierPayments = mergeSupplierPaymentsForRecovery(local.supplierPayments, remote.supplierPayments);
  const suppliersMaster = mergeSuppliersForRecovery(local.suppliers, remote.supplierCloudRows);
  const suppliers = reconcileSuppliersFromPurchaseHistory(suppliersMaster, purchases, supplierPayments);
  return { purchases, suppliers, supplierPayments };
}

export function inventoryValueAtCostUgx(products: {
  stockOnHand: number;
  costPricePerUnitUgx: number;
  buyingPackCostUgx?: number | null;
  conversionRate?: number | null;
}[]): number {
  return inventoryValueAtCostPrecise(products);
}
