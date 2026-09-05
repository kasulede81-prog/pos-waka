/**
 * Physical-cash attribution for drawer reconciliation (payment-method aware).
 * Revenue metrics still use sale.cashPaidUgx / financialMetrics — unchanged.
 */

import type { ReturnRecord, Sale } from "../types";
import { dateKeyKampala } from "./datesUg";
import { hasAuthoritativeTenderCash } from "./saleTenderCash";
import { isRevenueSale } from "./saleStatus";

export type CashDrawerSalesInput = {
  cashSalesUgx: number;
  mobileMoneySalesUgx: number;
  cardSalesUgx: number;
  bankTransferSalesUgx: number;
};

/** Physical drawer contribution from a sale (MoMo/ATM → 0). Shared by day + shift expected cash. */
export function physicalCashCollectedFromSale(sale: Sale): number {
  const total = Math.max(0, sale.totalUgx);
  const debt = Math.max(0, sale.debtUgx);
  const collected = Math.max(0, total - debt);
  if (collected <= 0) return 0;

  // NEW sales persist tenderCashUgx (physical cash tender). Never fall back when present.
  if (hasAuthoritativeTenderCash(sale)) {
    return Math.min(Math.max(0, Math.floor(sale.tenderCashUgx!)), collected);
  }

  // LEGACY LIMITATION: historical rows have no physical cash tender.
  // total − debt cannot reconstruct cash vs MoMo and is not authoritative.
  const pm = sale.paymentMethod ?? (debt > 0 ? "mixed" : "cash");
  switch (pm) {
    case "mobile_money":
      return 0;
    case "atm":
      return 0;
    case "cash":
    case "mixed":
    case "credit":
      return collected;
    default:
      return collected;
  }
}

function mobileMoneyCollectedFromSale(sale: Sale): number {
  const total = Math.max(0, sale.totalUgx);
  const debt = Math.max(0, sale.debtUgx);
  const collected = Math.max(0, total - debt);
  if (collected <= 0) return 0;
  return sale.paymentMethod === "mobile_money" ? collected : 0;
}

function cardCollectedFromSale(sale: Sale): number {
  const total = Math.max(0, sale.totalUgx);
  const debt = Math.max(0, sale.debtUgx);
  const collected = Math.max(0, total - debt);
  if (collected <= 0) return 0;
  return sale.paymentMethod === "atm" ? collected : 0;
}

/** Sum physical-cash vs electronic buckets for revenue sales on a Kampala day. */
export function getCashDrawerSalesInput(sales: Sale[], day: string): CashDrawerSalesInput {
  let cashSalesUgx = 0;
  let mobileMoneySalesUgx = 0;
  let cardSalesUgx = 0;
  let bankTransferSalesUgx = 0;

  for (const s of sales) {
    if (!isRevenueSale(s) || dateKeyKampala(s.createdAt) !== day) continue;
    cashSalesUgx += physicalCashCollectedFromSale(s);
    mobileMoneySalesUgx += mobileMoneyCollectedFromSale(s);
    cardSalesUgx += cardCollectedFromSale(s);
    // bank_transfer not yet a distinct paymentMethod on Sale — reserved for future
  }

  return { cashSalesUgx, mobileMoneySalesUgx, cardSalesUgx, bankTransferSalesUgx };
}

/** Physical-cash portion of a refund/void that left the drawer (for shift tracking). */
export function cashReduceFromRefund(sale: Sale | undefined, refundUgx: number): number {
  const refund = Math.max(0, Math.floor(refundUgx));
  if (!sale) return 0;
  return Math.min(refund, physicalCashCollectedFromSale(sale));
}

export function hasAuthoritativeRefundCash(rec: Pick<ReturnRecord, "refundCashUgx">): boolean {
  return rec.refundCashUgx != null && Number.isFinite(rec.refundCashUgx);
}

/**
 * Physical cash leaving the drawer for a persisted return.
 * Unknown/legacy (no refundCashUgx) is 0 — do not treat refundAmountUgx as cash.
 */
export function physicalCashRefundedFromReturn(rec: ReturnRecord): number {
  const refund = Math.max(0, Math.floor(rec.refundAmountUgx));
  if (refund <= 0 || !hasAuthoritativeRefundCash(rec)) return 0;
  return Math.min(refund, Math.max(0, Math.floor(rec.refundCashUgx!)));
}

/** External (unlinked / sale not in scoped set) physical-cash refunds only. */
export function externalPhysicalCashRefundsUgx(scopedSales: Sale[], returnScoped: ReturnRecord[]): number {
  const saleIds = new Set(scopedSales.map((s) => s.id));
  let total = 0;
  for (const rec of returnScoped) {
    const sid = rec.saleId;
    if (sid && saleIds.has(sid)) continue;
    total += physicalCashRefundedFromReturn(rec);
  }
  return total;
}

export function parsePersistedRefundCashUgx(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, n);
}
