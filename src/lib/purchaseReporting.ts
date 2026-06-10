/**
 * Purchase & supplier visibility — read-only reporting over existing store data.
 */

import type { AuditLogEntry, Product, Purchase, PurchaseLine, Sale, StockMovement, Supplier, SupplierPayment } from "../types";
import { dateKeyDaysAgoKampala, dateKeyKampala } from "./datesUg";
import {
  dateMatchesFilter,
  resolveDateFilterBounds,
  type DateFilterBounds,
  type DateFilterPreset,
  type DateFilterValue,
} from "./dateFilters";
import { isPurchaseVoided } from "./purchaseCorrections";
import { isWalkInSupplierId } from "./walkInSupplier";
import { isLowStock, lowStockThreshold, purchaseLineCostTotalUgx } from "./sellingEngine";

export type PurchaseListFilter =
  | { kind: "preset"; preset: DateFilterPreset }
  | { kind: "day"; dateKey: string }
  | { kind: "range"; fromKey: string; toKey: string };

export function resolvePurchaseFilterBounds(filter: PurchaseListFilter, now: Date = new Date()): DateFilterBounds {
  if (filter.kind === "range") {
    const fromKey = filter.fromKey <= filter.toKey ? filter.fromKey : filter.toKey;
    const toKey = filter.fromKey <= filter.toKey ? filter.toKey : filter.fromKey;
    return { fromKey, toKey, isSingleDay: fromKey === toKey };
  }
  if (filter.kind === "day") {
    return { fromKey: filter.dateKey, toKey: filter.dateKey, isSingleDay: true };
  }
  return resolveDateFilterBounds({ kind: "preset", preset: filter.preset }, now);
}

export function purchaseMatchesBounds(purchase: Pick<Purchase, "createdAt">, bounds: DateFilterBounds): boolean {
  return dateMatchesFilter(dateKeyKampala(purchase.createdAt), bounds);
}

export function filterPurchases(purchases: Purchase[], bounds: DateFilterBounds): Purchase[] {
  return purchases.filter((p) => purchaseMatchesBounds(p, bounds));
}

export type PurchaseSearchQuery = {
  supplier?: string;
  product?: string;
  invoiceNumber?: string;
};

export function searchPurchases(
  purchases: Purchase[],
  products: Product[],
  query: PurchaseSearchQuery,
): Purchase[] {
  const supplierQ = query.supplier?.trim().toLowerCase() ?? "";
  const productQ = query.product?.trim().toLowerCase() ?? "";
  const invoiceQ = query.invoiceNumber?.trim().toLowerCase() ?? "";
  if (!supplierQ && !productQ && !invoiceQ) return purchases;

  const productById = new Map(products.map((p) => [p.id, p]));

  return purchases.filter((p) => {
    if (supplierQ && !p.supplierName.toLowerCase().includes(supplierQ)) return false;
    if (invoiceQ) {
      const inv = (p.invoiceNumber ?? "").toLowerCase();
      const notes = (p.notes ?? "").toLowerCase();
      if (!inv.includes(invoiceQ) && !notes.includes(invoiceQ)) return false;
    }
    if (productQ) {
      const hit = p.lines.some((ln) => {
        const name = ln.name.toLowerCase();
        const prod = productById.get(ln.productId);
        const prodName = prod?.name.toLowerCase() ?? "";
        return name.includes(productQ) || prodName.includes(productQ);
      });
      if (!hit) return false;
    }
    return true;
  });
}

export function purchaseQuantityReceived(purchaseId: string, movements: StockMovement[]): number {
  let qty = 0;
  for (const m of movements) {
    if (m.refId === purchaseId && m.kind === "purchase_in") qty += Math.max(0, m.deltaBaseUnits);
  }
  if (qty > 0) return qty;
  return 0;
}

export function purchaseQuantityReceivedForPurchase(
  purchase: Purchase,
  movements: StockMovement[],
): number {
  const fromMovements = purchaseQuantityReceived(purchase.id, movements);
  if (fromMovements > 0) return fromMovements;
  return purchase.lines.reduce((sum, ln) => sum + Math.max(0, ln.qtyBuyingUnits), 0);
}

