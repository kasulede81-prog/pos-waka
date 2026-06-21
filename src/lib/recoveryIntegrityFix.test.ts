import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PersistedSnapshot } from "../offline/localDb";
import { snapshotContainsCoreData } from "./cloudSnapshotSync";
import {
  beginCloudRecoverySession,
  getCloudRecoverySession,
  resetCloudRecoverySessionForRetry,
} from "./cloudRecoverySession";
import { validateRecoveryCompletionGate } from "./cloudRecoveryGate";
import type { CloudRecoveryValidationResult } from "./cloudRecoveryValidator";
import {
  MERGE_PRODUCED_EMPTY_STORE_ERROR,
  RECOVERY_EMPTY_STORE_ERROR,
  verifyRecoveryHydration,
} from "./recoveryHydration";
import { usePosStore } from "../store/usePosStore";

const mockRestoreShopFromCloudSnapshot = vi.fn();
const mockPullCloudAndMergeIntoStore = vi.fn();
const mockProbeCloudShopHasData = vi.fn();
const mockIsLocalShopDataEmpty = vi.fn();
const mockNeedsCloudRecoveryBootstrap = vi.fn();
const mockEnsureRecoverySessionActor = vi.fn();
const mockEvaluateCloudRecoveryLock = vi.fn();

vi.mock("./cloudSnapshotSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cloudSnapshotSync")>();
  return {
    ...actual,
    isLocalShopDataEmpty: () => mockIsLocalShopDataEmpty(),
    restoreShopFromCloudSnapshot: (...args: unknown[]) => mockRestoreShopFromCloudSnapshot(...args),
    probeCloudShopHasData: () => mockProbeCloudShopHasData(),
    uploadShopCloudSnapshot: vi.fn().mockResolvedValue(true),
  };
});

vi.mock("../offline/cloudSync", () => ({
  pullCloudAndMergeIntoStore: (...args: unknown[]) => mockPullCloudAndMergeIntoStore(...args),
  pushShopPendingToCloud: vi.fn().mockResolvedValue(undefined),
  syncShopWithCloud: vi.fn().mockResolvedValue(undefined),
  wasLastSalesPullTruncated: vi.fn().mockReturnValue(false),
}));

vi.mock("./recoverySystemActor", () => ({
  ensureRecoverySessionActor: () => mockEnsureRecoverySessionActor(),
}));

vi.mock("./cloudRecoveryGate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cloudRecoveryGate")>();
  return {
    ...actual,
    evaluateCloudRecoveryLock: () => mockEvaluateCloudRecoveryLock(),
  };
});

vi.mock("./syncCheckpoints", () => ({
  readSyncCheckpoints: vi.fn().mockReturnValue({ bootstrapComplete: true }),
  markBootstrapSyncComplete: vi.fn(),
  clearBootstrapSyncComplete: vi.fn(),
}));

vi.mock("./cloudAuthorityAudit", () => ({
  needsCloudRecoveryBootstrap: () => mockNeedsCloudRecoveryBootstrap(),
  buildCloudRecoverySnapshotFromStore: () => ({
    scorePct: 95,
    bootstrapComplete: true,
    recoveryReady: true,
  }),
}));

vi.mock("./globalSyncMutex", () => ({
  withGlobalSyncMutex: (_label: string, fn: () => Promise<void>) => fn(),
}));

vi.mock("./shopRecoverySignals", () => ({
  applyShopRecoverySignalsForCurrentShop: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./monitoring", () => ({
  reportSyncIssue: vi.fn(),
}));

vi.mock("./crashReporting", () => ({
  captureAppException: vi.fn(),
}));

vi.mock("./staffRecovery", () => ({
  pullAndMergeStaffAccountsForRecovery: vi.fn().mockResolvedValue(0),
}));

vi.mock("./cloudTrustCenter", () => ({
  fetchCloudEntityCounts: vi.fn().mockResolvedValue({
    counts: {
      products: 1,
      customers: 0,
      sales: 0,
      returns: 0,
      debtPayments: 0,
      expenses: 0,
      suppliers: 0,
      purchases: 0,
      supplierPayments: 0,
      cashAdjustments: 0,
      dayOpens: 0,
      shifts: 0,
      dayCloses: 0,
      inventoryCounts: 0,
      stockMovements: 0,
      staff: 0,
      auditLogs: 0,
    },
    errors: {},
  }),
  buildCloudTrustCertificationReport: vi.fn().mockReturnValue({
    certified: true,
    checkedAt: new Date().toISOString(),
    failures: [],
    rows: [],
    financial: {
      revenueUgx: 0,
      profitUgx: 0,
      inventoryValueUgx: 0,
      totalStockQuantity: 0,
      totalCustomerDebtUgx: 0,
    },
    bootstrapComplete: false,
    recoveryInvariantPassed: true,
    inventoryIntegrityOk: true,
    stockMovementCount: 0,
  }),
  readLocalEntityCounts: vi.fn().mockReturnValue({
    products: 1,
    customers: 0,
    sales: 0,
    returns: 0,
    debtPayments: 0,
    expenses: 0,
    suppliers: 0,
    purchases: 0,
    supplierPayments: 0,
    cashAdjustments: 0,
    dayOpens: 0,
    shifts: 0,
    dayCloses: 0,
    inventoryCounts: 0,
    stockMovements: 0,
    staff: 0,
    auditLogs: 0,
  }),
}));

