import type {
  BillPaymentRecord,
  BillSplitLine,
  RestaurantBillDraft,
  RestaurantPaymentMethod,
  RestaurantTipMode,
  Sale,
  SaleLine,
  ShopPreferences,
} from "../types";
import { computeDraftCheckoutTotals } from "./draftCart";

export type RestaurantBillTotals = {
  listSubtotalUgx: number;
  lineDiscountUgx: number;
  cartDiscountUgx: number;
  subtotalAfterDiscountUgx: number;
  serviceChargePercent: number;
  serviceChargeUgx: number;
  taxPercent: number;
  taxUgx: number;
  tipUgx: number;
  grandTotalUgx: number;
  paidTotalUgx: number;
  remainingBalanceUgx: number;
  changeDueUgx: number;
};

export function ensureBillSplitId(split: BillSplitLine, index: number): BillSplitLine {
  return {
    ...split,
    id: split.id?.trim() || `split-${index}-${split.label}`,
    paidUgx: split.paidUgx ?? 0,
    status: split.status ?? "open",
  };
}

export function normalizeBillSplits(splits: BillSplitLine[]): BillSplitLine[] {
  return splits.map((s, i) => ensureBillSplitId(s, i));
}

export function emptyBillDraft(prefs?: ShopPreferences): RestaurantBillDraft {
  return {
    splitMode: "none",
    splits: [],
    payments: [],
    serviceChargePercent: prefs?.hospitalityServiceChargePercent ?? 0,
    tipMode: "none",
    tipUgx: 0,
    taxPercent: prefs?.hospitalityTaxPercent ?? 0,
  };
}

export function billDraftFromSale(sale: Sale | undefined, prefs?: ShopPreferences): RestaurantBillDraft {
  if (sale?.billDraft) {
    return {
      ...emptyBillDraft(prefs),
      ...sale.billDraft,
      splits: normalizeBillSplits(sale.billDraft.splits ?? []),
      payments: sale.billDraft.payments ?? [],
    };
  }
  return emptyBillDraft(prefs);
}

export function computeTipUgx(
  mode: RestaurantTipMode | undefined,
  tipUgx: number | undefined,
  tipPercent: number | null | undefined,
  baseUgx: number,
): number {
  if (mode === "fixed" || mode === "custom") return Math.max(0, Math.floor(tipUgx ?? 0));
  if (mode === "percent") {
    const pct = Math.max(0, tipPercent ?? 0);
    return Math.round(baseUgx * (pct / 100));
  }
  return 0;
}

export function computeRestaurantBillTotals(input: {
  lines: SaleLine[];
  cartDiscountUgx: number;
  billDraft?: RestaurantBillDraft | null;
  prefs?: ShopPreferences;
}): RestaurantBillTotals {
  const checkout = computeDraftCheckoutTotals(input.lines, input.cartDiscountUgx);
  const listSubtotal = input.lines.reduce((a, l) => a + (l.originalLineTotalUgx ?? l.lineTotalUgx), 0);
  const lineDiscountUgx = Math.max(0, listSubtotal - checkout.lineSubtotalUgx);
  const subtotalAfterDiscount = checkout.payableUgx;

  const draft = input.billDraft;
  const serviceChargePercent = Math.max(
    0,
    draft?.serviceChargePercent ?? input.prefs?.hospitalityServiceChargePercent ?? 0,
  );
  const serviceChargeUgx = Math.round(subtotalAfterDiscount * (serviceChargePercent / 100));

  const taxPercent = Math.max(
    0,
    input.prefs?.hospitalityTaxEnabled === false
      ? 0
      : (draft?.taxPercent ?? input.prefs?.hospitalityTaxPercent ?? 0),
  );
  const taxMode = input.prefs?.hospitalityTaxMode ?? "exclusive";
  const preTaxBase = subtotalAfterDiscount + serviceChargeUgx;
  let taxUgx = 0;
  if (taxPercent > 0) {
    if (taxMode === "inclusive") {
      const divisor = 1 + taxPercent / 100;
      const netSubtotal = Math.round(subtotalAfterDiscount / divisor);
      taxUgx = subtotalAfterDiscount - netSubtotal;
    } else {
      taxUgx = Math.round(preTaxBase * (taxPercent / 100));
    }
  }

  const tipBase = taxMode === "inclusive"
    ? subtotalAfterDiscount + serviceChargeUgx
    : preTaxBase + taxUgx;
  const tipUgx = computeTipUgx(draft?.tipMode, draft?.tipUgx, draft?.tipPercent, tipBase);

  const grandTotalUgx =
    taxMode === "inclusive"
      ? subtotalAfterDiscount + serviceChargeUgx + tipUgx
      : subtotalAfterDiscount + serviceChargeUgx + taxUgx + tipUgx;
  const paidTotalUgx = (draft?.payments ?? []).reduce((a, p) => a + Math.max(0, p.amountUgx), 0);
  const remainingBalanceUgx = Math.max(0, grandTotalUgx - paidTotalUgx);
  const changeDueUgx = Math.max(0, paidTotalUgx - grandTotalUgx);

  return {
    listSubtotalUgx: listSubtotal,
    lineDiscountUgx,
    cartDiscountUgx: checkout.cartDiscountUgx,
    subtotalAfterDiscountUgx: subtotalAfterDiscount,
    serviceChargePercent,
    serviceChargeUgx,
    taxPercent,
    taxUgx,
    tipUgx,
    grandTotalUgx,
    paidTotalUgx,
    remainingBalanceUgx,
    changeDueUgx,
  };
}

