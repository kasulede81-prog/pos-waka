import { beforeEach, describe, expect, it, vi } from "vitest";
import { monthKeyKampala, monthKeyOptionsKampala, previousMonthKey, formatDateTimeKampala, dateKeyKampala } from "./datesUg";
import { buildDailyReportDocument, buildDailyReportPdfBlob } from "./dailyReportPdf";
import { buildXReportDocument, buildXReportPdfBlob } from "./xReportExport";
import { renderReportDocumentPdf } from "./reportDocumentPdf";
import { printReportPdfBlob } from "./reportDocumentPrint";
import { reportDocumentStatusLabel, statusFromAuthority, type ReportDocumentModel } from "./reportDocumentModel";
import type { DayCloseSummary, Product, Sale } from "../types";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import { buildXReportSnapshot } from "./xReport";
import type { ShopPreferences } from "../types";
import { applyClosedDayToCashPositionReport } from "./closedDayAuthority";
import { buildCashPositionReport } from "./cashPosition";
import { buildCashPositionDocument } from "./cashPositionExport";
import { buildProfitReportDocument } from "./profitReportDocument";
import { buildMonthlyBusinessReport, buildMonthlyReportDocument, salesInMonth } from "./monthlyBusinessReport";

const DAY_A = "2026-08-12";
const DAY_B = "2026-08-13";

const product: Product = {
  id: "p1",
  name: "Item",
  sellingPricePerUnitUgx: 500_000,
  costPricePerUnitUgx: 100_000,
  stockOnHand: 50,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 5,
  updatedAt: `${DAY_A}T09:00:00.000Z`,
  version: 1,
};

function sale(id: string, totalUgx: number, createdAt: string): Sale {
  return {
    id,
    createdAt,
    updatedAt: createdAt,
    subtotalUgx: totalUgx,
    totalUgx,
    cashPaidUgx: totalUgx,
    debtUgx: 0,
    paymentMethod: "cash",
    estimatedProfitUgx: totalUgx - 100_000,
    lines: [
      {
        productId: "p1",
        name: "Item",
        quantity: 1,
        unitPriceUgx: totalUgx,
        unitCostUgx: 100_000,
        lineTotalUgx: totalUgx,
        estimatedProfitUgx: totalUgx - 100_000,
        inputMode: "quantity",
        voided: false,
        updatedAt: createdAt,
      },
    ],
    pendingSync: false,
    lastSyncError: null,
    status: "completed",
  };
}

function closeFor(salesUgx: number): DayCloseSummary {
  const createdAt = `${DAY_A}T18:00:00.000Z`;
  const row = {
    id: "close-a",
    dateKey: DAY_A,
    expectedCashUgx: salesUgx,
    countedCashUgx: salesUgx,
    differenceUgx: 0,
    totalSalesUgx: salesUgx,
    totalDebtUgx: 0,
    profitEstimateUgx: 400_000,
    openingFloatUgx: 0,
    createdAt,
    closedByUserId: "owner",
    closedByLabel: "Owner",
  };
  return {
    ...row,
    documentSnapshot: buildDayCloseSnapshot({
      closedByUserId: "owner",
      closedByLabel: "Owner",
      row,
      drawer: {
        cashFromSalesUgx: salesUgx,
        debtCollectedUgx: 0,
        refundsUgx: 0,
        expenseUgx: 0,
        openingFloatUgx: 0,
        cashSalesUgx: salesUgx,
        supplierPaymentsUgx: 0,
        adjustmentInflowsUgx: 0,
        adjustmentOutflowsUgx: 0,
        cashRefundsUgx: 0,
      },
      transactionCount: 1,
    }),
    supersededAt: null,
    pendingSync: false,
    updatedAt: createdAt,
  };
}

const prefs = { shopDisplayName: "Waka", cashDrawerFormulaVersion: "v2", shifts: [] } as unknown as ShopPreferences;

