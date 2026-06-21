import { describe, expect, it } from "vitest";
import {
  assessStressScenarios,
  CERTIFICATION_TEST_DATASET,
  fingerprintsMatch,
  LARGE_SHOP_STRESS_TARGETS,
} from "./productionCertification";

describe("productionCertification", () => {
  it("predicts PASS for standard certification test dataset sizes", () => {
    const scenarios = assessStressScenarios({
      counts: { ...CERTIFICATION_TEST_DATASET, inventoryCounts: 3, cashAdjustments: 2, dayOpens: 2, stockMovements: 50, auditLogs: 200 },
      snapshotBytes: 2_000_000,
      salesPullTruncated: false,
      largeShopMode: true,
    });
    expect(scenarios.every((s) => s.predictedVerdict === "pass")).toBe(true);
  });

  it("predicts PASS for large-shop stress targets when pull is complete", () => {
    const scenarios = assessStressScenarios({
      counts: {
        ...CERTIFICATION_TEST_DATASET,
        sales: LARGE_SHOP_STRESS_TARGETS.sales,
        customers: LARGE_SHOP_STRESS_TARGETS.customers,
        products: LARGE_SHOP_STRESS_TARGETS.products,
        auditLogs: LARGE_SHOP_STRESS_TARGETS.auditLogs,
      },
      snapshotBytes: 12_000_000,
      salesPullTruncated: false,
      largeShopMode: true,
    });
    expect(scenarios.every((s) => s.predictedVerdict === "pass")).toBe(true);
  });

  it("predicts FAIL when sales pull was truncated", () => {
    const scenarios = assessStressScenarios({
      counts: CERTIFICATION_TEST_DATASET,
      salesPullTruncated: true,
      largeShopMode: true,
    });
    const automated = scenarios.filter((s) => s.id !== "snapshot_8mb");
    expect(automated.every((s) => s.predictedVerdict === "fail")).toBe(true);
  });

  it("compares operational fingerprints by hash", () => {
    const fp = {
      counts: CERTIFICATION_TEST_DATASET,
      financial: {
        revenueUgx: 1,
        profitUgx: 1,
        inventoryValueUgx: 1,
        totalStockQuantity: 1,
        totalCustomerDebtUgx: 0,
        expectedCashTodayUgx: 0,
        totalSupplierBalanceUgx: 0,
      },
      stockByProductId: { p1: 5 },
      staffSignature: "a:Alice:owner:1",
      hash: "fp_abc",
    };
    expect(fingerprintsMatch(fp, { ...fp })).toBe(true);
    expect(fingerprintsMatch(fp, { ...fp, hash: "fp_other" })).toBe(false);
  });
});
