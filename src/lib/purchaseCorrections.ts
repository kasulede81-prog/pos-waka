/**
 * Purchase & supplier corrections — void reversal math and supplier edit helpers.
 */

import type { AuditLogEntry, Product, Purchase, StockMovement, Supplier } from "../types";
import { isWalkInSupplierId } from "./walkInSupplier";

export function isPurchaseVoided(purchase: Pick<Purchase, "voidedAt">): boolean {
  return purchase.voidedAt != null && purchase.voidedAt.length > 0;
}

export function isActivePurchase(purchase: Purchase): boolean {
  return !isPurchaseVoided(purchase);
}

/** Supplier balance and totals after voiding one purchase. */
export function supplierTotalsAfterPurchaseVoid(
  supplier: Pick<Supplier, "balanceOwedUgx" | "totalPurchasesUgx">,
  purchase: Pick<Purchase, "balanceDeltaUgx" | "totalCostUgx">,
): { balanceOwedUgx: number; totalPurchasesUgx: number } {
  return {
    balanceOwedUgx: Math.max(0, supplier.balanceOwedUgx - purchase.balanceDeltaUgx),
    totalPurchasesUgx: Math.max(0, supplier.totalPurchasesUgx - purchase.totalCostUgx),
  };
}

export function lastSupplyAtForSupplier(supplierId: string, purchases: Purchase[]): string | null {
  let max: string | null = null;
  for (const p of purchases) {
    if (p.supplierId !== supplierId || isWalkInSupplierId(p.supplierId) || isPurchaseVoided(p)) continue;
    if (!max || p.createdAt > max) max = p.createdAt;
  }
  return max;
}

export type PurchaseVoidStockCheck = {
  ok: boolean;
  /** Product id → units to remove */
  deltas: Map<string, number>;
};

/** Validates stock can absorb a purchase void (uses purchase_in movements). */
export function validatePurchaseVoidStock(
  purchaseId: string,
  products: Product[],
  movements: StockMovement[],
): PurchaseVoidStockCheck {
  const productById = new Map(products.map((p) => [p.id, p]));
  const deltas = new Map<string, number>();

  for (const m of movements) {
    if (m.refId !== purchaseId || m.kind !== "purchase_in") continue;
    const cur = deltas.get(m.productId) ?? 0;
    deltas.set(m.productId, cur + Math.max(0, m.deltaBaseUnits));
  }

  for (const [productId, remove] of deltas) {
    const p = productById.get(productId);
    if (!p || p.stockOnHand < remove) return { ok: false, deltas };
  }

  return { ok: deltas.size > 0, deltas };
}

export type SupplierEditPatch = {
  name?: string;
  phone?: string;
  location?: string;
  notes?: string;
};

export type SupplierEditFieldChange = {
  field: keyof SupplierEditPatch;
  before: string;
  after: string;
};

/** Diff supplier profile fields for audit payload. */
export function diffSupplierEdit(
  before: Pick<Supplier, "name" | "phone" | "location" | "notes">,
  patch: SupplierEditPatch,
): SupplierEditFieldChange[] {
  const out: SupplierEditFieldChange[] = [];
  const fields: (keyof SupplierEditPatch)[] = ["name", "phone", "location", "notes"];
  for (const field of fields) {
    if (patch[field] === undefined) continue;
    const next = patch[field]!.trim();
    const prev = (before[field] ?? "").trim();
    if (next !== prev) out.push({ field, before: prev, after: next });
  }
  return out;
}

export function findPurchaseVoidAudit(auditLogs: AuditLogEntry[], purchaseId: string): AuditLogEntry | null {
  for (const entry of auditLogs) {
    if (entry.action !== "purchase_void") continue;
    if (entry.payload.purchaseId === purchaseId) return entry;
  }
  return null;
}

export function findSupplierEditAudit(auditLogs: AuditLogEntry[], supplierId: string): AuditLogEntry[] {
  return auditLogs.filter(
    (e) => e.action === "supplier_edit" && e.payload.supplierId === supplierId,
  );
}

export function supplierPaymentCreatedByLabel(
  payment: { createdByName?: string; createdByUserId?: string },
  audit?: AuditLogEntry | null,
): string {
  if (payment.createdByName?.trim()) return payment.createdByName.trim();
  if (payment.createdByUserId?.trim()) return payment.createdByUserId.trim();
  if (audit?.actorName?.trim()) return audit.actorName.trim();
  if (audit?.actorUserId?.trim()) return audit.actorUserId.trim();
  return "—";
}

export function findSupplierPaymentAudit(auditLogs: AuditLogEntry[], paymentId: string): AuditLogEntry | null {
  for (const entry of auditLogs) {
    if (entry.action !== "supplier_payment") continue;
    if (entry.payload.paymentId === paymentId) return entry;
  }
  return null;
}
