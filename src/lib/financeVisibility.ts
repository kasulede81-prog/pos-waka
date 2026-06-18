import type { UserRole } from "../types";

/** Shop-wide summary metrics (stock value at cost, shop expenses, total receivables, profit). */
export function canSeeShopWideFinancialSummaries(role: UserRole): boolean {
  return role === "owner" || role === "manager" || role === "supervisor";
}

/** Owner-only finance diagnostics and margin analytics. */
export function canSeeFinanceDiagnostics(role: UserRole): boolean {
  return role === "owner";
}
