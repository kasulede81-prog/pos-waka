import { describe, expect, it, vi, afterEach } from "vitest";
import type { Product, ReturnRecord, Sale } from "../types";
import {
  boundsRequiresArchivedSales,
  resolveDateFilterBounds,
  revenueSalesInBounds,
  returnsInBounds,
  saleMatchesFilter,
  saleMatchesReceiptRange,
  stockMovementsInBounds,
} from "./dateFilters";
import { getCompletedFinancials, getCompletedRevenue } from "./financialMetrics";
import { computeProfitGroupedByCategory } from "./homeProfit";
import { localGetRangeSummary } from "./localReporting";
import { isCompletedSale } from "./saleStatus";
import { saleReportingDayKey } from "./datesUg";

const PRODUCTS: Product[] = [
  {
    id: "p1",
    name: "Item",
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 2_000,
    stockOnHand: 10,
    baseUnit: "pcs",
    sellingMode: "unit",
    category: "General",
    sku: "",
    minimumStockAlert: 1,
    updatedAt: "2026-06-10T08:00:00.000Z",
    version: 1,
  },
];

function completedSale(createdAt: string, totalUgx: number): Sale {
  return {
    id: crypto.randomUUID(),
    createdAt,
    updatedAt: createdAt,
    status: "completed",
    subtotalUgx: totalUgx,
    totalUgx,
    cashPaidUgx: totalUgx,
    debtUgx: 0,
    estimatedProfitUgx: totalUgx - 2_000,
    lines: [
      {
        productId: "p1",
        name: "Item",
        quantity: 1,
        unitPriceUgx: totalUgx,
        unitCostUgx: 2_000,
        estimatedProfitUgx: totalUgx - 2_000,
        inputMode: "quantity",
        lineTotalUgx: totalUgx,
      },
    ],
    pendingSync: false,
  };
}

describe("resolveDateFilterBounds — calendar week", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("this_week runs Monday through today in Kampala", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T15:00:00.000Z"));
    const bounds = resolveDateFilterBounds({ kind: "preset", preset: "this_week" });
    expect(bounds.fromKey).toBe("2026-06-08");
    expect(bounds.toKey).toBe("2026-06-12");
    expect(bounds.isSingleDay).toBe(false);
  });

  it("today is a single day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T15:00:00.000Z"));
    const bounds = resolveDateFilterBounds({ kind: "preset", preset: "today" });
    expect(bounds.fromKey).toBe("2026-06-12");
    expect(bounds.toKey).toBe("2026-06-12");
    expect(bounds.isSingleDay).toBe(true);
  });

  it("custom day filter", () => {
    const bounds = resolveDateFilterBounds({ kind: "day", dateKey: "2026-06-01" });
    expect(bounds.fromKey).toBe("2026-06-01");
    expect(bounds.isSingleDay).toBe(true);
  });

  it("this_month starts on first of month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T15:00:00.000Z"));
    const bounds = resolveDateFilterBounds({ kind: "preset", preset: "this_month" });
    expect(bounds.fromKey).toBe("2026-06-01");
    expect(bounds.toKey).toBe("2026-06-12");
  });
});

describe("week consistency across surfaces", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("Receipts week total = Profit week total = Reports week total", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T12:00:00.000Z"));

    const sales = [
      completedSale("2026-06-08T10:00:00.000Z", 50_000),
      completedSale("2026-06-10T10:00:00.000Z", 30_000),
      completedSale("2026-06-05T10:00:00.000Z", 99_000),
      completedSale("2026-06-12T09:00:00.000Z", 20_000),
    ];
    const returns: ReturnRecord[] = [];
    const filter = { kind: "preset" as const, preset: "this_week" as const };
    const bounds = resolveDateFilterBounds(filter);

    const receiptScoped = sales.filter((s) => saleMatchesFilter(s, bounds));
    const profitScoped = sales.filter((s) => isCompletedSale(s) && saleMatchesFilter(s, bounds));
    const reportBundle = localGetRangeSummary(sales, PRODUCTS, [], returns, [], filter);

    const receiptRevenue = getCompletedRevenue(
      receiptScoped.filter(isCompletedSale),
      returns,
      PRODUCTS,
    );
    const profitGrouped = computeProfitGroupedByCategory(
      profitScoped,
      new Map(PRODUCTS.map((p) => [p.id, p])),
      "General",
      returnsInBounds(returns, bounds),
    );

    expect(receiptRevenue).toBe(100_000);
    expect(profitGrouped.total.salesUgx).toBe(100_000);
    expect(reportBundle.summary.totalRevenueUgx).toBe(100_000);
    expect(reportBundle.profitUgx).toBe(profitGrouped.total.profitUgx);
  });

  it("legacy saleMatchesReceiptRange week matches calendar week", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T12:00:00.000Z"));
    const bounds = resolveDateFilterBounds({ kind: "preset", preset: "this_week" });
    const sale = completedSale("2026-06-09T10:00:00.000Z", 10_000);
    expect(saleMatchesReceiptRange(sale.createdAt, "week")).toBe(true);
    expect(saleMatchesFilter(sale, bounds)).toBe(true);
    const oldWeek = completedSale("2026-06-05T10:00:00.000Z", 10_000);
    expect(saleMatchesReceiptRange(oldWeek.createdAt, "week")).toBe(false);
  });
});