export function splitBillEqual(totalUgx: number, guestCount: number): BillSplitLine[] {
  const n = Math.max(1, Math.floor(guestCount));
  const base = Math.floor(totalUgx / n);
  const remainder = totalUgx - base * n;
  return Array.from({ length: n }, (_, i) => ({
    id: `equal-${i + 1}`,
    label: String.fromCharCode(65 + i),
    amountUgx: base + (i < remainder ? 1 : 0),
    paidUgx: 0,
    status: "open" as const,
  }));
}

export function lineTotalForSplit(line: SaleLine): number {
  return Math.max(0, line.lineTotalUgx);
}

export function splitBillBySeat(lines: SaleLine[], guestCount: number): BillSplitLine[] {
  const seatTotals = new Map<number, number>();
  const unassigned: SaleLine[] = [];

  for (const line of lines) {
    const seat = line.seatNumber;
    if (seat != null && seat >= 1) {
      seatTotals.set(seat, (seatTotals.get(seat) ?? 0) + lineTotalForSplit(line));
    } else {
      unassigned.push(line);
    }
  }

  const seats = Math.max(1, guestCount, seatTotals.size > 0 ? Math.max(...seatTotals.keys()) : 1);
  const splits: BillSplitLine[] = [];

  for (let seat = 1; seat <= seats; seat++) {
    const amount = seatTotals.get(seat) ?? 0;
    const lineIds = lines.filter((l) => l.seatNumber === seat).map((l) => l.id ?? l.productId);
    splits.push({
      id: `seat-${seat}`,
      label: `Seat ${seat}`,
      seatNumber: seat,
      lineIds,
      amountUgx: amount,
      paidUgx: 0,
      status: amount > 0 ? "open" : "open",
    });
  }

  if (unassigned.length > 0) {
    const unassignedTotal = unassigned.reduce((a, l) => a + lineTotalForSplit(l), 0);
    if (unassignedTotal > 0) {
      splits.push({
        id: "seat-unassigned",
        label: "Unassigned",
        lineIds: unassigned.map((l) => l.id ?? l.productId),
        amountUgx: unassignedTotal,
        paidUgx: 0,
        status: "open",
      });
    }
  }

  return normalizeBillSplits(splits.filter((s) => s.amountUgx > 0));
}

export function splitBillByItem(
  lines: SaleLine[],
  assignments: Record<string, string>,
  labels: Record<string, string>,
): BillSplitLine[] {
  const buckets = new Map<string, { label: string; lineIds: string[]; amountUgx: number }>();

  for (const line of lines) {
    const lineId = line.id ?? line.productId;
    const bucketId = assignments[lineId] ?? "A";
    const label = labels[bucketId] ?? bucketId;
    const existing = buckets.get(bucketId) ?? { label, lineIds: [], amountUgx: 0 };
    existing.lineIds.push(lineId);
    existing.amountUgx += lineTotalForSplit(line);
    buckets.set(bucketId, existing);
  }

  return normalizeBillSplits(
    [...buckets.entries()].map(([id, b]) => ({
      id: `item-${id}`,
      label: b.label,
      lineIds: b.lineIds,
      amountUgx: b.amountUgx,
      paidUgx: 0,
      status: "open" as const,
    })),
  );
}

export function validateCustomSplits(splits: BillSplitLine[], totalUgx: number): boolean {
  const sum = splits.reduce((a, s) => a + Math.max(0, s.amountUgx), 0);
  return sum === totalUgx && totalUgx > 0;
}

