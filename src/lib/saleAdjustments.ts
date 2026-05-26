import type { Sale, SaleLine, ShiftRecord } from "../types";

export type DiscountMode = "percent" | "amount" | "final";

export function listPriceForLine(line: SaleLine): number {
  return Math.max(0, line.originalLineTotalUgx ?? line.lineTotalUgx);
}

export function lineDiscountUgx(line: SaleLine): number {
  return Math.max(0, line.discountUgx ?? listPriceForLine(line) - line.lineTotalUgx);
}

export function applyDiscountToLine(line: SaleLine, mode: DiscountMode, rawValue: number): SaleLine | null {
  const list = listPriceForLine(line);
  if (list <= 0) return null;

  let nextTotal = list;
  if (mode === "percent") {
    const pct = Math.min(100, Math.max(0, rawValue));
    nextTotal = Math.round(list * (1 - pct / 100));
  } else if (mode === "amount") {
    const off = Math.max(0, Math.floor(rawValue));
    nextTotal = Math.max(0, list - off);
  } else {
    nextTotal = Math.max(0, Math.floor(rawValue));
  }

  if (nextTotal >= list) {
    return {
      ...line,
      originalLineTotalUgx: list,
      discountUgx: 0,
      lineTotalUgx: list,
      estimatedProfitUgx: Math.round(list - line.quantity * line.unitCostUgx),
      moneyAmountUgx: line.inputMode === "money" ? nextTotal : line.moneyAmountUgx,
    };
  }

  const discount = list - nextTotal;
  return {
    ...line,
    originalLineTotalUgx: list,
    discountUgx: discount,
    lineTotalUgx: nextTotal,
    estimatedProfitUgx: Math.round(nextTotal - line.quantity * line.unitCostUgx),
    moneyAmountUgx: line.inputMode === "money" ? nextTotal : line.moneyAmountUgx,
  };
}

export function activeLines(sale: Sale): SaleLine[] {
  return sale.lines.filter((l) => !l.voided);
}

export function saleDiscountTotal(sale: Sale): number {
  return activeLines(sale).reduce((a, l) => a + lineDiscountUgx(l), 0);
}

/** Reduce sale totals when a line is voided or returned. */
export function reduceSaleTotalsByAmount(
  sale: Sale,
  amountUgx: number,
): Pick<Sale, "totalUgx" | "cashPaidUgx" | "debtUgx" | "estimatedProfitUgx" | "voidedTotalUgx"> {
  const amt = Math.max(0, Math.floor(amountUgx));
  const cashReduce = Math.min(amt, sale.cashPaidUgx);
  const debtReduce = amt - cashReduce;
  return {
    totalUgx: Math.max(0, sale.totalUgx - amt),
    cashPaidUgx: Math.max(0, sale.cashPaidUgx - cashReduce),
    debtUgx: Math.max(0, sale.debtUgx - debtReduce),
    estimatedProfitUgx: sale.estimatedProfitUgx,
    voidedTotalUgx: (sale.voidedTotalUgx ?? 0) + amt,
  };
}

export function shiftExpectedCash(sh: ShiftRecord): number {
  const voids = sh.voidsTotalUgx ?? 0;
  const returns = sh.returnsTotalUgx ?? 0;
  return Math.max(0, sh.estimatedCashUgx - voids - returns);
}

export function shiftExpectedCashLabelParts(sh: ShiftRecord): {
  sales: number;
  discounts: number;
  voids: number;
  returns: number;
  expected: number;
} {
  const discounts = sh.discountsTotalUgx ?? 0;
  const voids = sh.voidsTotalUgx ?? 0;
  const returns = sh.returnsTotalUgx ?? 0;
  const expected = shiftExpectedCash(sh);
  return {
    sales: expected + voids + returns,
    discounts,
    voids,
    returns,
    expected,
  };
}