vi.mock("./cloudRecoveryCompleteness", () => ({
  buildRecoveryCompletenessReport: vi.fn().mockReturnValue({ scorePct: 95, categories: [] }),
}));

vi.mock("./cloudRecoveryValidator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cloudRecoveryValidator")>();
  return {
    ...actual,
    buildCloudRecoverySimulationReport: () => {
      const s = usePosStore.getState();
      const shifts = s.preferences.shifts ?? [];
      return {
        checkedAt: new Date().toISOString(),
        ok: true,
        failures: [],
        counts: {
          products: s.products.length,
          sales: s.sales.length,
          customers: s.customers.length,
          suppliers: s.suppliers.length,
          purchases: s.purchases.length,
          shifts: shifts.length,
          dayCloses: s.dayCloses.length,
          returns: s.returnRecords.length,
          debtPayments: s.debtPayments.length,
          expenses: s.cashExpenses.length,
          supplierPayments: s.supplierPayments.length,
          cashAdjustments: s.cashDrawerAdjustments.length,
          dayOpens: s.dayDrawerOpens.length,
          inventoryCounts: s.inventoryCountSessions.length,
          stockMovements: s.stockMovements.length,
          staff: (s.preferences.staffAccounts ?? []).length,
          auditLogs: s.auditLogs.length + s.archivedAuditLogs.length,
        },
        financial: { revenueUgx: 0, profitUgx: 0 },
        inventoryValueUgx: 0,
        debtMismatches: 0,
        recoveryScorePct: 95,
      };
    },
    recordCloudRecoveryValidation: vi.fn(),
  };
});

vi.mock("./organizationDeletionState", () => ({
  refreshOrganizationDeletionState: vi.fn().mockResolvedValue(undefined),
  isOrganizationBlocked: vi.fn().mockReturnValue(false),
  assertOrganizationOperationsAllowed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./businessProfile", () => ({
  hydrateLocalShopProfileFromCloud: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-1" } } } }),
    },
  },
}));

vi.mock("../offline/accountScope", () => ({
  getActiveAccountKey: vi.fn().mockReturnValue("sb:user-1"),
}));

vi.mock("./startupDiagnostics", () => ({
  recordStartupRecoveryFailure: vi.fn(),
}));

vi.mock("./deviceOnline", () => ({
  getDeviceOnline: vi.fn().mockReturnValue(true),
}));

function emptySnapshot(): PersistedSnapshot {
  return {
    products: [],
    customers: [],
    sales: [],
    preferences: {} as never,
    debtPayments: [],
    dayCloses: [],
    auditLogs: [],
    suppliers: [],
    purchases: [],
    supplierPayments: [],
    stockMovements: [],
    voidRecords: [],
    returnRecords: [],
    cashExpenses: [],
    cashDrawerAdjustments: [],
    dayDrawerOpens: [],
    inventoryCountSessions: [],
    archivedSales: [],
    archivedAuditLogs: [],
    archivedDayCloses: [],
    archivedVoidRecords: [],
    archivedReturnRecords: [],
    updatedAt: new Date().toISOString(),
  };
}

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
    ...overrides,
  };
}

