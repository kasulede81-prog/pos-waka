import { describe, expect, it } from "vitest";
import { renderInvestigationSlot, resolveInvestigationWidgets } from "./enterpriseInvestigationRegistry";
import type { InvestigationCenterContext } from "./investigationWidgetTypes";
import { resolveInvestigationMode } from "./investigationMode";
import { resolveInvestigationCategories, resolveInvestigationTabs } from "./investigationCatalog";

function minimalCtx(mode: InvestigationCenterContext["mode"]): InvestigationCenterContext {
  return {
    lang: "en",
    mode,
    businessType: mode === "pharmacy" ? "pharmacy" : "mini_supermarket",
    can: () => true,
    tab: "timeline",
    setTab: () => {},
    category: "all",
    setCategory: () => {},
    activeKpi: null,
    setActiveKpi: () => {},
    sharedKpi: null,
    pharmacyKpi: null,
    tabs: resolveInvestigationTabs(mode),
    categories: resolveInvestigationCategories(mode),
    accentCategories: new Set(),
    getTimelinePresentation: () => null,
    includeArchived: false,
    setIncludeArchived: () => {},
    quickFilter: { kind: "preset", preset: "today" },
    dateFrom: "2026-07-09",
    dateTo: "2026-07-09",
    actorUserId: "all",
    action: "all",
    productId: "",
    customerId: "",
    supplierId: "",
    searchText: "",
    onSearchTextChange: () => {},
    debouncedSearchText: "",
    filters: { dateFrom: "2026-07-09", dateTo: "2026-07-09", actorUserId: "all", action: "all", searchText: "" },
    filtered: [],
    kpiCards: [],
    pharmacyKpiCards: [],
    periodLabel: "",
    auditIndex: { entries: [], sortedIndices: [], dateKeys: [], actors: [], haystacks: [] },
    auditLogs: [],
    products: [],
    customers: [],
    suppliers: [],
    shopName: "Shop",
    productById: new Map(),
    customerById: new Map(),
    saleById: new Map(),
    integrityReport: { ok: true, violations: [], salesScanned: 0, returnsScanned: 0 },
    returnsInRange: [],
    allReturns: [],
    shiftsInRange: [],
    pharmacyRegister: [],
    selected: null,
    setSelected: () => {},
    menuEntry: null,
    setMenuEntry: () => {},
    filtersOpen: false,
    setFiltersOpen: () => {},
    exportOpen: false,
    setExportOpen: () => {},
    traceReturn: null,
    setTraceReturn: () => {},
    applyDateFilter: () => {},
    applyFilters: () => {},
    syncUrl: () => {},
    handleKpiSelect: () => {},
    handlePharmacyKpiSelect: () => {},
    downloadCsv: () => {},
    downloadExcel: () => {},
    downloadPdf: async () => {},
    downloadJson: () => {},
    printEntries: () => {},
    shareEntries: async () => {},
    copyEntry: async () => {},
  };
}

describe("enterprise investigation registry", () => {
  it("resolves retail mode from business type", () => {
    expect(resolveInvestigationMode("mini_supermarket")).toBe("retail");
    expect(resolveInvestigationMode("pharmacy", true)).toBe("pharmacy");
  });

  it("registers shared header for every business mode", () => {
    for (const mode of ["retail", "pharmacy", "hospitality", "wholesale"] as const) {
      const widgets = resolveInvestigationWidgets("header", minimalCtx(mode));
      expect(widgets.some((w) => w.id === "retail-header")).toBe(true);
    }
  });

  it("injects pharmacy KPI grid only for pharmacy mode", () => {
    expect(resolveInvestigationWidgets("kpi-grid", minimalCtx("retail")).some((w) => w.id === "pharmacy-kpi-grid")).toBe(false);
    expect(resolveInvestigationWidgets("kpi-grid", minimalCtx("pharmacy")).some((w) => w.id === "pharmacy-kpi-grid")).toBe(true);
  });

  it("shows compliance panel only on pharmacy compliance tab", () => {
    const retail = minimalCtx("retail");
    expect(resolveInvestigationWidgets("compliance", retail)).toHaveLength(0);

    const pharmacyTimeline = minimalCtx("pharmacy");
    expect(resolveInvestigationWidgets("compliance", pharmacyTimeline)).toHaveLength(0);

    const pharmacyCompliance = { ...minimalCtx("pharmacy"), tab: "compliance" as const };
    expect(resolveInvestigationWidgets("compliance", pharmacyCompliance).some((w) => w.id === "pharmacy-compliance-panel")).toBe(true);
  });

  it("renderSlot returns null for empty slots", () => {
    expect(renderInvestigationSlot("alerts", minimalCtx("retail"))).toBeNull();
  });
});
