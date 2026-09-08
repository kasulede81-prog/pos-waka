import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearBootstrapSyncComplete,
  markBootstrapSyncComplete,
  markProductCostAuthorityRefreshDone,
  needsBootstrapPull,
  needsProductCostAuthorityRefresh,
  readSyncCheckpoints,
  writeSyncCheckpoints,
} from "./syncCheckpoints";

vi.mock("../offline/accountScope", () => ({
  getActiveAccountKey: () => "sb:test-user",
}));

describe("syncCheckpoints bootstrap rollback", () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem(key: string) {
        return store[key] ?? null;
      },
      setItem(key: string, value: string) {
        store[key] = value;
      },
      removeItem(key: string) {
        delete store[key];
      },
      clear() {
        for (const key of Object.keys(store)) delete store[key];
      },
    });
    localStorage.clear();
  });

  it("clearBootstrapSyncComplete rolls back bootstrap flag", () => {
    markBootstrapSyncComplete("2026-06-01T00:00:00.000Z");
    expect(readSyncCheckpoints().bootstrapComplete).toBe(true);

    clearBootstrapSyncComplete();
    const cp = readSyncCheckpoints();
    expect(cp.bootstrapComplete).toBe(false);
    expect(cp.lastSalesSyncAt).toBe("2026-06-01T00:00:00.000Z");
  });

  it("writeSyncCheckpoints preserves other cursors when clearing bootstrap", () => {
    writeSyncCheckpoints({ lastProductsSyncAt: "2026-05-01T00:00:00.000Z", bootstrapComplete: true });
    clearBootstrapSyncComplete();
    expect(readSyncCheckpoints().lastProductsSyncAt).toBe("2026-05-01T00:00:00.000Z");
  });

  it("product cost authority refresh is one-shot per namespace", () => {
    expect(needsProductCostAuthorityRefresh()).toBe(true);
    markProductCostAuthorityRefreshDone();
    expect(needsProductCostAuthorityRefresh()).toBe(false);
  });

  it("empty local state still requires a full bootstrap pull", () => {
    expect(needsBootstrapPull(true)).toBe(true);
  });

  it("existing synchronized state uses incremental pull", () => {
    markBootstrapSyncComplete("2026-08-13T00:00:00.000Z");
    expect(needsBootstrapPull(false)).toBe(false);
  });

  it("WAKA-05 — every bootstrap cursor is the supplied server timestamp, not the client clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-01-01T00:00:00.000Z"));
    const serverAt = "2026-07-10T12:00:00.000Z";
    const cp = markBootstrapSyncComplete(serverAt);
    const cursors = [
      cp.lastSalesSyncAt,
      cp.lastProductsSyncAt,
      cp.lastCustomersSyncAt,
      cp.lastDebtsSyncAt,
      cp.lastDebtPaymentsSyncAt,
      cp.lastExpensesSyncAt,
      cp.lastReturnsSyncAt,
      cp.lastPurchasesSyncAt,
      cp.lastSuppliersSyncAt,
      cp.lastSupplierPaymentsSyncAt,
      cp.lastCashDrawerAdjustmentsSyncAt,
      cp.lastDayDrawerOpensSyncAt,
      cp.lastInventoryCountSessionsSyncAt,
      cp.lastShiftsSyncAt,
      cp.lastDayClosesSyncAt,
      cp.lastStockMovementsSyncAt,
      cp.lastCatalogSyncAt,
      cp.lastShopPolicySyncAt,
      cp.lastAuditLogsSyncAt,
    ];
    expect(new Set(cursors)).toEqual(new Set([serverAt]));
    expect(cursors).not.toContain(new Date().toISOString());
    vi.useRealTimers();
  });

  it("WAKA-05 — refuses to seed cursors from a non-timestamp", () => {
    const before = readSyncCheckpoints();
    const after = markBootstrapSyncComplete("not-a-timestamp");
    expect(after).toEqual(before);
    expect(after.bootstrapComplete).toBe(false);
  });
});