describe("today and month filters", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("month filter daily trend spans calendar month days, not current week", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T12:00:00.000Z"));

    const sales = [
      completedSale("2026-06-01T10:00:00.000Z", 10_000),
      completedSale("2026-06-08T10:00:00.000Z", 20_000),
      completedSale("2026-06-10T10:00:00.000Z", 30_000),
      completedSale("2026-06-12T09:00:00.000Z", 40_000),
    ];
    const filter = { kind: "preset" as const, preset: "this_month" as const };
    const bundle = localGetRangeSummary(sales, PRODUCTS, [], [], [], filter);

    expect(bundle.dailyTrend).toHaveLength(12);
    expect(bundle.dailyTrend.find((d) => d.day === "2026-06-08")?.revenueUgx).toBe(20_000);
    expect(bundle.dailyTrend.find((d) => d.day === "2026-06-12")?.revenueUgx).toBe(40_000);
    expect(bundle.dailyTrend.find((d) => d.day === "2026-06-02")?.revenueUgx).toBe(0);
  });

  it("today filter matches one Kampala day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T18:00:00.000Z"));
    const filter = { kind: "preset" as const, preset: "today" as const };
    const bounds = resolveDateFilterBounds(filter);
    const sales = [
      completedSale("2026-06-12T10:00:00.000Z", 40_000),
      completedSale("2026-06-11T12:00:00.000Z", 10_000),
    ];
    const inBounds = revenueSalesInBounds(sales, bounds);
    expect(inBounds).toHaveLength(1);
    expect(getCompletedFinancials(inBounds, [], PRODUCTS).revenueUgx).toBe(40_000);
  });
});

describe("stockMovementsInBounds", () => {
  it("keeps only movements inside the selected reporting range", () => {
    const bounds = resolveDateFilterBounds({ kind: "range", fromKey: "2026-07-01", toKey: "2026-07-31" });
    const filtered = stockMovementsInBounds(
      [
        { id: "1", at: "2026-06-30T13:55:00.000Z", deltaBaseUnits: -6, productName: "lindazi", kind: "sale_out", summary: "sale" },
        { id: "2", at: "2026-07-09T13:02:00.000Z", deltaBaseUnits: -1, productName: "hima", kind: "sale_out", summary: "sale" },
        { id: "3", at: "2026-08-01T10:00:00.000Z", deltaBaseUnits: -1, productName: "late", kind: "sale_out", summary: "sale" },
      ] as import("../types").StockMovement[],
      bounds,
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.productName).toBe("hima");
  });
});

describe("Kampala timezone edge", () => {
  it("saleReportingDayKey uses Kampala calendar day", () => {
    const s = completedSale("2026-05-31T07:00:00.000Z", 1_000);
    expect(saleReportingDayKey(s)).toBe("2026-05-31");
  });
});

describe("archive boundary", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("flags ranges older than active sales memory window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T12:00:00.000Z"));
    const oldDay = { kind: "day" as const, dateKey: "2026-04-01" };
    expect(boundsRequiresArchivedSales(resolveDateFilterBounds(oldDay))).toBe(true);
    const today = resolveDateFilterBounds({ kind: "preset", preset: "today" });
    expect(boundsRequiresArchivedSales(today)).toBe(false);
  });
});
