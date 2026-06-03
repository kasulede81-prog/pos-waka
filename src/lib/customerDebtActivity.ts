/**
 * Debtor resolution at checkout, credit activity timeline, and legacy orphan detection.
 */

import type { Customer, DebtPayment, Sale } from "../types";
import { isCompletedSale } from "./saleStatus";

export type CreditActivityKind = "credit_sale" | "debt_payment";

export type CreditActivityEntry = {
  id: string;
  kind: CreditActivityKind;
  at: string;
  amountUgx: number;
  /** Signed ledger delta: + increases balance, − decreases */
  deltaUgx: number;
  receiptSeq?: number;
};

export type OrphanDebtSale = {
  saleId: string;
  createdAt: string;
  debtUgx: number;
  totalUgx: number;
  receiptSeq?: number;
};

export function resolveDebtorForSale(
  customers: Customer[],
  opts: {
    customerId?: string | null;
    customerName?: string | null;
    customerPhone?: string | null;
  },
):
  | { ok: true; customerId: string; customers: Customer[]; createdCustomer?: Customer }
  | { ok: false; errorKey: "debtRequiresCustomerName" } {
  const selectedId = opts.customerId?.trim() || null;
  if (selectedId && customers.some((c) => c.id === selectedId)) {
    return { ok: true, customerId: selectedId, customers };
  }

  const name = opts.customerName?.trim() ?? "";
  if (name) {
    const row: Customer = {
      id: crypto.randomUUID(),
      name,
      phone: opts.customerPhone?.trim() ?? "",
      location: "Uganda",
      createdAt: new Date().toISOString(),
      version: 1,
      debtBalanceUgx: 0,
    };
    return { ok: true, customerId: row.id, customers: [row, ...customers], createdCustomer: row };
  }

  return { ok: false, errorKey: "debtRequiresCustomerName" };
}

export function buildCreditActivityTimeline(
  customerId: string,
  sales: Sale[],
  debtPayments: DebtPayment[],
): CreditActivityEntry[] {
  const entries: CreditActivityEntry[] = [];

  for (const s of sales) {
    if (!isCompletedSale(s) || s.customerId !== customerId || s.debtUgx <= 0) continue;
    entries.push({
      id: s.id,
      kind: "credit_sale",
      at: s.createdAt,
      amountUgx: s.debtUgx,
      deltaUgx: s.debtUgx,
      receiptSeq: s.receiptSeq,
    });
  }

  for (const p of debtPayments) {
    if (p.customerId !== customerId || p.amountUgx <= 0) continue;
    entries.push({
      id: p.id,
      kind: "debt_payment",
      at: p.createdAt,
      amountUgx: p.amountUgx,
      deltaUgx: -p.amountUgx,
    });
  }

  return entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

export function findOrphanDebtSales(sales: Sale[]): OrphanDebtSale[] {
  return sales
    .filter((s) => isCompletedSale(s) && s.debtUgx > 0 && !s.customerId)
    .map((s) => ({
      saleId: s.id,
      createdAt: s.createdAt,
      debtUgx: s.debtUgx,
      totalUgx: s.totalUgx,
      receiptSeq: s.receiptSeq,
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function sumOrphanDebtUgx(sales: Sale[]): number {
  return findOrphanDebtSales(sales).reduce((sum, o) => sum + o.debtUgx, 0);
}
