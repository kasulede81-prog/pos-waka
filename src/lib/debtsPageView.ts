import type { Customer, DebtPayment } from "../types";
import type { CreditActivityEntry, CreditActivityIndex } from "./customerDebtActivity";
import { creditActivityTimelineFromIndex } from "./customerDebtActivity";
import type { DateFilterBounds } from "./dateFilters";
import { dateMatchesFilter } from "./dateFilters";
import { dateKeyKampala } from "./datesUg";

export type DebtsQuickFilter = "all" | "outstanding" | "overdue" | "paid_today" | "this_week";

export type CustomerDebtMeta = {
  lastPayment: CreditActivityEntry | null;
  lastSale: CreditActivityEntry | null;
  isOverdue: boolean;
  isDueSoon: boolean;
};

const OVERDUE_DAYS = 14;
const DUE_SOON_DAYS = 7;

import { formatUgx } from "./formatUgx";

export function formatShortUgx(n: number): string {
  return formatUgx(n);
}

export function customerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

export function deriveCustomerDebtMeta(customer: Customer, index: CreditActivityIndex): CustomerDebtMeta {
  const timeline = creditActivityTimelineFromIndex(customer.id, index);
  const lastPayment = timeline.find((e) => e.kind === "debt_payment") ?? null;
  const lastSale = timeline.find((e) => e.kind === "credit_sale") ?? null;

  let isOverdue = false;
  let isDueSoon = false;

  if (customer.debtBalanceUgx > 0 && lastSale) {
    const saleAgeDays = Math.floor((Date.now() - new Date(lastSale.at).getTime()) / 86_400_000);
    const paymentAfterSale =
      lastPayment && new Date(lastPayment.at).getTime() >= new Date(lastSale.at).getTime();
    if (!paymentAfterSale && saleAgeDays >= OVERDUE_DAYS) isOverdue = true;
    else if (!paymentAfterSale && saleAgeDays >= DUE_SOON_DAYS) isDueSoon = true;
  }

  return { lastPayment, lastSale, isOverdue, isDueSoon };
}

export function countCustomersOwing(customers: Customer[]): number {
  return customers.filter((c) => c.debtBalanceUgx > 0).length;
}

export function countOverdueAccounts(customers: Customer[], index: CreditActivityIndex): number {
  return customers.filter((c) => deriveCustomerDebtMeta(c, index).isOverdue).length;
}

export function computeAverageCollectionDays(
  debtPayments: DebtPayment[],
  index: CreditActivityIndex,
): number | null {
  const gaps: number[] = [];
  for (const payment of debtPayments) {
    if (payment.amountUgx <= 0) continue;
    const sales = (index.salesByCustomer.get(payment.customerId) ?? [])
      .filter((s) => new Date(s.at).getTime() <= new Date(payment.createdAt).getTime())
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const priorSale = sales[0];
    if (!priorSale) continue;
    const days = Math.max(
      0,
      Math.floor(
        (new Date(payment.createdAt).getTime() - new Date(priorSale.at).getTime()) / 86_400_000,
      ),
    );
    gaps.push(days);
  }
  if (gaps.length === 0) return null;
  return Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
}

export function customerMatchesSearch(customer: Customer, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (customer.name.toLowerCase().includes(q)) return true;
  if (customer.phone?.toLowerCase().includes(q)) return true;
  return false;
}

export function customerMatchesQuickFilter(
  customer: Customer,
  filter: DebtsQuickFilter,
  index: CreditActivityIndex,
  bounds: DateFilterBounds,
  todayKey: string,
): boolean {
  if (filter === "all") return true;
  if (filter === "outstanding") return customer.debtBalanceUgx > 0;
  if (filter === "overdue") return deriveCustomerDebtMeta(customer, index).isOverdue;
  if (filter === "paid_today") {
    const payments = index.paymentsByCustomer.get(customer.id) ?? [];
    return payments.some((p) => dateKeyKampala(p.at) === todayKey);
  }
  if (filter === "this_week") {
    const timeline = creditActivityTimelineFromIndex(customer.id, index);
    return timeline.some((e) => dateMatchesFilter(dateKeyKampala(e.at), bounds));
  }
  return true;
}

export function formatActivityWhen(iso: string, lang: "en" | "sw"): string {
  const locale = lang === "sw" ? "sw-UG" : "en-UG";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Africa/Kampala",
  }).format(new Date(iso));
}
