import { describe, expect, it, vi, afterEach } from "vitest";
import type { Product, ReturnRecord, Sale, SaleLine } from "../types";
import {
  allocateSaleLineRevenueUgx,
  attributeSalePaymentBuckets,
  buildCashPositionReport,
  cashPositionVariance,
  sumCategoryAmounts,
  sumPaymentMethodAmounts,
} from "./cashPosition";
import { cashPositionToCsv, cashPositionToPlainText } from "./cashPositionExport";
import { reduceSaleTotalsByAmount } from "./saleAdjustments";

const PRODUCT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DAY = "2026-06-12";

const productA: Product = {
  id: PRODUCT_A,
  name: "Soda",
  sellingPricePerUnitUgx: 5_000,
  costPricePerUnitUgx: 2_000,
  stockOnHand: 10,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "Beverages",
  sku: "",
  minimumStockAlert: 2,
  updatedAt: "2026-06-01T08:00:00.000Z",
  version: 1,
};

const productB: Product = {
  id: PRODUCT_B,
  name: "Bread",
  sellingPricePerUnitUgx: 3_000,
  costPricePerUnitUgx: 1_500,
  stockOnHand: 10,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "Food",
  sku: "",
  minimumStockAlert: 2,
  updatedAt: "2026-06-01T08:00:00.000Z",
  version: 1,
};

function line(partial: Partial<SaleLine> & Pick<SaleLine, "productId" | "lineTotalUgx">): SaleLine {
  return {
    name: "Item",
    quantity: 1,
    unitPriceUgx: partial.lineTotalUgx,
    unitCostUgx: 1_000,
    estimatedProfitUgx: partial.lineTotalUgx - 1_000,
    inputMode: "quantity",
    updatedAt: `${DAY}T10:00:00.000Z`,
    ...partial,
  };
}

function completedSale(partial: Partial<Sale> & Pick<Sale, "id" | "totalUgx">): Sale {
  return {
    status: "completed",
    lines: partial.lines ?? [
      line({
        productId: PRODUCT_A,
        lineTotalUgx: partial.totalUgx,
      }),
    ],
    subtotalUgx: partial.totalUgx,
    cashPaidUgx: partial.cashPaidUgx ?? partial.totalUgx,
    debtUgx: partial.debtUgx ?? 0,
    estimatedProfitUgx: partial.totalUgx - 2_000,
    createdAt: partial.createdAt ?? `${DAY}T10:00:00.000Z`,
    updatedAt: partial.createdAt ?? `${DAY}T10:00:00.000Z`,
    pendingSync: false,
    lastSyncError: null,
    soldByUserId: partial.soldByUserId ?? "staff:abc",
    ...partial,
  };
}

