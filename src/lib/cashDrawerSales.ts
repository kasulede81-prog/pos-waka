/**
 * Physical-cash attribution for drawer reconciliation (payment-method aware).
 * Revenue metrics still use sale.cashPaidUgx / financialMetrics — unchanged.
 */

import type { Sale } from "../types";
import { dateKeyKampala } from "./datesUg";
import { isCompletedSale } from "./saleStatus";

export type CashDrawerSalesInput = {
  cashSalesUgx: number;
  mobileMoneySalesUgx: number;
  cardSalesUgx: number;
  bankTransferSalesUgx: number;
};

function physicalCashCollectedFromSale(sale: Sale): number {
  const total = Math.max(0, sale.totalUgx);
  const debt = Math.max(0, sale.debtUgx);
  const collected = Math.max(0, total - debt);
  if (collected <= 0) return 0;

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

/** Sum physical-cash vs electronic buckets for completed sales on a Kampala day. */
export function getCashDrawerSalesInput(sales: Sale[], day: string): CashDrawerSalesInput {
  let cashSalesUgx = 0;
  let mobileMoneySalesUgx = 0;
  let cardSalesUgx = 0;
  let bankTransferSalesUgx = 0;

  for (const s of sales) {
    if (!isCompletedSale(s) || dateKeyKampala(s.createdAt) !== day) continue;
    cashSalesUgx += physicalCashCollectedFromSale(s);
    mobileMoneySalesUgx += mobileMoneyCollectedFromSale(s);
    cardSalesUgx += cardCollectedFromSale(s);
    // bank_transfer not yet a distinct paymentMethod on Sale — reserved for future
  }

  return { cashSalesUgx, mobileMoneySalesUgx, cardSalesUgx, bankTransferSalesUgx };
}

/** Cash portion of a refund that left the drawer (for shift tracking). */
export function cashReduceFromRefund(sale: Sale | undefined, refundUgx: number): number {
  const refund = Math.max(0, Math.floor(refundUgx));
  if (!sale) return refund;
  return Math.min(refund, Math.max(0, sale.cashPaidUgx));
}
