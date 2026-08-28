import type { Sale } from "../types";

/** Client UI label: pending · DB value: draft */
export type SaleStatus = "completed" | "pending" | "cancelled";

export function saleStatusOf(s: Sale): SaleStatus {
  if (s.status === "pending" || s.status === "cancelled" || s.status === "completed") return s.status;
  return "completed";
}

export function isCompletedSale(s: Sale): boolean {
  return saleStatusOf(s) === "completed";
}

/** Phase 7.1 — settled hospitality bill voided (sale preserved for audit). */
export function isVoidedSale(s: Sale): boolean {
  return Boolean(s.saleVoidedAt?.trim());
}

/** Alias — revenue metrics must use completed sales only (excludes open/pending bills). */
export function isRevenueSale(s: Sale): boolean {
  return isCompletedSale(s) && !isVoidedSale(s);
}

export function isPendingSale(s: Sale): boolean {
  return saleStatusOf(s) === "pending";
}

export function completedSales(sales: Sale[]): Sale[] {
  return sales.filter((s) => isCompletedSale(s) && !isVoidedSale(s));
}

export function pendingSales(sales: Sale[]): Sale[] {
  return sales.filter(isPendingSale);
}

/**
 * Cart voided before completion. Canonical store is cancelled + void metadata —
 * not Sale.status "voided" and not DB status "void" (cloud pull treats "void" as a tombstone).
 */
export const UNSAVED_CART_VOID_REASON = "unsaved_cart_before_completion";

export function isPreCompletionVoidedSale(s: Sale): boolean {
  return (
    saleStatusOf(s) === "cancelled" &&
    Boolean(s.saleVoidedAt?.trim()) &&
    s.saleVoidReason === UNSAVED_CART_VOID_REASON
  );
}

/** Pending-order cancel — cancelled without the unsaved-cart void marker. */
export function isCancelledPendingSale(s: Sale): boolean {
  return saleStatusOf(s) === "cancelled" && !isPreCompletionVoidedSale(s);
}

/** History reference that does not consume completed-sale receiptSeq. */
export function voidedSaleHistoryNumber(sale: Sale): string {
  const compact = sale.id.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `VOID-${compact || sale.id.slice(0, 8).toUpperCase()}`;
}