export type PurchaseListRow = {
  purchase: Purchase;
  dayKey: string;
  productCount: number;
  quantityReceived: number;
  balanceRemainingUgx: number;
};

export function buildPurchaseListRows(
  purchases: Purchase[],
  movements: StockMovement[],
): PurchaseListRow[] {
  return purchases.map((purchase) => ({
    purchase,
    dayKey: dateKeyKampala(purchase.createdAt),
    productCount: purchase.lines.length,
    quantityReceived: purchaseQuantityReceivedForPurchase(purchase, movements),
    balanceRemainingUgx: isPurchaseVoided(purchase) ? 0 : Math.max(0, purchase.balanceDeltaUgx),
  }));
}

export function purchaseLineTotalUgx(line: PurchaseLine): number {
  return purchaseLineCostTotalUgx(line);
}

export function findPurchaseAudit(auditLogs: AuditLogEntry[], purchaseId: string): AuditLogEntry | null {
  for (const entry of auditLogs) {
    if (entry.action !== "purchase_saved") continue;
    if (entry.payload.purchaseId === purchaseId) return entry;
  }
  return null;
}

export type SupplierStatementEntry =
  | {
      kind: "purchase";
      id: string;
      at: string;
      dayKey: string;
      label: string;
      amountUgx: number;
      deltaUgx: number;
      runningBalanceUgx: number;
      purchaseId: string;
    }
  | {
      kind: "payment";
      id: string;
      at: string;
      dayKey: string;
      label: string;
      amountUgx: number;
      deltaUgx: number;
      runningBalanceUgx: number;
      paymentId: string;
    };

export function buildSupplierStatement(
  supplierId: string,
  supplierName: string,
  purchases: Purchase[],
  payments: SupplierPayment[],
): SupplierStatementEntry[] {
  if (isWalkInSupplierId(supplierId)) return [];

  type Raw =
    | { kind: "purchase"; at: string; id: string; purchase: Purchase }
    | { kind: "payment"; at: string; id: string; payment: SupplierPayment };

  const raw: Raw[] = [];
  for (const p of purchases) {
    if (p.supplierId !== supplierId || isWalkInSupplierId(p.supplierId) || isPurchaseVoided(p)) continue;
    raw.push({ kind: "purchase", at: p.createdAt, id: p.id, purchase: p });
  }
  for (const pay of payments) {
    if (pay.supplierId !== supplierId) continue;
    raw.push({ kind: "payment", at: pay.createdAt, id: pay.id, payment: pay });
  }

  raw.sort((a, b) => {
    const ta = new Date(a.at).getTime();
    const tb = new Date(b.at).getTime();
    if (ta !== tb) return ta - tb;
    if (a.kind !== b.kind) return a.kind === "purchase" ? -1 : 1;
    return a.id.localeCompare(b.id);
  });

  let balance = 0;
  const out: SupplierStatementEntry[] = [];

  for (const row of raw) {
    if (row.kind === "purchase") {
      const delta = row.purchase.balanceDeltaUgx;
      balance += delta;
      out.push({
        kind: "purchase",
        id: row.id,
        at: row.at,
        dayKey: dateKeyKampala(row.at),
        label: supplierName,
        amountUgx: row.purchase.totalCostUgx,
        deltaUgx: delta,
        runningBalanceUgx: balance,
        purchaseId: row.id,
      });
    } else {
      const payAmt = row.payment.amountUgx;
      const delta = -payAmt;
      balance = Math.max(0, balance - payAmt);
      out.push({
        kind: "payment",
        id: row.id,
        at: row.at,
        dayKey: dateKeyKampala(row.at),
        label: supplierName,
        amountUgx: payAmt,
        deltaUgx: delta,
        runningBalanceUgx: balance,
        paymentId: row.id,
      });
    }
  }

  return out;
}

