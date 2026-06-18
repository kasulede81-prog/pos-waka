/**
 * Debt payment cloud pull merge — idempotent by payment id; preserves local receipt snapshots.
 */

import type { DebtPayment } from "../types";

export function rowToDebtPayment(row: Record<string, unknown>): DebtPayment | null {
  const id = String(row.id ?? "");
  const customerId = String(row.customer_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(customerId)) return null;
  const amountUgx = Math.max(0, Math.floor(Number(row.amount_ugx ?? 0)));
  if (amountUgx <= 0) return null;
  return {
    id,
    customerId,
    amountUgx,
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

/** Merge remote payments into local; never duplicate by payment id; keep local row when present. */
export function mergeDebtPaymentsFromCloudPull(local: DebtPayment[], remote: DebtPayment[]): DebtPayment[] {
  const map = new Map<string, DebtPayment>();
  for (const p of local) map.set(p.id, p);
  for (const p of remote) {
    if (!map.has(p.id)) map.set(p.id, p);
  }
  return [...map.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function parseDebtPaymentRows(rows: Record<string, unknown>[]): DebtPayment[] {
  return rows.map(rowToDebtPayment).filter((p): p is DebtPayment => p != null);
}