export function allocatePaymentToSplits(
  splits: BillSplitLine[],
  amountUgx: number,
  splitId?: string | null,
): { splits: BillSplitLine[]; appliedUgx: number } {
  let remaining = Math.max(0, Math.floor(amountUgx));
  const next = splits.map((s) => ({ ...ensureBillSplitId(s, 0) }));

  const targets = splitId
    ? next.filter((s) => s.id === splitId)
    : next.filter((s) => (s.paidUgx ?? 0) < s.amountUgx);

  for (const split of targets) {
    if (remaining <= 0) break;
    const owed = Math.max(0, split.amountUgx - (split.paidUgx ?? 0));
    const applied = Math.min(owed, remaining);
    split.paidUgx = (split.paidUgx ?? 0) + applied;
    split.status = split.paidUgx >= split.amountUgx ? "paid" : split.paidUgx > 0 ? "partial" : "open";
    remaining -= applied;
  }

  return { splits: next, appliedUgx: Math.max(0, Math.floor(amountUgx)) - remaining };
}

export function deriveAggregatePaymentMethod(
  payments: BillPaymentRecord[],
): "cash" | "atm" | "mobile_money" | "mixed" | "credit" | "voucher" {
  if (payments.length === 0) return "cash";
  const methods = new Set(payments.map((p) => p.method));
  if (methods.size > 1) return "mixed";
  const only = payments[0]!.method;
  if (only === "card") return "atm";
  if (only === "voucher") return "voucher";
  if (only === "credit") return "credit";
  if (only === "mobile_money") return "mobile_money";
  if (only === "atm") return "atm";
  return "cash";
}

export function cashPaidFromBillPayments(payments: BillPaymentRecord[]): number {
  return payments
    .filter((p) => p.method === "cash" || p.method === "atm" || p.method === "card" || p.method === "mobile_money")
    .reduce((a, p) => a + p.amountUgx, 0);
}

export function creditDebtFromBillPayments(payments: BillPaymentRecord[], grandTotalUgx: number): number {
  const creditPaid = payments.filter((p) => p.method === "credit").reduce((a, p) => a + p.amountUgx, 0);
  const nonCreditPaid = payments.filter((p) => p.method !== "credit").reduce((a, p) => a + p.amountUgx, 0);
  const unpaid = Math.max(0, grandTotalUgx - nonCreditPaid);
  return Math.min(unpaid, creditPaid > 0 ? unpaid : 0);
}

export function preferredPaymentMethodFromSales(sales: Sale[]): RestaurantPaymentMethod | null {
  const counts = new Map<RestaurantPaymentMethod, number>();
  for (const sale of sales) {
    if (sale.billPayments?.length) {
      for (const p of sale.billPayments) {
        counts.set(p.method, (counts.get(p.method) ?? 0) + 1);
      }
    } else if (sale.paymentMethod) {
      const m = sale.paymentMethod === "mixed" ? "cash" : (sale.paymentMethod as RestaurantPaymentMethod);
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
  }
  let best: RestaurantPaymentMethod | null = null;
  let max = 0;
  for (const [method, count] of counts) {
    if (count > max) {
      max = count;
      best = method;
    }
  }
  return best;
}

export function mergeBillDraft(
  existing: RestaurantBillDraft | null | undefined,
  patch: Partial<RestaurantBillDraft>,
  prefs?: ShopPreferences,
): RestaurantBillDraft {
  const base = existing ? { ...emptyBillDraft(prefs), ...existing } : emptyBillDraft(prefs);
  return {
    ...base,
    ...patch,
    splits: patch.splits ? normalizeBillSplits(patch.splits) : base.splits,
    payments: patch.payments ?? base.payments,
  };
}

export function canFinalizeBill(totals: RestaurantBillTotals): boolean {
  return totals.grandTotalUgx > 0 && totals.remainingBalanceUgx <= 0;
}

export function isDuplicatePayment(
  payments: BillPaymentRecord[],
  candidate: { amountUgx: number; method: RestaurantPaymentMethod; reference?: string | null },
  withinMs = 5000,
): boolean {
  const now = Date.now();
  return payments.some((p) => {
    const age = now - new Date(p.recordedAt).getTime();
    return (
      age < withinMs &&
      p.amountUgx === candidate.amountUgx &&
      p.method === candidate.method &&
      (p.reference ?? "") === (candidate.reference ?? "")
    );
  });
}
