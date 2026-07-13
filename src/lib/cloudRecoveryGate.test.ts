import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  evaluateCloudRecoveryLock,
  shouldRequireRecoveryLock,
  validateCoreOperationalGate,
  validateRecoveryCompletionGate,
} from "./cloudRecoveryGate";
import type { CloudRecoveryValidationResult } from "./cloudRecoveryValidator";

const mockIsLocalShopDataEmpty = vi.fn();
const mockNeedsCloudRecoveryBootstrap = vi.fn();
const mockProbeCloudShopHasData = vi.fn();
const mockResolvePrimaryOrganizationForUser = vi.fn();
const mockGetActiveAccountKey = vi.fn();
const mockGetSession = vi.fn();

vi.mock("./syncCheckpoints", () => ({
  readSyncCheckpoints: () => ({ bootstrapComplete: true }),
}));

vi.mock("../offline/accountScope", () => ({
  getActiveAccountKey: () => mockGetActiveAccountKey(),
}));

vi.mock("./cloudAuthorityAudit", () => ({
  needsCloudRecoveryBootstrap: () => mockNeedsCloudRecoveryBootstrap(),
}));

vi.mock("./cloudSnapshotSync", () => ({
  isLocalShopDataEmpty: () => mockIsLocalShopDataEmpty(),
  probeCloudShopHasData: () => mockProbeCloudShopHasData(),
}));

vi.mock("./fetchShopSubscription", () => ({
  resolvePrimaryOrganizationForUser: (userId: string) => mockResolvePrimaryOrganizationForUser(userId),
}));

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
    },
  },
}));

function baseValidation(overrides: Partial<CloudRecoveryValidationResult> = {}): CloudRecoveryValidationResult {
  return {
    checkedAt: new Date().toISOString(),
    ok: true,
    failures: [],
    counts: {
      products: 10,
      sales: 50,
      customers: 5,
      suppliers: 2,
      purchases: 3,
      shifts: 1,
      dayCloses: 1,
      returns: 0,
      debtPayments: 0,
      expenses: 0,
      supplierPayments: 0,
      cashAdjustments: 0,
      dayOpens: 0,
      inventoryCounts: 0,
      stockMovements: 0,
      staff: 0,
      auditLogs: 0,
    },
    financial: { revenueUgx: 0, profitUgx: 0 },
    inventoryValueUgx: 0,
    debtMismatches: 0,
    recoveryScorePct: 95,
    inventoryIntegrityStatus: "healthy",
    inventoryMismatches: [],
    ...overrides,
  };
}

function setupRecoveryEligibleLocalEmpty(): void {
  mockGetActiveAccountKey.mockReturnValue("sb:user-1");
  mockIsLocalShopDataEmpty.mockReturnValue(true);
  mockNeedsCloudRecoveryBootstrap.mockReturnValue(true);
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
  mockResolvePrimaryOrganizationForUser.mockResolvedValue({ shopId: "shop-1", role: "owner" });
}

