import { beforeEach, describe, expect, it } from "vitest";
import type { Product, Sale, StockMovement } from "../types";
import { usePosStore } from "../store/usePosStore";
import {
  classifyInventoryIntegrityStatus,
  isSevereInventoryMismatch,
  reconcileRecoveryInventoryLedger,
} from "./recoveryInventoryReconciliation";
import { validateRecoveryCompletionGate } from "./cloudRecoveryGate";
import { validateCloudRecoveryLocalState } from "./cloudRecoveryValidator";
import { buildCloudTrustCertificationReport } from "./cloudTrustCenter";
import { setCachedShopId } from "./shopSyncContext";
import { verifyInventoryIntegrity, stableInventoryMovementId } from "./inventoryIntegrity";

const SHOP_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SALE_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SALE_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function product(stockOnHand: number): Product {
  return {
    id: PRODUCT_ID,
    name: "Test Item",
    sellingMode: "unit",
    baseUnit: "ea",
    sellingPricePerUnitUgx: 1000,
    costPricePerUnitUgx: 500,
    stockOnHand,
    minimumStockAlert: 1,
    category: "General",
    sku: "",
    updatedAt: "2026-06-01T08:00:00.000Z",
    version: 1,
  };
}

function sale(id: string, qty: number): Sale {
  return {
    id,
    status: "completed",
    createdAt: "2026-06-02T08:00:00.000Z",
    updatedAt: "2026-06-02T08:00:00.000Z",
    lines: [
      {
        productId: PRODUCT_ID,
        name: "Test Item",
        quantity: qty,
        unitPriceUgx: 1000,
        unitCostUgx: 500,
        lineTotalUgx: 1000 * qty,
        estimatedProfitUgx: 500 * qty,
        inputMode: "quantity",
        updatedAt: "2026-06-02T08:00:00.000Z",
      },
    ],
    subtotalUgx: 1000 * qty,
    totalUgx: 1000 * qty,
    cashPaidUgx: 1000 * qty,
    debtUgx: 0,
    estimatedProfitUgx: 500 * qty,
    pendingSync: false,
  };
}

