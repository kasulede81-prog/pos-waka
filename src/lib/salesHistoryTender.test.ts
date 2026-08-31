import { describe, expect, it } from "vitest";
import type { Sale, SaleLine } from "../types";
import { attributeSalePaymentBuckets } from "./cashPosition";
import { physicalCashCollectedFromSale } from "./cashDrawerSales";
import { partitionReceiptsSales, revenueEligibleSales } from "./receiptsGrouping";
import { reduceSaleTotalsByAmount } from "./saleAdjustments";
import { isRevenueSale } from "./saleStatus";
import {
  formatSalesHistoryPaymentMethodsSummary,
  formatSalesHistoryPdfMoneyLine,
  salesHistoryPaymentMethodLabel,
  sumSalesHistoryPaymentBuckets,
  sumSalesHistoryPhysicalCashUgx,
} from "./salesHistoryTender";

const DAY = "2026-08-30";
const AT = `${DAY}T10:00:00.000Z`;

function line(total: number): SaleLine {
  return {
    productId: "prod-1",
    name: "Widget",
    quantity: 1,
    unitPriceUgx: total,
    unitCostUgx: 40_000,
    estimatedProfitUgx: total - 40_000,
    inputMode: "quantity",
    lineTotalUgx: total,
  };
}

function sale(partial: Partial<Sale> & Pick<Sale, "id" | "totalUgx">): Sale {
  const total = partial.totalUgx;
  const debt = partial.debtUgx ?? 0;
  return {
    createdAt: AT,
    updatedAt: AT,
    status: "completed",
    subtotalUgx: total,
    cashPaidUgx: partial.cashPaidUgx ?? Math.max(0, total - debt),
    debtUgx: debt,
    estimatedProfitUgx: total - 40_000,
    lines: [line(total)],
    pendingSync: false,
    ...partial,
  };
}

