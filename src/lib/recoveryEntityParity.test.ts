import { describe, expect, it, beforeEach } from "vitest";
import { validateRecoveryCompletionGate } from "./cloudRecoveryGate";
import type { CloudRecoveryValidationResult } from "./cloudRecoveryValidator";
import { buildCloudTrustCertificationReport } from "./cloudTrustCenter";
import {
  entityCountMismatchBlocksRecovery,
  isBlockingRecoveryCertificationFailure,
} from "./recoveryEntityParity";
import { usePosStore } from "../store/usePosStore";
import type { Product, Sale } from "../types";

function baseValidation(): CloudRecoveryValidationResult {
  return {
    checkedAt: new Date().toISOString(),
    ok: true,
    failures: [],
    counts: {
      products: 1,
      sales: 2,
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
      auditLogs: 8,
    },
    financial: { revenueUgx: 0, profitUgx: 0 },
    inventoryValueUgx: 0,
    debtMismatches: 0,
    recoveryScorePct: 100,
    inventoryIntegrityStatus: "healthy",
    inventoryMismatches: [],
  };
}

describe("recoveryEntityParity", () => {
  beforeEach(() => {
    usePosStore.setState({
      products: [{ id: "p1", name: "Item", stockOnHand: 8, sellingMode: "unit", baseUnit: "ea", sellingPricePerUnitUgx: 1000, costPricePerUnitUgx: 500, minimumStockAlert: 1, category: "G", sku: "", updatedAt: "2026-06-01T00:00:00.000Z", version: 1 } as Product],
      sales: [{ id: "s1", status: "completed", lines: [], createdAt: "2026-06-02T08:00:00.000Z", updatedAt: "2026-06-02T08:00:00.000Z", subtotalUgx: 0, totalUgx: 0, cashPaidUgx: 0, debtUgx: 0, estimatedProfitUgx: 0, pendingSync: false } as Sale],
      customers: [],
    });
  });

  it("blocks only products, sales, and customers count mismatches", () => {
    expect(entityCountMismatchBlocksRecovery("products")).toBe(true);
    expect(entityCountMismatchBlocksRecovery("sales")).toBe(true);
    expect(entityCountMismatchBlocksRecovery("customers")).toBe(true);
    expect(entityCountMismatchBlocksRecovery("auditLogs")).toBe(false);
    expect(entityCountMismatchBlocksRecovery("stockMovements")).toBe(false);
  });

  it("treats audit log parity drift as non-blocking certification failure", () => {
    expect(isBlockingRecoveryCertificationFailure("entity_count_mismatch_auditLogs")).toBe(false);
    expect(isBlockingRecoveryCertificationFailure("entity_count_mismatch_products")).toBe(true);
  });

  it("gate passes when only auditLogs counts differ", () => {
    const certification = buildCloudTrustCertificationReport({
      cloud: {
        products: 1,
        customers: 0,
        sales: 2,
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
        auditLogs: 15,
      },
      local: {
        products: 1,
        customers: 0,
        sales: 2,
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
        auditLogs: 8,
      },
      requireCloudParity: true,
    });

    const gate = validateRecoveryCompletionGate(
      {
        hasCloudProducts: true,
        hasSnapshot: false,
        snapshotUpdatedAt: null,
        snapshotRowFound: false,
        snapshotContainsCoreData: false,
      },
      baseValidation(),
      { certification },
    );

    expect(gate.ok).toBe(true);
    expect(gate.warnings).toContain("entity_count_mismatch_auditLogs");
  });
});