describe("cloudRecoveryGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupRecoveryEligibleLocalEmpty();
  });

  describe("validateRecoveryCompletionGate", () => {
    it("passes when cloud had products and local restored", () => {
      const result = validateRecoveryCompletionGate(
        {
          hasCloudProducts: true,
          hasSnapshot: false,
          snapshotUpdatedAt: null,
          snapshotRowFound: false,
          snapshotContainsCoreData: false,
        },
        baseValidation(),
      );
      expect(result.ok).toBe(true);
    });

    it("fails when cloud had products but local is empty", () => {
      const result = validateRecoveryCompletionGate(
        {
          hasCloudProducts: true,
          hasSnapshot: true,
          snapshotUpdatedAt: null,
          snapshotRowFound: true,
          snapshotContainsCoreData: true,
        },
        baseValidation({
          counts: {
            products: 0,
            sales: 0,
            customers: 0,
            suppliers: 0,
            purchases: 0,
            shifts: 0,
            dayCloses: 0,
            returns: 0,
            debtPayments: 0,
            expenses: 0,
            supplierPayments: 0,
            cashAdjustments: 0,
            dayOpens: 0,
            inventoryCounts: 0,
            stockMovements: 0,
            staff: 0,
            auditLogs: 0,
          },
        }),
      );
      expect(result.ok).toBe(false);
      expect(result.failures).toContain("shop_still_empty");
    });
  });

  describe("shouldRequireRecoveryLock — fail closed", () => {
    it("Scenario A: empty local + probe throws → lock remains required", async () => {
      mockProbeCloudShopHasData.mockRejectedValue(new Error("network error"));

      const evaluation = await evaluateCloudRecoveryLock();
      expect(evaluation.lockRequired).toBe(true);
      expect(evaluation.probeResult?.status).toBe("failed");

      await expect(shouldRequireRecoveryLock()).resolves.toBe(true);
    });

    it("Scenario B: empty local + probe timeout → lock remains required", async () => {
      mockProbeCloudShopHasData.mockRejectedValue(new Error("Probe timeout"));

      const evaluation = await evaluateCloudRecoveryLock();
      expect(evaluation.lockRequired).toBe(true);
      expect(evaluation.probeResult?.status).toBe("failed");
      expect(evaluation.probeResult?.status === "failed" ? evaluation.probeResult.error : "").toContain("timeout");
    });

    it("Scenario C: empty local + probe returns hasCloudProducts=true → lock required", async () => {
      mockProbeCloudShopHasData.mockResolvedValue({
        hasSnapshot: false,
        snapshotUpdatedAt: null,
        hasCloudProducts: true,
        snapshotRowFound: true,
        snapshotContainsCoreData: false,
      });

      const evaluation = await evaluateCloudRecoveryLock();
      expect(evaluation.lockRequired).toBe(true);
      expect(evaluation.probeResult?.status).toBe("success");
      await expect(shouldRequireRecoveryLock()).resolves.toBe(true);
    });

    it("Scenario D: empty local + probe confirms no cloud data → unlock allowed", async () => {
      mockProbeCloudShopHasData.mockResolvedValue({
        hasSnapshot: false,
        snapshotUpdatedAt: null,
        hasCloudProducts: false,
        snapshotRowFound: false,
        snapshotContainsCoreData: false,
      });

      const evaluation = await evaluateCloudRecoveryLock();
      expect(evaluation.lockRequired).toBe(false);
      expect(evaluation.probeResult?.status).toBe("success");
      await expect(shouldRequireRecoveryLock()).resolves.toBe(false);
    });

    it("does not require lock when local data exists and bootstrap is complete", async () => {
      mockIsLocalShopDataEmpty.mockReturnValue(false);
      mockNeedsCloudRecoveryBootstrap.mockReturnValue(false);

      await expect(shouldRequireRecoveryLock()).resolves.toBe(false);
      expect(mockProbeCloudShopHasData).not.toHaveBeenCalled();
    });
  });

  describe("validateCoreOperationalGate", () => {
    it("passes when products exist", () => {
      const gate = validateCoreOperationalGate(
        { hasCloudProducts: true, hasSnapshot: false, snapshotUpdatedAt: null, snapshotRowFound: false, snapshotContainsCoreData: false },
        baseValidation({ counts: { ...baseValidation().counts, products: 5 } }),
      );
      expect(gate.ok).toBe(true);
    });

    it("fails when cloud has products but local count is zero", () => {
      const gate = validateCoreOperationalGate(
        { hasCloudProducts: true, hasSnapshot: false, snapshotUpdatedAt: null, snapshotRowFound: false, snapshotContainsCoreData: false },
        baseValidation({ counts: { ...baseValidation().counts, products: 0 } }),
      );
      expect(gate.ok).toBe(false);
      expect(gate.failures).toContain("products_not_restored");
    });
  });
});