describe("REPORTS-1.2 document quality", () => {
  const closedSale = sale("s-a", 500_000, `${DAY_A}T10:00:00.000Z`);
  const lateSale = sale("s-late", 50_000, `${DAY_A}T16:00:00.000Z`);
  const close = closeFor(500_000);

  it("CASE A: closed day PDF headlines stay 500,000 after a late sale", () => {
    const model = buildDailyReportDocument({
      lang: "en",
      dateKey: DAY_A,
      shopName: "Waka Mart",
      sales: [closedSale, lateSale],
      products: [product],
      returnRecords: [],
      debtPayments: [],
      cashExpenses: [],
      topProducts: [],
      dayCloses: [close],
    });
    expect(model.status).toBe("closed_day");
    expect(model.sections[0]?.rows[0]?.value).toContain("500,000");
    expect(model.sections[0]?.rows[0]?.value).not.toContain("550,000");
  });

  it("CASE A: X, cash, profit, and monthly headlines stay 500,000", () => {
    const sales = [closedSale, lateSale];
    const snapshot = buildXReportSnapshot({
      dateKey: DAY_A,
      shopName: "Waka Mart",
      sales,
      returns: [],
      products: [product],
      voidRecords: [],
      cashExpenses: [],
      debtPayments: [],
      supplierPayments: [],
      cashDrawerAdjustments: [],
      dayDrawerOpens: [],
      shifts: [],
      preferences: prefs,
      dayCloses: [close],
    });
    expect(buildXReportDocument("en", snapshot).sections[0]?.rows[0]?.value).toContain("500,000");
    expect(snapshot.totalSalesUgx).toBe(500_000);

    const liveCash = buildCashPositionReport({
      lang: "en",
      dayKey: DAY_A,
      shopName: "Waka Mart",
      sales,
      products: [product],
      returnRecords: [],
      debtPayments: [],
      cashExpenses: [],
      staffAccounts: [],
      generalCategoryLabel: "General",
    });
    const cashDoc = buildCashPositionDocument("en", applyClosedDayToCashPositionReport(liveCash, close));
    expect(cashDoc.sections[0]?.rows[0]?.value).toContain("500,000");
    expect(cashDoc.status).toBe("closed_day");

    const profitDoc = buildProfitReportDocument({
      lang: "en",
      shopName: "Waka Mart",
      periodLabel: DAY_A,
      bounds: { fromKey: DAY_A, toKey: DAY_A, isSingleDay: true },
      sales,
      returnRecords: [],
      products: [product],
      dayCloses: [close],
      profitUgx: 350_000,
      revenueUgx: 550_000,
      costUgx: 200_000,
      marginPct: 63.6,
      groups: [{ categoryLabel: "General", profitUgx: 350_000, products: [{ name: "Item", profitUgx: 350_000 }] }],
    });
    expect(profitDoc.sections[0]?.rows.find((r) => r.value.includes("500,000"))).toBeTruthy();
    expect(profitDoc.sections.some((s) => s.live)).toBe(true);

    const monthly = buildMonthlyBusinessReport({
      monthKey: "2026-08",
      shopName: "Waka Mart",
      sales,
      returnRecords: [],
      products: [product],
      staffAccounts: [],
      dayCloses: [close],
    });
    expect(monthly.totalSalesUgx).toBe(500_000);
    expect(buildMonthlyReportDocument("en", monthly, { includeProfit: true }).status).toBe("operational");
  });

  it("CASE B: open day stays live", () => {
    const open = sale("s-b", 80_000, `${DAY_B}T10:00:00.000Z`);
    const model = buildDailyReportDocument({
      lang: "en",
      dateKey: DAY_B,
      shopName: "Waka Mart",
      sales: [open],
      products: [product],
      returnRecords: [],
      debtPayments: [],
      cashExpenses: [],
      topProducts: [],
      dayCloses: [close],
    });
    expect(model.status).toBe("open_day");
    expect(model.sections[0]?.rows[0]?.value).toContain("80,000");
  });

  it("CASE C: mixed range status is operational", () => {
    expect(statusFromAuthority("mixed", false)).toBe("operational");
    expect(reportDocumentStatusLabel("en", "operational")).toBe("Operational Report");
  });

  it("CASE D: Kampala month options follow 23:59 / 00:00 month boundary", () => {
    expect(dateKeyKampala("2026-08-31T20:59:00.000Z")).toBe("2026-08-31");
    expect(dateKeyKampala("2026-08-31T21:00:00.000Z")).toBe("2026-09-01");
    expect(monthKeyKampala("2026-08-31T20:59:00.000Z")).toBe("2026-08");
    expect(monthKeyKampala("2026-08-31T21:00:00.000Z")).toBe("2026-09");
    expect(monthKeyOptionsKampala(1, new Date("2026-08-31T20:59:00.000Z"))[0]).toBe("2026-08");
    expect(monthKeyOptionsKampala(1, new Date("2026-08-31T21:00:00.000Z"))[0]).toBe("2026-09");
    expect(previousMonthKey("2026-01")).toBe("2025-12");
    const monthEnd = sale("s-aug-end", 10_000, "2026-08-31T20:59:00.000Z");
    const monthStart = sale("s-sep-start", 20_000, "2026-08-31T21:00:00.000Z");
    expect(salesInMonth([monthEnd, monthStart], "2026-08").map((s) => s.id)).toEqual(["s-aug-end"]);
    expect(salesInMonth([monthEnd, monthStart], "2026-09").map((s) => s.id)).toEqual(["s-sep-start"]);
  });

  it("CASE E: PDF has Kampala header, footer, and page numbers", async () => {
    const blob = buildDailyReportPdfBlob({
      lang: "en",
      dateKey: DAY_A,
      shopName: "Waka Mart",
      sales: [closedSale],
      products: [product],
      returnRecords: [],
      debtPayments: [],
      cashExpenses: [],
      topProducts: [{ productId: "p1", name: "Item", quantity: 1, revenueUgx: 500_000, profitUgx: 400_000 }],
      dayCloses: [close],
    });
    const pdf = await blob.text();
    expect(pdf).toContain("WAKA POS");
    expect(pdf).toContain("Waka Mart");
    expect(pdf).toContain("Closed Day Report");
    expect(pdf).toContain("Africa/Kampala");
    expect(pdf).toContain("Date:");
    expect(pdf).toContain("Time:");
    expect(pdf).toContain("Timezone:");
    expect(pdf).toContain("Confidential business document");
    expect(pdf).toContain("Page 1 of 1");
  });

  it("CASE E empty: shows no-transactions copy instead of a blank body", async () => {
    const blob = buildDailyReportPdfBlob({
      lang: "en",
      dateKey: "2026-01-01",
      shopName: "Waka Mart",
      sales: [],
      products: [product],
      returnRecords: [],
      debtPayments: [],
      cashExpenses: [],
      topProducts: [],
    });
    const pdf = await blob.text();
    expect(pdf).toContain("No transactions for selected period");
    expect(pdf).toContain("Waka Mart");
    expect(pdf).toContain("2026-01-01");
  });

  it("CASE E: multi-page PDF numbers every page", async () => {
    const model: ReportDocumentModel = {
      kind: "daily",
      lang: "en",
      shopName: "Waka Mart",
      title: "Daily business report",
      periodLabel: DAY_A,
      status: "operational",
      generatedAtIso: "2026-08-13T10:00:00.000Z",
      empty: false,
      sections: [
        {
          title: "Long ledger",
          rows: Array.from({ length: 120 }, (_, i) => ({
            label: `Line ${i + 1}`,
            value: `UGX ${(i + 1) * 1_000}`,
          })),
        },
      ],
    };
    const pdf = await renderReportDocumentPdf(model).text();
    expect(pdf).toContain("Page 1 of 3");
    expect(pdf).toContain("Page 2 of 3");
    expect(pdf).toContain("Page 3 of 3");
    expect(pdf).toContain("Confidential business document");
  });

  it("CASE F: X Report print uses the same PDF document as download", () => {
    const snapshot = buildXReportSnapshot({
      dateKey: DAY_A,
      shopName: "Waka",
      sales: [closedSale, lateSale],
      returns: [],
      products: [product],
      voidRecords: [],
      cashExpenses: [],
      debtPayments: [],
      supplierPayments: [],
      cashDrawerAdjustments: [],
      dayDrawerOpens: [],
      shifts: [],
      preferences: prefs,
      dayCloses: [close],
    });
    const fromDownload = buildXReportPdfBlob("en", snapshot);
    const fromModel = renderReportDocumentPdf(buildXReportDocument("en", snapshot));
    expect(fromDownload.size).toBe(fromModel.size);
    expect(snapshot.totalSalesUgx).toBe(500_000);
  });

  it("generated stamp is always Africa/Kampala", () => {
    const stamp = formatDateTimeKampala("2026-08-12T21:00:00.000Z");
    expect(stamp.dateKey).toBe("2026-08-13");
    expect(stamp.timeZone).toBe("Africa/Kampala");
    expect(stamp.display).toContain("Africa/Kampala");
  });
});

