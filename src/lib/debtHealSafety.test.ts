import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as syncCheckpoints from "./syncCheckpoints";
import { canSafelyHealCustomerDebt, evaluateDebtSyncHydration } from "./debtSyncState";

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
}));

const emptyCheckpoints: syncCheckpoints.SyncCheckpoints = {
  bootstrapComplete: false,
  lastSalesSyncAt: null,
  lastProductsSyncAt: null,
  lastCustomersSyncAt: null,
  lastDebtsSyncAt: null,
  lastDebtPaymentsSyncAt: null,
  lastExpensesSyncAt: null,
  lastReturnsSyncAt: null,
  lastPurchasesSyncAt: null,
  lastSuppliersSyncAt: null,
  lastSupplierPaymentsSyncAt: null,
};

describe("debtHealSafety", () => {
  beforeEach(() => {
    vi.spyOn(syncCheckpoints, "readSyncCheckpoints");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("blocks heal when bootstrap sync incomplete", () => {
    vi.mocked(syncCheckpoints.readSyncCheckpoints).mockReturnValue(emptyCheckpoints);
    const safety = canSafelyHealCustomerDebt();
    expect(safety.ok).toBe(false);
    if (!safety.ok) expect(safety.reasonKey).toBe("debtHealSyncIncomplete");
  });

  it("blocks heal when debt payments never pulled", () => {
    vi.mocked(syncCheckpoints.readSyncCheckpoints).mockReturnValue({
      ...emptyCheckpoints,
      bootstrapComplete: true,
      lastSalesSyncAt: "2026-06-11T00:00:00.000Z",
      lastCustomersSyncAt: "2026-06-11T00:00:00.000Z",
      lastDebtPaymentsSyncAt: null,
    });
    const safety = canSafelyHealCustomerDebt();
    expect(safety.ok).toBe(false);
    if (!safety.ok) expect(safety.reasonKey).toBe("debtHealPaymentsIncomplete");
  });

  it("allows heal when cloud history hydrated", () => {
    vi.mocked(syncCheckpoints.readSyncCheckpoints).mockReturnValue({
      ...emptyCheckpoints,
      bootstrapComplete: true,
      lastSalesSyncAt: "2026-06-11T00:00:00.000Z",
      lastCustomersSyncAt: "2026-06-11T00:00:00.000Z",
      lastDebtPaymentsSyncAt: "2026-06-11T00:00:00.000Z",
    });
    expect(canSafelyHealCustomerDebt()).toEqual({ ok: true });
    const hydration = evaluateDebtSyncHydration();
    expect(hydration.paymentsHydrated).toBe(true);
    expect(hydration.salesHydrated).toBe(true);
    expect(hydration.customersHydrated).toBe(true);
  });
});

describe("debtHealSafety local mode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows heal without cloud checkpoints when supabase disabled", async () => {
    vi.resetModules();
    vi.doMock("./supabase", () => ({ hasSupabaseConfig: false }));
    const { canSafelyHealCustomerDebt: localHeal } = await import("./debtSyncState");
    expect(localHeal()).toEqual({ ok: true });
  });
});
