/**
 * Sales History tender / physical-cash presentation.
 * Reuses certified attributeSalePaymentBuckets + physicalCashCollectedFromSale —
 * does not redefine payment recording or drawer math.
 */

import type { Language, Sale } from "../types";
import { attributeSalePaymentBuckets, type CashPositionPaymentKey } from "./cashPosition";
import { physicalCashCollectedFromSale } from "./cashDrawerSales";
import { t } from "./i18n";

const BUCKET_ORDER: CashPositionPaymentKey[] = [
  "cash",
  "mobile_money",
  "card",
  "bank_transfer",
  "credit",
];

function bucketLabel(lang: Language, key: CashPositionPaymentKey): string {
  switch (key) {
    case "cash":
      return t(lang, "paymentMethod_cash");
    case "mobile_money":
      return t(lang, "paymentMethod_mobile_money");
    case "card":
      // Stored paymentMethod "atm" attributes into the card bucket (Reports / Cash Position).
      return t(lang, "paymentMethod_card");
    case "bank_transfer":
      return t(lang, "cashPositionPayBank");
    case "credit":
      return t(lang, "paymentMethod_credit");
    default:
      return key;
  }
}

/** Per-sale payment method label for list/detail — respects stored paymentMethod. */
export function salesHistoryPaymentMethodLabel(lang: Language, sale: Sale): string {
  const pm = sale.paymentMethod;
  if (pm === "mobile_money") return t(lang, "paymentMethod_mobile_money");
  if (pm === "atm") return t(lang, "paymentMethod_atm");
  if (pm === "mixed") return t(lang, "paymentMethod_mixed");
  if (pm === "credit") return t(lang, "paymentMethod_credit");
  if (pm === "voucher") return t(lang, "paymentMethod_voucher");
  if (pm === "cash") return t(lang, "paymentMethod_cash");

  const debt = Math.max(0, sale.debtUgx);
  const collected = Math.max(0, sale.totalUgx - debt);
  if (debt > 0 && collected > 0) return t(lang, "paymentMethod_mixed");
  if (debt > 0) return t(lang, "paymentMethod_credit");
  return t(lang, "paymentMethod_cash");
}

export function sumSalesHistoryPaymentBuckets(
  sales: Sale[],
): Record<CashPositionPaymentKey, number> {
  const totals: Record<CashPositionPaymentKey, number> = {
    cash: 0,
    mobile_money: 0,
    card: 0,
    bank_transfer: 0,
    credit: 0,
  };
  for (const sale of sales) {
    const buckets = attributeSalePaymentBuckets(sale);
    for (const key of BUCKET_ORDER) {
      totals[key] += buckets[key];
    }
  }
  return totals;
}

/** Payment mix string for Sales History analytics (canonical buckets). */
export function formatSalesHistoryPaymentMethodsSummary(lang: Language, sales: Sale[]): string {
  const totals = sumSalesHistoryPaymentBuckets(sales);
  const parts: string[] = [];
  for (const key of BUCKET_ORDER) {
    const amount = totals[key];
    if (amount <= 0) continue;
    parts.push(`${bucketLabel(lang, key)}: UGX ${amount.toLocaleString()}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "—";
}

/** Physical drawer cash from revenue-eligible sales (MoMo/ATM → 0). */
export function sumSalesHistoryPhysicalCashUgx(sales: Sale[]): number {
  let sum = 0;
  for (const sale of sales) {
    sum += physicalCashCollectedFromSale(sale);
  }
  return sum;
}

/** English money line for Sales History list PDF — never labels MoMo/ATM as Cash. */
export function formatSalesHistoryPdfMoneyLine(sale: Sale): string {
  const buckets = attributeSalePaymentBuckets(sale);
  const parts = [`Total UGX ${sale.totalUgx.toLocaleString("en-UG")}`];
  const labels: Record<CashPositionPaymentKey, string> = {
    cash: "Cash",
    mobile_money: "Mobile money",
    card: "Card",
    bank_transfer: "Bank transfer",
    credit: "Credit",
  };
  for (const key of BUCKET_ORDER) {
    const amount = buckets[key];
    if (amount <= 0) continue;
    parts.push(`${labels[key]} UGX ${amount.toLocaleString("en-UG")}`);
  }
  return parts.join(" · ");
}
