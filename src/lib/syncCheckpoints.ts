/** Per-entity cloud pull checkpoints (account-scoped, local only). */

import { getActiveAccountKey } from "../offline/accountScope";

const BASE_KEY = "waka.sync.checkpoints.v1";

export type SyncCheckpoints = {
  /** After first successful bootstrap pull, incremental mode is used. */
  bootstrapComplete: boolean;
  lastSalesSyncAt: string | null;
  lastProductsSyncAt: string | null;
  lastCustomersSyncAt: string | null;
  /** Legacy alias; mirrors lastDebtPaymentsSyncAt when debt payments are pulled. */
  lastDebtsSyncAt: string | null;
  /** customer_debt_payments pull cursor (created_at). */
  lastDebtPaymentsSyncAt: string | null;
  /** Shop expenses table (created_at cursor). */
  lastExpensesSyncAt: string | null;
  /** sale_returns table (updated_at cursor). */
  lastReturnsSyncAt: string | null;
  lastPurchasesSyncAt: string | null;
  lastSuppliersSyncAt: string | null;
  lastSupplierPaymentsSyncAt: string | null;
  /** shop_cash_drawer_adjustments pull cursor (updated_at). */
  lastCashDrawerAdjustmentsSyncAt: string | null;
  /** shop_day_drawer_opens pull cursor (updated_at). */
  lastDayDrawerOpensSyncAt: string | null;
};

const empty: SyncCheckpoints = {
  bootstrapComplete: false,
  lastSalesSyncAt: null,
  lastProductsSyncAt: null,
  lastCustomersSyncAt: null,
  lastDebtsSyncAt: null,
  lastDebtPaymentsSyncAt: null,
  lastExpensesSyncAt: null,
  lastReturnsSyncAt: null,
  lastPurchasesSyncAt: null,
  lastSuppliersSyncAt: null,
  lastSupplierPaymentsSyncAt: null,
  lastCashDrawerAdjustmentsSyncAt: null,
  lastDayDrawerOpensSyncAt: null,
};

function scopedKey(): string | null {
  const acc = getActiveAccountKey();
  if (!acc) return null;
  return `${BASE_KEY}::${acc}`;
}

export function readSyncCheckpoints(): SyncCheckpoints {
  try {
    const k = scopedKey();
    if (!k) return { ...empty };
    const raw = localStorage.getItem(k);
    if (!raw) return { ...empty };
    const o = JSON.parse(raw) as Partial<SyncCheckpoints>;
    return {
      bootstrapComplete: o.bootstrapComplete === true,
      lastSalesSyncAt: typeof o.lastSalesSyncAt === "string" ? o.lastSalesSyncAt : null,
      lastProductsSyncAt: typeof o.lastProductsSyncAt === "string" ? o.lastProductsSyncAt : null,
      lastCustomersSyncAt: typeof o.lastCustomersSyncAt === "string" ? o.lastCustomersSyncAt : null,
      lastDebtsSyncAt: typeof o.lastDebtsSyncAt === "string" ? o.lastDebtsSyncAt : null,
      lastDebtPaymentsSyncAt:
        typeof o.lastDebtPaymentsSyncAt === "string"
          ? o.lastDebtPaymentsSyncAt
          : typeof o.lastDebtsSyncAt === "string"
            ? o.lastDebtsSyncAt
            : null,
      lastExpensesSyncAt: typeof o.lastExpensesSyncAt === "string" ? o.lastExpensesSyncAt : null,
      lastReturnsSyncAt: typeof o.lastReturnsSyncAt === "string" ? o.lastReturnsSyncAt : null,
      lastPurchasesSyncAt: typeof o.lastPurchasesSyncAt === "string" ? o.lastPurchasesSyncAt : null,
      lastSuppliersSyncAt: typeof o.lastSuppliersSyncAt === "string" ? o.lastSuppliersSyncAt : null,
      lastSupplierPaymentsSyncAt:
        typeof o.lastSupplierPaymentsSyncAt === "string" ? o.lastSupplierPaymentsSyncAt : null,
      lastCashDrawerAdjustmentsSyncAt:
        typeof o.lastCashDrawerAdjustmentsSyncAt === "string" ? o.lastCashDrawerAdjustmentsSyncAt : null,
      lastDayDrawerOpensSyncAt:
        typeof o.lastDayDrawerOpensSyncAt === "string" ? o.lastDayDrawerOpensSyncAt : null,
    };
  } catch {
    return { ...empty };
  }
}