function baseReportParams(sales: Sale[], extra?: Partial<Parameters<typeof buildCashPositionReport>[0]>) {
  return {
    lang: "en" as const,
    dayKey: DAY,
    shopName: "Test Shop",
    sales,
    products: [productA, productB],
    returnRecords: [] as ReturnRecord[],
    debtPayments: [],
    cashExpenses: [],
    staffAccounts: [
      {
        id: "s1",
        name: "Sarah",
        role: "cashier" as const,
        active: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "s2",
        name: "John",
        role: "cashier" as const,
        active: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    generalCategoryLabel: "General",
    ...extra,
  };
}

describe("attributeSalePaymentBuckets", () => {
  it("splits credit and cash on partial pay sale", () => {
    const buckets = attributeSalePaymentBuckets(
      completedSale({
        id: "s1",
        totalUgx: 10_000,
        cashPaidUgx: 4_000,
        debtUgx: 6_000,
        paymentMethod: "credit",
      }),
    );
    expect(buckets.credit).toBe(6_000);
    expect(buckets.cash).toBe(4_000);
  });
});

describe("allocateSaleLineRevenueUgx", () => {
  it("allocates cart discount proportionally across lines", () => {
    const sale = completedSale({
      id: "disc",
      totalUgx: 90_000,
      discountTotalUgx: 10_000,
      lines: [
        line({ productId: PRODUCT_A, lineTotalUgx: 50_000 }),
        line({ productId: PRODUCT_B, lineTotalUgx: 50_000 }),
      ],
    });
    const allocated = allocateSaleLineRevenueUgx(sale);
    expect(allocated.reduce((a, b) => a + b, 0)).toBe(90_000);
  });
});

describe("buildCashPositionReport", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds today summary, payments, cash position, categories, and cashiers", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T12:00:00.000Z"));

    const sales = [
      completedSale({ id: "s1", totalUgx: 50_000, paymentMethod: "cash", soldByUserId: "staff:s1" }),
      completedSale({
        id: "s2",
        totalUgx: 30_000,
        cashPaidUgx: 10_000,
        debtUgx: 20_000,
        paymentMethod: "credit",
        soldByUserId: "staff:s2",
      }),
      completedSale({
        id: "s3",
        totalUgx: 20_000,
        paymentMethod: "mobile_money",
        soldByUserId: "staff:s1",
        createdAt: "2026-06-11T10:00:00.000Z",
      }),
    ];

    const report = buildCashPositionReport({
      ...baseReportParams(sales),
      debtPayments: [{ id: "p1", customerId: "c1", amountUgx: 5_000, createdAt: `${DAY}T11:00:00.000Z` }],
      cashExpenses: [
        {
          id: "e1",
          category: "transport",
          amountUgx: 3_000,
          description: "",
          paidOn: DAY,
          createdAt: `${DAY}T09:00:00.000Z`,
          createdByUserId: "owner",
          pendingSync: false,
        },
      ],
    });

    expect(report.summary.totalSalesUgx).toBe(80_000);
    expect(report.summary.transactionCount).toBe(2);
    expect(report.summary.itemsSold).toBe(2);
    expect(report.cashPosition.cashSalesUgx).toBe(60_000);
    expect(report.cashPosition.debtCollectedUgx).toBe(5_000);
    expect(report.cashPosition.refundsUgx).toBe(0);
    expect(report.cashPosition.expensesUgx).toBe(3_000);
    expect(report.cashPosition.expectedCashUgx).toBe(62_000);
    expect(report.categories[0]?.categoryLabel).toBe("Beverages");
    expect(report.cashiers.find((c) => c.cashierId === "staff:s1")?.name).toBe("Sarah");
    expect(report.cashiers.find((c) => c.cashierId === "staff:s2")?.name).toBe("John (inactive)");
    expect(report.cashiers.find((c) => c.cashierId === "staff:s2")?.kind).toBe("inactive");
  });

  it("exposes refunds in cash position section", () => {
    const saleRow = completedSale({ id: "s1", totalUgx: 100_000, cashPaidUgx: 100_000 });
    const adjusted = { ...saleRow, ...reduceSaleTotalsByAmount(saleRow, 15_000) };
    const returns: ReturnRecord[] = [
      {
        id: "r1",
        saleId: saleRow.id,
        productId: PRODUCT_A,
        productName: "Soda",
        quantity: 1,
        refundAmountUgx: 15_000,
        reason: "other",
        actorUserId: "u1",
        actorName: "Owner",
        shiftId: null,
        createdAt: `${DAY}T12:00:00.000Z`,
      },
    ];
    const report = buildCashPositionReport(baseReportParams([adjusted], { returnRecords: returns }));
    expect(report.cashPosition.refundsUgx).toBe(15_000);
    expect(report.cashPosition.expectedCashUgx).toBe(85_000);
  });

  it("category totals equal total sales when cart discount applied", () => {
    const sale = completedSale({
      id: "disc",
      totalUgx: 90_000,
      discountTotalUgx: 10_000,
      lines: [
        line({ productId: PRODUCT_A, lineTotalUgx: 50_000 }),
        line({ productId: PRODUCT_B, lineTotalUgx: 50_000 }),
      ],
    });
    const report = buildCashPositionReport(baseReportParams([sale]));
    expect(sumCategoryAmounts(report.categories)).toBe(report.summary.totalSalesUgx);
  });

  it("shows payment adjustment for cross-day returns", () => {
    const priorSale = completedSale({
      id: "prior",
      totalUgx: 40_000,
      createdAt: "2026-06-11T10:00:00.000Z",
    });
    const todaySale = completedSale({ id: "today", totalUgx: 60_000 });
    const returns: ReturnRecord[] = [
      {
        id: "r1",
        saleId: priorSale.id,
        productId: PRODUCT_A,
        productName: "Soda",
        quantity: 1,
        refundAmountUgx: 10_000,
        reason: "other",
        actorUserId: "u1",
        actorName: "Owner",
        shiftId: null,
        createdAt: `${DAY}T12:00:00.000Z`,
      },
    ];
    const report = buildCashPositionReport(baseReportParams([priorSale, todaySale], { returnRecords: returns }));
    expect(report.summary.totalSalesUgx).toBe(50_000);
    expect(sumPaymentMethodAmounts(report.paymentMethods)).toBe(60_000);
    expect(report.paymentAdjustmentUgx).toBe(-10_000);
    expect(sumPaymentMethodAmounts(report.paymentMethods) + report.paymentAdjustmentUgx).toBe(
      report.summary.totalSalesUgx,
    );
  });

  it("uses stable cashier ids and labels deleted staff", () => {
    const sales = [
      completedSale({ id: "s1", totalUgx: 10_000, soldByUserId: "staff:gone" }),
      completedSale({ id: "s2", totalUgx: 20_000, soldByUserId: "staff:gone" }),
      completedSale({ id: "s3", totalUgx: 30_000, soldByUserId: "local:owner" }),
    ];
    const report = buildCashPositionReport(baseReportParams(sales));
    const deleted = report.cashiers.filter((c) => c.kind === "deleted");
    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.cashierId).toBe("staff:gone");
    expect(deleted[0]?.transactionCount).toBe(2);
    expect(report.cashiers.find((c) => c.kind === "owner")?.name).toBe("Owner");
    const ids = report.cashiers.map((c) => c.cashierId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("cashPositionVariance", () => {
  it("classifies balanced, shortage, and excess", () => {
    expect(cashPositionVariance(100_000, 100_000).kind).toBe("balanced");
    expect(cashPositionVariance(100_000, 95_000).kind).toBe("shortage");
    expect(cashPositionVariance(100_000, 102_000).kind).toBe("excess");
  });
});

describe("cashPosition exports", () => {
  it("includes refunds, adjustment, and reconciliation totals", () => {
    const sale = completedSale({ id: "s1", totalUgx: 50_000 });
    const report = buildCashPositionReport(baseReportParams([sale]));
    report.paymentAdjustmentUgx = -5_000;
    report.cashPosition.refundsUgx = 2_000;
    const reconciliation = { physicalCountUgx: 48_000, varianceUgx: -2_000, varianceKind: "shortage" as const };
    const text = cashPositionToPlainText("en", report, reconciliation);
    expect(text).toContain("50,000");
    expect(text).toContain("Refunds");
    expect(text).toContain("Returns on prior sales");
    expect(text).toContain("48,000");
    expect(text).toContain("Shortage");
    const csv = cashPositionToCsv(report, reconciliation);
    expect(csv).toContain("refunds_ugx");
    expect(csv).toContain("physical_count_ugx");
    expect(csv).toContain("staff:abc");
  });
});

describe("cash position performance", () => {
  const THRESHOLDS_MS = { sales1k: 500, sales10k: 1000 } as const;

  function mkBulkSale(i: number): Sale {
    return completedSale({
      id: `bulk-${i}`,
      totalUgx: 1_000,
      paymentMethod: i % 3 === 0 ? "mobile_money" : "cash",
      soldByUserId: `staff:s${i % 5}`,
      lines: [
        line({
          productId: i % 2 === 0 ? PRODUCT_A : PRODUCT_B,
          lineTotalUgx: 1_000,
        }),
      ],
    });
  }

  it("builds 1,000-sale report under threshold", () => {
    const sales = Array.from({ length: 1_000 }, (_, i) => mkBulkSale(i));
    const t0 = performance.now();
    const report = buildCashPositionReport(baseReportParams(sales));
    const elapsed = performance.now() - t0;
    expect(report.summary.totalSalesUgx).toBe(1_000_000);
    expect(elapsed).toBeLessThanOrEqual(THRESHOLDS_MS.sales1k);
  });

  it("builds 10,000-sale report under threshold", () => {
    const sales = Array.from({ length: 10_000 }, (_, i) => mkBulkSale(i));
    const t0 = performance.now();
    const report = buildCashPositionReport(baseReportParams(sales));
    const elapsed = performance.now() - t0;
    expect(report.summary.totalSalesUgx).toBe(10_000_000);
    expect(elapsed).toBeLessThanOrEqual(THRESHOLDS_MS.sales10k);
  });
});
