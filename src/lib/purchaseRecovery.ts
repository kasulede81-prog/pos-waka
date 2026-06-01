/**
 * Purchase & supplier cloud hydration — map DB rows and reconcile supplier ledgers on recovery.
 */

import type { Purchase, PurchaseLine, Supplier, SupplierPayment } from "../types";
import { isWalkInSupplierId } from "./walkInSupplier";

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

function parsePurchaseLines(raw: unknown): PurchaseLine[] {
  if (!Array.isArray(raw)) return [];
  const lines: PurchaseLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const productId = String(o.productId ?? o.product_id ?? "").trim();
    if (!productId) continue;
    lines.push({
      productId,
      name: String(o.name ?? ""),
      qtyBuyingUnits: Math.max(0, Number(o.qtyBuyingUnits ?? o.qty_buying_units ?? 0)),
      costPerBuyingUnitUgx: Math.max(0, Math.floor(Number(o.costPerBuyingUnitUgx ?? o.cost_per_buying_unit_ugx ?? 0))),
    });
  }
  return lines;
}

export function rowToPurchase(row: Record<string, unknown>): CloudPurchaseRow | null {
  const id = String(row.id ?? "").trim();
  if (!id) return null;

  const lines = parsePurchaseLines(row.lines);
  if (lines.length === 0) return null;

  const createdAt = String(row.created_at ?? new Date().toISOString());
  const updatedAt = String(row.updated_at ?? createdAt);
  const totalCostUgx = Math.max(0, Math.floor(Number(row.total_cost_ugx ?? 0)));

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
  };

  return { record, updatedAt };
}

export function rowToSupplier(row: Record<string, unknown>): CloudSupplierRow | null {
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
    if (recencyMs(existing.record.createdAt, existing.updatedAt) <= recencyMs(record.createdAt, updatedAt)) {
      map.set(record.id, { record, updatedAt });
    }
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
    if (isWalkInSupplierId(p.supplierId)) continue;
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

export function inventoryValueAtCostUgx(products: { stockOnHand: number; costPricePerUnitUgx: number }[]): number {
  return products.reduce(
    (sum, p) => sum + Math.max(0, p.stockOnHand) * Math.max(0, p.costPricePerUnitUgx),
    0,
  );
}