const printMocks = vi.hoisted(() => ({
  printPdfBlobWithDesktop: vi.fn(() => true),
  sharePdfBlob: vi.fn(async () => true),
  isNativePrintPlatform: vi.fn(() => false),
}));

vi.mock("./documentPrint", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./documentPrint")>();
  return {
    ...actual,
    printPdfBlobWithDesktop: printMocks.printPdfBlobWithDesktop,
    sharePdfBlob: printMocks.sharePdfBlob,
  };
});

vi.mock("./nativeReceiptPrint", () => ({
  isNativePrintPlatform: printMocks.isNativePrintPlatform,
}));

describe("REPORTS-1.2 print delivery", () => {
  beforeEach(() => {
    printMocks.printPdfBlobWithDesktop.mockClear();
    printMocks.sharePdfBlob.mockClear();
    printMocks.isNativePrintPlatform.mockReturnValue(false);
  });

  it("CASE F: desktop print uses the PDF blob, not HTML", async () => {
    const blob = new Blob(["%PDF"], { type: "application/pdf" });
    const ok = await printReportPdfBlob("x_report", "waka-x-report.pdf", blob, { title: "X Report" });
    expect(ok).toBe(true);
    expect(printMocks.printPdfBlobWithDesktop).toHaveBeenCalledWith(blob, "X Report");
    expect(printMocks.sharePdfBlob).not.toHaveBeenCalled();
  });

  it("CASE G: native print shares the PDF (no window.print)", async () => {
    printMocks.isNativePrintPlatform.mockReturnValue(true);
    const blob = new Blob(["%PDF"], { type: "application/pdf" });
    const ok = await printReportPdfBlob("x_report", "waka-x-report.pdf", blob, { shareDialogTitle: "Share" });
    expect(ok).toBe(true);
    expect(printMocks.printPdfBlobWithDesktop).not.toHaveBeenCalled();
    expect(printMocks.sharePdfBlob).toHaveBeenCalled();
  });
});
