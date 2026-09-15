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
