import { describe, expect, it } from "vitest";
import type { Permission } from "../../../types";
import { resolveDashboardWidgets, renderDashboardSlot } from "./enterpriseDashboardRegistry";
import type { DashboardCenterContext } from "./dashboardWidgetTypes";
import { resolveDashboardMode } from "./dashboardMode";

function minimalCtx(
  mode: DashboardCenterContext["mode"],
  overrides: Partial<DashboardCenterContext> = {},
): DashboardCenterContext {
  return {
    lang: "en",
    surface: "command-center",
    mode,
    businessType: mode === "pharmacy" ? "pharmacy" : mode === "wholesale" ? "wholesale" : "mini_supermarket",
    can: () => true,
    healthScore: 80,
    domainStatuses: [],
    kpiCards: [],
    summaryKey: "cmdCenterSummaryHealthy",
    commandCenter: {
      overview: { revenueUgx: 0, profitUgx: 0, transactionCount: 0 },
      attention: { critical: [], warnings: [], information: [] },
      attentionReviewed: { critical: 0, warnings: 0 },
      liveOps: { openShiftCount: 0, pendingQueueOps: 0, unsyncedOperations: 0, devicesOnline: 1 },
      cash: { hasUnresolvedVariance: false, varianceUgx: 0, expectedUgx: 0, countedUgx: 0 },
      shiftRows: [],
      inventory: {
        lowStockCount: 0,
        outOfStockCount: 0,
        slowMovers: [],
        pendingCountSessions: [],
        expiringCount: 0,
      },
      financial: {
        revenueUgx: 0,
        profitUgx: 0,
        receivablesUgx: 0,
        payablesUgx: 0,
        marginPct: 0,
      },
      integritySignals: [],
      integrity: { score: 100, issues: [] },
    } as unknown as DashboardCenterContext["commandCenter"],
    filteredAttention: { critical: [], warnings: [], information: [] },
    cloudProtection: { scorePct: 100 } as unknown as DashboardCenterContext["cloudProtection"],
    recommendations: [],
    ...overrides,
  };
}

function pharmacyOpsCtx(overrides: Partial<DashboardCenterContext> = {}): DashboardCenterContext {
  return minimalCtx("pharmacy", {
    surface: "pharmacy-operations",
    stats: {
      lowStockCount: 0,
      expiryCounts: { expired: 0, d7: 0, d30: 0 },
      todayDispensingTotalUgx: 0,
      todayProfitUgx: 0,
    } as unknown as DashboardCenterContext["stats"],
    rxStats: {
      waitingVerification: 0,
      readyToDispense: 0,
      dispensedToday: 0,
      refillsDue: 0,
      controlledToday: 0,
      avgDispenseMinutes: null,
    } as unknown as DashboardCenterContext["rxStats"],
    patientStats: {
      patientsWaiting: 0,
      refillsDue: 0,
      topChronicPatients: [],
    } as unknown as DashboardCenterContext["patientStats"],
    complianceStats: { regulatoryAlerts: 0 } as unknown as DashboardCenterContext["complianceStats"],
    purchaseStats: { todayCount: 0, pendingDeliveries: 0 },
    sync: { isOnline: true, health: { lastSuccessAt: null, lastPushAt: null } } as DashboardCenterContext["sync"],
    actorName: "Jane",
    todayKey: "2026-07-09",
    products: [],
    canSell: true,
    canStock: true,
    canPatients: true,
    canReports: true,
    canPurchases: true,
    canReceipts: true,
    canWriteOff: true,
    canProfit: true,
    showRevenue: true,
    showActivityFeed: true,
    activityItems: [],
    ...overrides,
  });
}

describe("enterprise dashboard registry", () => {
  it("resolves business mode from business type", () => {
    expect(resolveDashboardMode("mini_supermarket")).toBe("retail");
    expect(resolveDashboardMode("pharmacy", true)).toBe("pharmacy");
    expect(resolveDashboardMode("wholesale")).toBe("wholesale");
  });

  it("registers shared command center header for every business mode", () => {
    for (const mode of ["retail", "pharmacy", "hospitality", "wholesale"] as const) {
      const widgets = resolveDashboardWidgets("header", minimalCtx(mode));
      expect(widgets.some((w) => w.id === "retail-header")).toBe(true);
    }
  });

  it("injects pharmacy operations widgets only on pharmacy home surface", () => {
    expect(
      resolveDashboardWidgets("live-operations", minimalCtx("pharmacy")).some((w) => w.id === "pharmacy-workflow"),
    ).toBe(false);
    expect(
      resolveDashboardWidgets("live-operations", pharmacyOpsCtx()).some((w) => w.id === "pharmacy-workflow"),
    ).toBe(true);
  });

  it("injects hospitality command center widgets for hospitality mode", () => {
    expect(
      resolveDashboardWidgets(
        "live-operations",
        minimalCtx("hospitality", {
          hospitalityStats: {
            openTables: 2,
            occupiedTables: 3,
            openTabs: 1,
            pendingBillsUgx: 1000,
            pendingBillCount: 2,
            kitchenQueueCount: 1,
            activeWaiters: ["Jane"],
            paymentPendingCount: 0,
          },
          hospitalityFloor: { areas: [], tables: [], sessions: [], stations: [] },
        }),
      ).some((w) => w.id === "hospitality-kitchen-queue"),
    ).toBe(true);
  });

  it("injects wholesale command center widgets for wholesale mode", () => {
    expect(resolveDashboardWidgets("financial", minimalCtx("wholesale")).some((w) => w.id === "wholesale-receivables")).toBe(
      true,
    );
  });

  it("orders widgets by priority within a slot", () => {
    const widgets = resolveDashboardWidgets("status", minimalCtx("retail"));
    const priorities = widgets.map((w) => w.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
  });

  it("filters widgets by permission", () => {
    const denied = pharmacyOpsCtx({ can: () => false });
    expect(resolveDashboardWidgets("inventory", denied).some((w) => w.id === "pharmacy-inventory-alerts")).toBe(false);

    const allowed = pharmacyOpsCtx({
      can: (perm: Permission) => perm === "stock.view",
    });
    expect(resolveDashboardWidgets("inventory", allowed).some((w) => w.id === "pharmacy-inventory-alerts")).toBe(true);
    expect(resolveDashboardWidgets("inventory", allowed).some((w) => w.id === "pharmacy-patients")).toBe(false);
  });

  it("renderSlot returns null for empty slots", () => {
    expect(renderDashboardSlot("insights", minimalCtx("retail"))).toBeNull();
  });
});
