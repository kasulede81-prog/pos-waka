import { describe, expect, it } from "vitest";
import { resolveReportWidgets, renderReportSlot } from "./enterpriseReportsRegistry";
import type { ReportsCenterContext } from "./reportWidgetTypes";
import { resolveReportsMode } from "./reportsMode";
import { resolveReportsPageTitle } from "./reportsCatalog";

function minimalCtx(mode: ReportsCenterContext["mode"], overrides: Partial<ReportsCenterContext> = {}): ReportsCenterContext {
  return {
    lang: "en",
    mode,
    businessType: mode === "pharmacy" ? "pharmacy" : mode === "wholesale" ? "wholesale" : "mini_supermarket",
    can: () => true,
    canProfit: true,
    pageTitle: resolveReportsPageTitle("en", mode),
    periodLabel: "",
    filter: { kind: "preset", preset: "this_month" },
    setFilter: () => {},
    includeArchived: false,
    setIncludeArchived: () => {},
    archiveNotice: false,
    archivedSalesCount: 0,
    needsArchive: false,
    compareEnabled: true,
    setCompareEnabled: () => {},
    searchQuery: "",
    setSearchQuery: () => {},
    dateOpen: false,
    setDateOpen: () => {},
    exportOpen: false,
    setExportOpen: () => {},
    activeKpi: null,
    setActiveKpi: () => {},
    reportHint: null,
    setReportHint: () => {},
    category: "overview",
    setCategory: () => {},
    legacyTabCleanup: () => {},
    report: {
      source: "local",
      revenue: 0,
      cash: 0,
      profit: 0,
      debt: 0,
      count: 0,
      discountsUgx: 0,
      taxesUgx: 0,
      debtOutstanding: 0,
      topProducts: [],
      slowProducts: [],
      marginLeaders: [],
      dailyTrend: [],
      stockValueAtCost: 0,
      supplierDebtTotal: 0,
      loading: false,
    },
    analytics: {
      customerCount: 0,
      priorCustomerCount: 0,
      expensesUgx: 0,
      paymentMix: [],
      trendBars: [],
      sparkline: [],
      inventory: {
        stockValueAtCostUgx: 0,
        lowStock: [],
        outOfStock: [],
        restockRecommendations: [],
      },
      bounds: { fromKey: "2026-07-01", toKey: "2026-07-09", isSingleDay: false },
      prior: null,
      priorBounds: { fromKey: "2026-06-24", toKey: "2026-06-30", isSingleDay: false },
      current: {} as never,
    } as ReportsCenterContext["analytics"],
    kpiCards: [],
    aiInsights: [],
    topProducts: [],
    topCustomers: [],
    topCashiers: [],
    marginLeaders: [],
    purchasesTodayUgx: 0,
    showDailyExport: false,
    reportDayKey: "2026-07-09",
    exportSummaryText: "",
    products: [],
    customers: [],
    purchases: [],
    suppliers: [],
    sales: [],
    returnRecords: [],
    stockMovements: [],
    cashExpenses: [],
    debtPayments: [],
    supplierPayments: [],
    cashDrawerAdjustments: [],
    shifts: [],
    preferences: { businessType: "mini_supermarket" } as never,
    auditLogs: [],
    pharmacyExpiryReport: null,
    hospitalityReports: null,
    hospitalityOpenBills: null,
    hospitalityFloor: null,
    wholesaleSection: null,
    handleKpiSelect: () => {},
    onExportPdf: () => {},
    onExportCsv: () => {},
    onExportExcel: () => {},
    onPrint: () => {},
    onShare: () => {},
    onCopy: () => {},
    ...overrides,
  };
}

describe("enterprise reports registry", () => {
  it("resolves business mode from business type", () => {
    expect(resolveReportsMode("mini_supermarket")).toBe("retail");
    expect(resolveReportsMode("pharmacy", true)).toBe("pharmacy");
    expect(resolveReportsMode("wholesale")).toBe("wholesale");
  });

  it("registers shared header for every business mode", () => {
    for (const mode of ["retail", "pharmacy", "hospitality", "wholesale"] as const) {
      const widgets = resolveReportWidgets("header", minimalCtx(mode));
      expect(widgets.some((w) => w.id === "retail-header")).toBe(true);
    }
  });

  it("injects pharmacy operations widget only for pharmacy overview", () => {
    expect(
      resolveReportWidgets("operations", minimalCtx("retail")).some((w) => w.id === "pharmacy-operations-overview"),
    ).toBe(false);
    expect(
      resolveReportWidgets("operations", minimalCtx("pharmacy", {
        pharmacyExpiryReport: { expiring: [], expired: [], expiringValueUgx: 0, expiredValueUgx: 0 },
      })).some(
        (w) => w.id === "pharmacy-operations-overview",
      ),
    ).toBe(true);
    expect(
      resolveReportWidgets("operations", minimalCtx("pharmacy", { category: "sales" })).some(
        (w) => w.id === "pharmacy-operations-overview",
      ),
    ).toBe(false);
  });

  it("respects business mode for wholesale operations injection", () => {
    expect(
      resolveReportWidgets("operations", minimalCtx("retail")).some((w) => w.id === "wholesale-operations-overview"),
    ).toBe(false);
    expect(
      resolveReportWidgets("operations", minimalCtx("wholesale", { wholesaleSection: { debtOutstanding: 0, count: 0, stockValueAtCost: 0, customers: [] } })).some(
        (w) => w.id === "wholesale-operations-overview",
      ),
    ).toBe(true);
  });

  it("orders widgets by priority within a slot", () => {
    const widgets = resolveReportWidgets("status", minimalCtx("retail"));
    const priorities = widgets.map((w) => w.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
  });

  it("renderSlot returns null for empty slots", () => {
    expect(renderReportSlot("financial", minimalCtx("retail"))).toBeNull();
  });
});
