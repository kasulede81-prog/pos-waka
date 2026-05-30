/** Per-entity cloud pull checkpoints (account-scoped, local only). */

import { getActiveAccountKey } from "../offline/accountScope";

const BASE_KEY = "waka.sync.checkpoints.v1";

export type SyncCheckpoints = {
  /** After first successful bootstrap pull, incremental mode is used. */
  bootstrapComplete: boolean;
  lastSalesSyncAt: string | null;
  lastProductsSyncAt: string | null;
  lastCustomersSyncAt: string | null;
  /** Debt balances sync via customer rows; checkpoint mirrors customer pull. */
  lastDebtsSyncAt: string | null;
  /** Shop expenses table (created_at cursor). */
  lastExpensesSyncAt: string | null;
};

const empty: SyncCheckpoints = {
  bootstrapComplete: false,
  lastSalesSyncAt: null,
  lastProductsSyncAt: null,
  lastCustomersSyncAt: null,
  lastDebtsSyncAt: null,
  lastExpensesSyncAt: null,
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
      lastExpensesSyncAt: typeof o.lastExpensesSyncAt === "string" ? o.lastExpensesSyncAt : null,
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
    lastExpensesSyncAt: at,
  });
}

export function updateCheckpointsAfterIncrementalPull(partial: {
  sales?: boolean;
  products?: boolean;
  customers?: boolean;
  debts?: boolean;
  expenses?: boolean;
  at?: string;
}): SyncCheckpoints {
  const at = partial.at ?? new Date().toISOString();
  const patch: Partial<SyncCheckpoints> = {};
  if (partial.sales) patch.lastSalesSyncAt = at;
  if (partial.products) patch.lastProductsSyncAt = at;
  if (partial.customers) {
    patch.lastCustomersSyncAt = at;
    if (partial.debts !== false) patch.lastDebtsSyncAt = at;
  }
  if (partial.debts) patch.lastDebtsSyncAt = at;
  if (partial.expenses) patch.lastExpensesSyncAt = at;
  return writeSyncCheckpoints(patch);
}

export function needsBootstrapPull(localEmpty: boolean): boolean {
  const cp = readSyncCheckpoints();
  return localEmpty || !cp.bootstrapComplete;
}
