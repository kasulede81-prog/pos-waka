/**
 * Debt sync hydration state — gates safe integrity repair when cloud history is incomplete.
 */

import { hasSupabaseConfig } from "./supabase";
import { readSyncCheckpoints } from "./syncCheckpoints";

export type DebtSyncHydrationState = {
  syncKnown: boolean;
  paymentsHydrated: boolean;
  customersHydrated: boolean;
  salesHydrated: boolean;
  lastDebtPaymentsSyncAt: string | null;
};

export function evaluateDebtSyncHydration(): DebtSyncHydrationState {
  if (!hasSupabaseConfig) {
    return {
      syncKnown: true,
      paymentsHydrated: true,
      customersHydrated: true,
      salesHydrated: true,
      lastDebtPaymentsSyncAt: null,
    };
  }

  const cp = readSyncCheckpoints();
  const bootstrap = cp.bootstrapComplete;
  return {
    syncKnown: bootstrap,
    paymentsHydrated: bootstrap && cp.lastDebtPaymentsSyncAt != null,
    customersHydrated: bootstrap && cp.lastCustomersSyncAt != null,
    salesHydrated: bootstrap && cp.lastSalesSyncAt != null,
    lastDebtPaymentsSyncAt: cp.lastDebtPaymentsSyncAt,
  };
}

export function isDebtLedgerAuthoritative(): boolean {
  const h = evaluateDebtSyncHydration();
  return h.paymentsHydrated && h.customersHydrated && h.salesHydrated;
}

export type DebtHealSafety = { ok: true } | { ok: false; reasonKey: string };

export function canSafelyHealCustomerDebt(): DebtHealSafety {
  if (!hasSupabaseConfig) return { ok: true };

  const h = evaluateDebtSyncHydration();
  if (!h.syncKnown) return { ok: false, reasonKey: "debtHealSyncIncomplete" };
  if (!h.salesHydrated) return { ok: false, reasonKey: "debtHealSalesIncomplete" };
  if (!h.customersHydrated) return { ok: false, reasonKey: "debtHealCustomersIncomplete" };
  if (!h.paymentsHydrated) return { ok: false, reasonKey: "debtHealPaymentsIncomplete" };
  return { ok: true };
}