describe("recoveryInventoryReconciliation", () => {
  beforeEach(() => {
    setCachedShopId(SHOP_ID);
    usePosStore.setState({
      products: [],
      sales: [],
      customers: [],
      stockMovements: [],
    });
  });

  it("heals 1 product / 2 sales / partial movement ledger (certification shop scenario)", () => {
    const products = [product(8)];
    const sales = [sale(SALE_A, 1), sale(SALE_B, 1)];
    const partialMovements: StockMovement[] = [
      {
        id: stableInventoryMovementId(SHOP_ID, "sale", SALE_A, PRODUCT_ID),
        at: "2026-06-02T08:00:00.000Z",
        productId: PRODUCT_ID,
        productName: "Test Item",
        deltaBaseUnits: -1,
        kind: "sale_out",
        summary: "Sale",
        refId: SALE_A,
        supplierId: null,
      },
    ];

    const before = verifyInventoryIntegrity({ products, movements: partialMovements });
    expect(before.ok).toBe(false);
    expect(before.mismatches).toHaveLength(1);

    const report = reconcileRecoveryInventoryLedger({
      products,
      sales,
      stockMovements: partialMovements,
      shopKey: SHOP_ID,
      applyToStore: false,
    });

    expect(report.syntheticSaleMovements).toBe(1);
    expect(report.syntheticOpeningMovements).toBe(1);
    expect(report.healed).toBe(true);
    expect(report.status).toBe("healthy");
    expect(report.remainingMismatches).toHaveLength(0);
  });

  it("classifies 1–2 mismatches as warning, 3+ as critical", () => {
    const mismatch = {
      productId: PRODUCT_ID,
      productName: "X",
      recordedStock: 8,
      expectedFromMovements: 9,
      delta: -1,
    };
    expect(classifyInventoryIntegrityStatus([mismatch])).toBe("warning");
    expect(classifyInventoryIntegrityStatus([mismatch, mismatch, mismatch])).toBe("critical");
  });

  it("treats negative stock as severe/critical", () => {
    const mismatch = {
      productId: PRODUCT_ID,
      productName: "X",
      recordedStock: -2,
      expectedFromMovements: 0,
      delta: -2,
    };
    expect(isSevereInventoryMismatch(mismatch)).toBe(true);
    expect(classifyInventoryIntegrityStatus([mismatch])).toBe("critical");
  });

  it("recovery gate passes with warning-level inventory mismatch", () => {
    const products = [product(8)];
    const sales = [sale(SALE_A, 1), sale(SALE_B, 1)];
    const movements: StockMovement[] = [
      {
        id: "m1",
        at: "2026-06-02T08:00:00.000Z",
        productId: PRODUCT_ID,
        productName: "Test Item",
        deltaBaseUnits: -1,
        kind: "sale_out",
        summary: "Sale",
        refId: SALE_A,
        supplierId: null,
      },
    ];

    const validation = validateCloudRecoveryLocalState(
      {
        products,
        customers: [],
        sales,
        debtPayments: [],
        stockMovements: movements,
        suppliers: [],
        purchases: [],
        supplierPayments: [],
        preferences: { shifts: [] } as never,
        returnRecords: [],
        dayClosesCount: 0,
      },
      { recoveryMode: true },
    );

    expect(validation.inventoryIntegrityStatus).toBe("warning");
    expect(validation.ok).toBe(true);

    usePosStore.setState({ products, sales, stockMovements: movements, customers: [], debtPayments: [] });

    const certification = buildCloudTrustCertificationReport({
      cloud: null,
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
        stockMovements: 1,
        staff: 0,
        auditLogs: 0,
      },
      requireCloudParity: false,
    });

    expect(certification.inventoryIntegrityStatus).toBe("warning");
    expect(certification.certified).toBe(true);

    const gate = validateRecoveryCompletionGate(
      {
        hasCloudProducts: true,
        hasSnapshot: false,
        snapshotUpdatedAt: null,
        snapshotRowFound: false,
        snapshotContainsCoreData: false,
      },
      validation,
      { certification },
    );

    expect(gate.ok).toBe(true);
    expect(gate.inventoryWarnings).toBe(true);
    expect(gate.failures).not.toContain("integrity_critical");
    expect(gate.failures).not.toContain("inventory_integrity_mismatch");
    expect(gate.message).toContain("warnings");
  });

  it("audit log entity count mismatch is warning-only and does not block recovery", () => {
    const products = [product(8)];
    const sales = [sale(SALE_A, 1), sale(SALE_B, 1)];

    usePosStore.setState({ products, sales, customers: [], stockMovements: [], debtPayments: [] });

    const validation = validateCloudRecoveryLocalState(
      {
        products: [product(8)],
        customers: [],
        sales: [sale(SALE_A, 1), sale(SALE_B, 1)],
        debtPayments: [],
        stockMovements: [],
        suppliers: [],
        purchases: [],
        supplierPayments: [],
        preferences: { shifts: [] } as never,
        returnRecords: [],
        dayClosesCount: 0,
      },
      { recoveryMode: true },
    );

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
        auditLogs: 12,
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

    expect(certification.failures).toContain("entity_count_mismatch_auditLogs");
    expect(certification.certified).toBe(true);

    const gate = validateRecoveryCompletionGate(
      {
        hasCloudProducts: true,
        hasSnapshot: false,
        snapshotUpdatedAt: null,
        snapshotRowFound: false,
        snapshotContainsCoreData: false,
      },
      validation,
      { certification },
    );

    expect(gate.ok).toBe(true);
    expect(gate.warnings).toContain("entity_count_mismatch_auditLogs");
    expect(gate.failures).not.toContain("entity_count_mismatch_auditLogs");
  });
});