export function filterSupplierPayments(
  payments: SupplierPayment[],
  bounds: DateFilterBounds,
  supplierId?: string,
): SupplierPayment[] {
  return payments.filter((p) => {
    if (supplierId && p.supplierId !== supplierId) return false;
    if (isWalkInSupplierId(p.supplierId)) return false;
    return dateMatchesFilter(dateKeyKampala(p.createdAt), bounds);
  });
}

export function sumSupplierPaymentsUgx(payments: SupplierPayment[]): number {
  return payments.reduce((sum, p) => sum + Math.max(0, p.amountUgx), 0);
}

export type SupplierSummary = {
  totalSuppliers: number;
  totalDebtUgx: number;
  suppliersWithBalance: number;
  largestBalanceUgx: number;
  largestBalanceSupplierName: string | null;
};

export function buildSupplierSummary(suppliers: Supplier[]): SupplierSummary {
  const real = suppliers.filter((s) => !isWalkInSupplierId(s.id));
  let totalDebtUgx = 0;
  let suppliersWithBalance = 0;
  let largestBalanceUgx = 0;
  let largestBalanceSupplierName: string | null = null;

  for (const s of real) {
    const bal = Math.max(0, s.balanceOwedUgx);
    totalDebtUgx += bal;
    if (bal > 0) suppliersWithBalance += 1;
    if (bal > largestBalanceUgx) {
      largestBalanceUgx = bal;
      largestBalanceSupplierName = s.name;
    }
  }

  return {
    totalSuppliers: real.length,
    totalDebtUgx,
    suppliersWithBalance,
    largestBalanceUgx,
    largestBalanceSupplierName,
  };
}

export type RestockProductSuggestion = {
  productId: string;
  name: string;
  stockOnHand: number;
  minimumStock: number;
  suggestedQty: number;
  reason: "low" | "running_low";
};

function suggestedRestockQty(product: Product): number {
  const min = lowStockThreshold(product);
  const target = min > 0 ? min * 2 : Math.max(product.minimumStockAlert * 2, 1);
  return Math.max(1, Math.ceil(target - product.stockOnHand));
}

function unitsSoldLast7(productId: string, sales: Sale[]): number {
  let u = 0;
  for (let d = 0; d < 7; d++) {
    const k = dateKeyDaysAgoKampala(d);
    for (const s of sales) {
      if (dateKeyKampala(s.createdAt) !== k) continue;
      for (const line of s.lines) {
        if (line.productId === productId && !line.voided) u += line.quantity;
      }
    }
  }
  return u;
}

export function buildRestockProductSuggestions(
  products: Product[],
  sales: Sale[],
  max = 8,
): RestockProductSuggestion[] {
  const out: RestockProductSuggestion[] = [];
  const seen = new Set<string>();

  for (const p of products) {
    if (out.length >= max) break;
    if (!isLowStock(p) || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({
      productId: p.id,
      name: p.name,
      stockOnHand: p.stockOnHand,
      minimumStock: lowStockThreshold(p),
      suggestedQty: suggestedRestockQty(p),
      reason: "low",
    });
  }

  for (const p of products) {
    if (out.length >= max) break;
    if (seen.has(p.id) || isLowStock(p)) continue;
    const sold = unitsSoldLast7(p.id, sales);
    const avg = sold / 7;
    if (avg >= 0.35 && p.stockOnHand > 0 && p.stockOnHand < avg * 6) {
      seen.add(p.id);
      out.push({
        productId: p.id,
        name: p.name,
        stockOnHand: p.stockOnHand,
        minimumStock: lowStockThreshold(p),
        suggestedQty: suggestedRestockQty(p),
        reason: "running_low",
      });
    }
  }

  return out;
}

/** Map DateFilterValue to PurchaseListFilter for shared preset UI. */
export function purchaseFilterFromDateFilter(value: DateFilterValue): PurchaseListFilter {
  if (value.kind === "day") return { kind: "day", dateKey: value.dateKey };
  return { kind: "preset", preset: value.preset };
}