describe("recovery integrity fix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCloudRecoverySessionForRetry();
    usePosStore.setState({
      _hydrated: true,
      products: [],
      sales: [],
      customers: [],
      preferences: { shifts: [] } as never,
      cashDrawerAdjustments: [],
      dayDrawerOpens: [],
      cashExpenses: [],
      inventoryCountSessions: [],
      dayCloses: [],
    });
    mockIsLocalShopDataEmpty.mockReturnValue(true);
    mockNeedsCloudRecoveryBootstrap.mockReturnValue(true);
    mockEnsureRecoverySessionActor.mockResolvedValue({ ok: true, actor: { role: "owner" } });
    mockEvaluateCloudRecoveryLock.mockResolvedValue({
      lockRequired: true,
      localEmpty: true,
      probeResult: {
        status: "success",
        probe: {
          hasSnapshot: false,
          snapshotUpdatedAt: null,
          hasCloudProducts: true,
          snapshotRowFound: true,
          snapshotContainsCoreData: false,
        },
      },
    });
  });

  describe("snapshotContainsCoreData", () => {
    it("returns false for empty snapshot envelope", () => {
      expect(snapshotContainsCoreData(emptySnapshot())).toBe(false);
    });

    it("returns true when products exist in snapshot", () => {
      const snap = emptySnapshot();
      snap.products = [{ id: "p1" } as never];
      expect(snapshotContainsCoreData(snap)).toBe(true);
    });
  });

  describe("A. empty snapshot row + cloud products", () => {
    it("rejects empty snapshot restore, runs full pull, and passes gate when products hydrate", async () => {
      mockRestoreShopFromCloudSnapshot.mockResolvedValue(false);
      mockPullCloudAndMergeIntoStore.mockImplementation(async () => {
        usePosStore.setState({
          products: [{ id: "p1", name: "Rice" } as never],
          sales: [],
          customers: [],
        });
        return true;
      });

      const { runCloudRecoveryGated } = await import("./postAuthCloudHydrate");
      beginCloudRecoverySession();
      const result = await runCloudRecoveryGated({ forcePull: true });

      expect(mockRestoreShopFromCloudSnapshot).toHaveBeenCalled();
      expect(mockPullCloudAndMergeIntoStore).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(usePosStore.getState().products.length).toBe(1);

      const session = getCloudRecoverySession();
      expect(session.integrityDiagnostics.fullPullAttempted).toBe(true);
      expect(session.integrityDiagnostics.recoveryInvariantPassed).toBe(true);
    });
  });

  describe("B. snapshot returns true but store remains empty", () => {
    it("does not complete recovery early and runs full pull", async () => {
      mockRestoreShopFromCloudSnapshot.mockResolvedValue(true);
      mockPullCloudAndMergeIntoStore.mockImplementation(async () => {
        usePosStore.setState({
          products: [{ id: "p1" } as never],
          sales: [],
          customers: [],
        });
        return true;
      });

      const { runCloudRecoveryGated } = await import("./postAuthCloudHydrate");
      const result = await runCloudRecoveryGated({ forcePull: true });

      expect(mockPullCloudAndMergeIntoStore).toHaveBeenCalled();
      expect(result.success).toBe(true);
      const session = getCloudRecoverySession();
      expect(session.lastCompletedStep).toBe("validation");
      expect(session.integrityDiagnostics.snapshotRestoreProducedData).toBe(false);
      expect(session.integrityDiagnostics.fullPullAttempted).toBe(true);
    });
  });

  describe("C. pull completes with empty store", () => {
    it("throws RECOVERY_COMPLETED_WITH_EMPTY_STORE during gated recovery", async () => {
      mockRestoreShopFromCloudSnapshot.mockResolvedValue(false);
      mockPullCloudAndMergeIntoStore.mockImplementation(async () => {
        usePosStore.setState({ products: [], sales: [], customers: [] });
        throw new Error(MERGE_PRODUCED_EMPTY_STORE_ERROR);
      });

      const { runCloudRecoveryGated } = await import("./postAuthCloudHydrate");
      const result = await runCloudRecoveryGated({ forcePull: true });

      expect(result.success).toBe(false);
      expect(result.errorKey).toBe(MERGE_PRODUCED_EMPTY_STORE_ERROR);

      const gate = validateRecoveryCompletionGate(
        {
          hasCloudProducts: true,
          hasSnapshot: false,
          snapshotUpdatedAt: null,
          snapshotRowFound: false,
          snapshotContainsCoreData: false,
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
      expect(gate.failures).toContain("shop_still_empty");
    });
  });

  describe("D. successful recovery", () => {
    it("sets bootstrap invariant, clears lock, and passes gate", async () => {
      mockRestoreShopFromCloudSnapshot.mockResolvedValue(false);
      mockPullCloudAndMergeIntoStore.mockImplementation(async () => {
        usePosStore.setState({
          products: [{ id: "p1" } as never],
          sales: [{ id: "s1" } as never],
          customers: [{ id: "c1" } as never],
        });
        return true;
      });

      const { runCloudRecoveryGated } = await import("./postAuthCloudHydrate");
      const { markBootstrapSyncComplete } = await import("./syncCheckpoints");
      const result = await runCloudRecoveryGated({ forcePull: true });

      expect(result.success).toBe(true);
      expect(markBootstrapSyncComplete).toHaveBeenCalled();
      expect(getCloudRecoverySession().status).toBe("complete");
      expect(verifyRecoveryHydration().hydrated).toBe(true);

      const gate = validateRecoveryCompletionGate(
        {
          hasCloudProducts: true,
          hasSnapshot: false,
          snapshotUpdatedAt: null,
          snapshotRowFound: false,
          snapshotContainsCoreData: false,
        },
        baseValidation(),
      );
      expect(gate.ok).toBe(true);
    });
  });

  describe("verifyRecoveryHydration invariant", () => {
    it("reports empty store when no core entities exist", () => {
      expect(RECOVERY_EMPTY_STORE_ERROR).toBe("RECOVERY_COMPLETED_WITH_EMPTY_STORE");
      expect(verifyRecoveryHydration().hydrated).toBe(false);
    });
  });
});