describe("SALE-HISTORY-P1-TENDER-1.0", () => {
  it("T1 — cash sale labels Cash and contributes physical cash", () => {
    const s = sale({ id: "cash", totalUgx: 10_000, paymentMethod: "cash", cashPaidUgx: 10_000 });
    expect(salesHistoryPaymentMethodLabel("en", s)).toBe("Cash");
    expect(physicalCashCollectedFromSale(s)).toBe(10_000);
    expect(sumSalesHistoryPhysicalCashUgx([s])).toBe(10_000);
    expect(attributeSalePaymentBuckets(s)).toMatchObject({ cash: 10_000, credit: 0, mobile_money: 0, card: 0 });
  });

  it("T2 — MoMo is not Cash; physical cash = 0 even when cashPaidUgx > 0", () => {
    const s = sale({
      id: "momo",
      totalUgx: 25_000,
      cashPaidUgx: 25_000,
      paymentMethod: "mobile_money",
    });
    expect(salesHistoryPaymentMethodLabel("en", s)).toBe("Mobile money");
    expect(salesHistoryPaymentMethodLabel("en", s)).not.toBe("Cash");
    expect(physicalCashCollectedFromSale(s)).toBe(0);
    expect(sumSalesHistoryPhysicalCashUgx([s])).toBe(0);
    const summary = formatSalesHistoryPaymentMethodsSummary("en", [s]);
    expect(summary).toContain("Mobile money");
    expect(summary).not.toMatch(/^Cash/);
    expect(summary).not.toContain("Cash:");
    expect(formatSalesHistoryPdfMoneyLine(s)).toContain("Mobile money");
    expect(formatSalesHistoryPdfMoneyLine(s)).not.toContain("Cash UGX");
  });

  it("T3 — ATM/Card is not Cash; physical cash = 0", () => {
    const s = sale({
      id: "atm",
      totalUgx: 30_000,
      cashPaidUgx: 30_000,
      paymentMethod: "atm",
    });
    expect(salesHistoryPaymentMethodLabel("en", s)).toBe("ATM");
    expect(salesHistoryPaymentMethodLabel("en", s)).not.toBe("Cash");
    expect(physicalCashCollectedFromSale(s)).toBe(0);
    expect(sumSalesHistoryPhysicalCashUgx([s])).toBe(0);
    expect(attributeSalePaymentBuckets(s).card).toBe(30_000);
    const summary = formatSalesHistoryPaymentMethodsSummary("en", [s]);
    expect(summary).toContain("Card");
    expect(summary).not.toContain("Cash:");
    expect(formatSalesHistoryPdfMoneyLine(s)).toContain("Card");
    expect(formatSalesHistoryPdfMoneyLine(s)).not.toContain("Cash UGX");
  });

  it("T4 — credit sale: debt created, physical cash = 0", () => {
    const s = sale({
      id: "credit",
      totalUgx: 100_000,
      cashPaidUgx: 0,
      debtUgx: 100_000,
      paymentMethod: "credit",
    });
    expect(salesHistoryPaymentMethodLabel("en", s)).toBe("Pay later");
    expect(physicalCashCollectedFromSale(s)).toBe(0);
    expect(attributeSalePaymentBuckets(s)).toMatchObject({ cash: 0, credit: 100_000 });
    expect(formatSalesHistoryPaymentMethodsSummary("en", [s])).toContain("Pay later");
  });

  it("T5 — mixed sale follows attributeSalePaymentBuckets", () => {
    const s = sale({
      id: "mixed",
      totalUgx: 100_000,
      cashPaidUgx: 60_000,
      debtUgx: 40_000,
      paymentMethod: "mixed",
    });
    expect(salesHistoryPaymentMethodLabel("en", s)).toBe("Mixed");
    expect(attributeSalePaymentBuckets(s)).toEqual({
      cash: 60_000,
      mobile_money: 0,
      card: 0,
      bank_transfer: 0,
      credit: 40_000,
    });
    expect(physicalCashCollectedFromSale(s)).toBe(60_000);
    expect(sumSalesHistoryPaymentBuckets([s])).toMatchObject({ cash: 60_000, credit: 40_000 });
  });

  it("T6 — payment summary buckets across tenders", () => {
    const sales = [
      sale({ id: "a", totalUgx: 10_000, paymentMethod: "cash", cashPaidUgx: 10_000 }),
      sale({ id: "b", totalUgx: 20_000, paymentMethod: "mobile_money", cashPaidUgx: 20_000 }),
      sale({ id: "c", totalUgx: 30_000, paymentMethod: "atm", cashPaidUgx: 30_000 }),
      sale({ id: "d", totalUgx: 40_000, paymentMethod: "credit", cashPaidUgx: 0, debtUgx: 40_000 }),
    ];
    const totals = sumSalesHistoryPaymentBuckets(sales);
    expect(totals).toEqual({
      cash: 10_000,
      mobile_money: 20_000,
      card: 30_000,
      bank_transfer: 0,
      credit: 40_000,
    });
    const summary = formatSalesHistoryPaymentMethodsSummary("en", sales);
    expect(summary).toContain("Cash: UGX 10,000");
    expect(summary).toContain("Mobile money: UGX 20,000");
    expect(summary).toContain("Card: UGX 30,000");
    expect(summary).toContain("Pay later: UGX 40,000");
  });

  it("T7 — Sales History physical cash metric ignores MoMo/ATM cashPaidUgx", () => {
    const sales = [
      sale({ id: "cash", totalUgx: 10_000, paymentMethod: "cash", cashPaidUgx: 10_000 }),
      sale({ id: "momo", totalUgx: 25_000, paymentMethod: "mobile_money", cashPaidUgx: 25_000 }),
      sale({ id: "atm", totalUgx: 30_000, paymentMethod: "atm", cashPaidUgx: 30_000 }),
    ];
    const cashPaidSum = sales.reduce((sum, s) => sum + s.cashPaidUgx, 0);
    expect(cashPaidSum).toBe(65_000);
    expect(sumSalesHistoryPhysicalCashUgx(sales)).toBe(10_000);
  });

  it("T8 — whole-bill void remains excluded from revenue-eligible physical cash", () => {
    const voided = sale({
      id: "void",
      totalUgx: 0,
      cashPaidUgx: 0,
      paymentMethod: "cash",
      saleVoidedAt: `${DAY}T11:00:00.000Z`,
    });
    const completed = partitionReceiptsSales([voided]).completed;
    expect(completed).toHaveLength(1);
    expect(isRevenueSale(voided)).toBe(false);
    const eligible = revenueEligibleSales(completed);
    expect(eligible).toHaveLength(0);
    expect(sumSalesHistoryPhysicalCashUgx(eligible)).toBe(0);
  });

  it("T9 — linked return uses adjusted sale totals; no extra tender subtraction", () => {
    const original = sale({ id: "ret", totalUgx: 100_000, paymentMethod: "cash", cashPaidUgx: 100_000 });
    const adjusted = { ...original, ...reduceSaleTotalsByAmount(original, 40_000) };
    expect(adjusted.totalUgx).toBe(60_000);
    expect(sumSalesHistoryPhysicalCashUgx([adjusted])).toBe(60_000);
    expect(attributeSalePaymentBuckets(adjusted).cash).toBe(60_000);
  });

  it("T10 — list label and PDF money line agree on tender (not cashPaid-as-Cash)", () => {
    const momo = sale({
      id: "momo-detail",
      totalUgx: 15_000,
      cashPaidUgx: 15_000,
      paymentMethod: "mobile_money",
    });
    expect(salesHistoryPaymentMethodLabel("en", momo)).toBe("Mobile money");
    expect(formatSalesHistoryPdfMoneyLine(momo)).toBe("Total UGX 15,000 · Mobile money UGX 15,000");

    const atm = sale({
      id: "atm-detail",
      totalUgx: 12_000,
      cashPaidUgx: 12_000,
      paymentMethod: "atm",
    });
    expect(salesHistoryPaymentMethodLabel("en", atm)).toBe("ATM");
    expect(formatSalesHistoryPdfMoneyLine(atm)).toBe("Total UGX 12,000 · Card UGX 12,000");
  });
});
