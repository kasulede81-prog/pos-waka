import { describe, expect, it } from "vitest";
import {
  normalizeRescueDiagnostics,
  parseRescueDiagnosticsJson,
  rescueDiagnosticsKindLabel,
} from "./rescueDiagnosticsParse";
import {
  buildRescueFinancialSnapshot,
  buildRescueHealthSummary,
  computeCloudBackupFinancial,
  filterRescueAuditEvents,
  inventoryIntegrityFromSources,
  mapOpsAuditToRescueEvents,
} from "./rescueConsoleIntel";
import type { ShopOpsDetail } from "./wakaInternalAdmin";
import { PREVIEW_SHOP_OPS_DETAIL } from "./internalAdminPreview";

describe("rescueDiagnosticsParse", () => {
  it("detects pilot diagnostics export", () => {
    const parsed = parseRescueDiagnosticsJson(
      JSON.stringify({
        at: "2026-06-01T10:00:00.000Z",
        appVersion: "1.0.5",
        shopId: "shop-abc",
        pendingSyncQueue: 4,
        pendingSyncBreakdown: { sales: 2, stock: 2 },
      }),
    );
    expect(parsed?.kind).toBe("pilot");
    expect(parsed?.valid).toBe(true);
    expect(parsed?.pendingQueueTotal).toBe(4);
    expect(parsed?.shopId).toBe("shop-abc");
  });

  it("detects cloud trust certification JSON", () => {
    const parsed = normalizeRescueDiagnostics({
      checkedAt: "2026-06-01T10:00:00.000Z",
      certified: true,
      bootstrapComplete: true,
      recoveryInvariantPassed: true,
      inventoryIntegrityOk: true,
      inventoryIntegrityStatus: "ok",
      stockMovementCount: 12,
      failures: [],
      rows: [],
      financial: {
        revenueUgx: 50000,
        profitUgx: 12000,
        inventoryValueUgx: 8000,
        totalCustomerDebtUgx: 3000,
        totalSupplierBalanceUgx: 1000,
        expectedCashTodayUgx: 4000,
      },
    });
    expect(parsed.kind).toBe("cloud_trust");
    expect(parsed.cloudTrust?.certified).toBe(true);
    expect(parsed.cloudTrust?.financial?.revenueUgx).toBe(50000);
  });

  it("detects production certification export", () => {
    const parsed = normalizeRescueDiagnostics({
      verdict: "PASS",
      certified: true,
      bootstrapComplete: true,
      recoveryInvariantPassed: true,
      inventoryIntegrityOk: true,
      inventoryIntegrityStatus: "ok",
      failures: [],
      rows: [],
      financial: { revenueUgx: 1, profitUgx: 1, inventoryValueUgx: 1, totalCustomerDebtUgx: 0 },
      pendingSync: { totalPending: 7, queueTotal: 7, unsyncedSalesFlag: 1, totalEntityPending: 3 },
      recoveryDiagnostics: { status: "complete", lastRecoveryAt: "2026-06-01T09:00:00.000Z" },
    });
    expect(parsed.kind).toBe("production_certification");
    expect(parsed.syncHealth?.pendingOutbound).toBe(7);
    expect(parsed.cloudRecovery?.status).toBe("complete");
  });

  it("labels diagnostic kinds for support UI", () => {
    expect(rescueDiagnosticsKindLabel("startup")).toBe("Startup Diagnostics");
    expect(rescueDiagnosticsKindLabel("sync_health")).toBe("Sync Health export");
  });
});

describe("rescueConsoleIntel", () => {
  const detail = PREVIEW_SHOP_OPS_DETAIL as ShopOpsDetail;

  it("builds health summary from shop detail", () => {
    const { summary, health } = buildRescueHealthSummary(detail, null);
    expect(health.score).toBeGreaterThan(0);
    expect(summary.currentPlan).toBeTruthy();
    expect(summary.activeDevices).toBeGreaterThanOrEqual(0);
  });

  it("computes financial snapshot from imported diagnostics", () => {
    const diagnostics = normalizeRescueDiagnostics({
      certified: true,
      bootstrapComplete: true,
      recoveryInvariantPassed: true,
      inventoryIntegrityOk: true,
      inventoryIntegrityStatus: "ok",
      failures: [],
      rows: [],
      financial: {
        revenueUgx: 90000,
        profitUgx: 20000,
        inventoryValueUgx: 5000,
        totalCustomerDebtUgx: 1500,
        totalSupplierBalanceUgx: 800,
        expectedCashTodayUgx: 3000,
      },
    });
    const fin = buildRescueFinancialSnapshot(detail, diagnostics, null);
    expect(fin.source).toBe("imported_diagnostics");
    expect(fin.revenueUgx).toBe(90000);
    expect(fin.customerDebtUgx).toBe(1500);
  });

  it("computes cloud backup financial totals", () => {
    const fin = computeCloudBackupFinancial({
      snapshot: {
        sales: [{ status: "completed", totalUgx: 10000 }, { status: "pending", totalUgx: 5000 }],
        cashExpenses: [{ amountUgx: 2000 }],
        customers: [{ outstandingDebtUgx: 1500 }],
        suppliers: [{ balanceOwedUgx: 700 }],
      },
    });
    expect(fin?.revenueUgx).toBe(10000);
    expect(fin?.expensesUgx).toBe(2000);
    expect(fin?.customerDebtUgx).toBe(1500);
    expect(fin?.supplierBalanceUgx).toBe(700);
  });

  it("filters audit timeline events", () => {
    const events = mapOpsAuditToRescueEvents(
      [
        {
          id: "1",
          actor: "admin-1",
          action: "rescue_retry_sync",
          target_shop_id: detail.shop.id,
          target_org_id: null,
          payload: { result: "ok" },
          created_at: "2026-06-01T12:00:00.000Z",
        },
        {
          id: "2",
          actor: "admin-1",
          action: "admin_password_reset_email_failed",
          target_shop_id: detail.shop.id,
          target_org_id: null,
          payload: { ok: false },
          created_at: "2026-06-02T12:00:00.000Z",
        },
      ],
      new Map([["admin-1", "support@waka.ug"]]),
    );
    const filtered = filterRescueAuditEvents(events, {
      query: "retry",
      dateFrom: "",
      dateTo: "",
      user: "all",
      category: "all",
      severity: "all",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.action).toBe("rescue_retry_sync");
  });

  it("derives inventory integrity from diagnostics mismatches", () => {
    const diagnostics = normalizeRescueDiagnostics({
      certified: false,
      bootstrapComplete: true,
      recoveryInvariantPassed: true,
      inventoryIntegrityOk: false,
      inventoryIntegrityStatus: "mismatch",
      inventoryMismatches: [
        { productId: "p1", productName: "Sugar", recorded: 5, expected: 8, difference: -3 },
      ],
      failures: [],
      rows: [],
      financial: { revenueUgx: 0, profitUgx: 0, inventoryValueUgx: 0, totalCustomerDebtUgx: 0 },
    });
    const inv = inventoryIntegrityFromSources(detail, diagnostics);
    expect(inv.mismatchCount).toBe(1);
    expect(inv.mismatches[0]?.product).toBe("Sugar");
  });
});

describe("rescue console routing", () => {
  it("rescue href includes shop id path", async () => {
    const { internalAdminShopRescueHref } = await import("./internalAdminPreview");
    expect(internalAdminShopRescueHref("abc-123", false)).toBe("/internal/waka/shop/abc-123/rescue");
    expect(internalAdminShopRescueHref("abc-123", true)).toContain("preview=1");
  });
});
