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

export function isPendingSale(s: Sale): boolean {
  return saleStatusOf(s) === "pending";
}

export function completedSales(sales: Sale[]): Sale[] {
  return sales.filter(isCompletedSale);
}

export function pendingSales(sales: Sale[]): Sale[] {
  return sales.filter(isPendingSale);
}