export function writeSyncCheckpoints(partial: Partial<SyncCheckpoints>): SyncCheckpoints {
  const next = { ...readSyncCheckpoints(), ...partial };
  try {
    const k = scopedKey();
    if (k) localStorage.setItem(k, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
}

export function clearSyncCheckpoints(): void {
  try {
    const k = scopedKey();
    if (k) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

/** Mark bootstrap done and set all entity cursors to the same timestamp. */
export function markBootstrapSyncComplete(at = new Date().toISOString()): SyncCheckpoints {
  return writeSyncCheckpoints({
    bootstrapComplete: true,
    lastSalesSyncAt: at,
    lastProductsSyncAt: at,
    lastCustomersSyncAt: at,
    lastDebtsSyncAt: at,
    lastDebtPaymentsSyncAt: at,
    lastExpensesSyncAt: at,
    lastReturnsSyncAt: at,
    lastPurchasesSyncAt: at,
    lastSuppliersSyncAt: at,
    lastSupplierPaymentsSyncAt: at,
    lastCashDrawerAdjustmentsSyncAt: at,
    lastDayDrawerOpensSyncAt: at,
  });
}

export function updateCheckpointsAfterIncrementalPull(partial: {
  sales?: boolean;
  products?: boolean;
  customers?: boolean;
  debts?: boolean;
  expenses?: boolean;
  returns?: boolean;
  purchases?: boolean;
  suppliers?: boolean;
  supplierPayments?: boolean;
  cashDrawerAdjustments?: boolean;
  dayDrawerOpens?: boolean;
  /** Fallback cursor when per-entity cursors are omitted. */
  at?: string;
  salesAt?: string;
  productsAt?: string;
  customersAt?: string;
  debtsAt?: string;
  debtPaymentsAt?: string;
  expensesAt?: string;
  returnsAt?: string;
  purchasesAt?: string;
  suppliersAt?: string;
  supplierPaymentsAt?: string;
  cashDrawerAdjustmentsAt?: string;
  dayDrawerOpensAt?: string;
}): SyncCheckpoints {
  const fallback = partial.at ?? new Date().toISOString();
  const patch: Partial<SyncCheckpoints> = {};
  if (partial.sales) patch.lastSalesSyncAt = partial.salesAt ?? fallback;
  if (partial.products) patch.lastProductsSyncAt = partial.productsAt ?? fallback;
  if (partial.customers) {
    patch.lastCustomersSyncAt = partial.customersAt ?? fallback;
  }
  if (partial.debts) {
    const debtAt = partial.debtPaymentsAt ?? partial.debtsAt ?? fallback;
    patch.lastDebtsSyncAt = debtAt;
    patch.lastDebtPaymentsSyncAt = debtAt;
  }
  if (partial.expenses) patch.lastExpensesSyncAt = partial.expensesAt ?? fallback;
  if (partial.returns) patch.lastReturnsSyncAt = partial.returnsAt ?? fallback;
  if (partial.purchases) patch.lastPurchasesSyncAt = partial.purchasesAt ?? fallback;
  if (partial.suppliers) patch.lastSuppliersSyncAt = partial.suppliersAt ?? fallback;
  if (partial.supplierPayments) patch.lastSupplierPaymentsSyncAt = partial.supplierPaymentsAt ?? fallback;
  if (partial.cashDrawerAdjustments) {
    patch.lastCashDrawerAdjustmentsSyncAt = partial.cashDrawerAdjustmentsAt ?? fallback;
  }
  if (partial.dayDrawerOpens) {
    patch.lastDayDrawerOpensSyncAt = partial.dayDrawerOpensAt ?? fallback;
  }
  return writeSyncCheckpoints(patch);
}

export function needsBootstrapPull(localEmpty: boolean): boolean {
  const cp = readSyncCheckpoints();
  return localEmpty || !cp.bootstrapComplete;
}
