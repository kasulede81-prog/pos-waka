import { describe, expect, it, vi } from "vitest";
import { buildRecoveryCompletenessReport } from "./cloudRecoveryCompleteness";

vi.mock("./cloudAuthorityAudit", () => ({
  buildCloudRecoverySnapshotFromStore: () => ({ scorePct: 95, bootstrapComplete: true }),
}));

describe("cloudRecoveryCompleteness", () => {
  it("scores high when all categories restored", () => {
    const report = buildRecoveryCompletenessReport({
      validation: {
        checkedAt: new Date().toISOString(),
        ok: true,
        failures: [],
        counts: {
          products: 10,
          sales: 100,
          customers: 5,
          suppliers: 1,
          purchases: 2,
          shifts: 1,
          dayCloses: 1,
        },
        financial: { revenueUgx: 0, profitUgx: 0 },
        inventoryValueUgx: 0,
        debtMismatches: 0,
        recoveryScorePct: 95,
      },
      probe: { hasSnapshot: true, snapshotUpdatedAt: null, hasCloudProducts: true },
      stockMovements: 50,
      inventoryCountSessions: 1,
      archivedSales: 0,
      salesPullTruncated: false,
    });
    expect(report.scorePct).toBeGreaterThanOrEqual(90);
    expect(report.categories.find((c) => c.id === "products")?.restored).toBe(true);
    expect(report.categories.find((c) => c.id === "historical")?.scorePct).toBeGreaterThanOrEqual(60);
  });
});
