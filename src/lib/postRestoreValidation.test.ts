import { describe, expect, it } from "vitest";
import type { Customer, Product, Purchase, Sale, StockMovement, Supplier } from "../types";
import {
  buildPostRestoreValidationSnapshot,
  runPostRestoreValidationSnapshot,
  getLastPostRestoreValidation,
} from "./postRestoreValidation";

const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CUSTOMER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUPPLIER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("postRestoreValidation", () => {
  it("reports healthy when ledgers align", () => {
    const products: Product[] = [
      {
        id: PRODUCT_ID,
        name: "Rice",
        sellingPricePerUnitUgx: 5000,
        costPricePerUnitUgx: 3000,
        stockOnHand: 10,
        baseUnit: "kg",
        sellingMode: "unit",
        category: "General",
        sku: "",
        minimumStockAlert: 1,
        updatedAt: "2026-06-01T00:00:00.000Z",
        version: 1,
      },
    ];
    const movements: StockMovement[] = [
      {
        id: "m1",
        at: "2026-06-01T10:00:00.000Z",
        productId: PRODUCT_ID,
        productName: "Rice",
        deltaBaseUnits: 10,
        kind: "purchase_in",
        summary: "+10",
      },
    ];
    const customers: Customer[] = [
      {
        id: CUSTOMER_ID,
        name: "Bob",
        phone: "",
        location: "",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        version: 1,
        debtBalanceUgx: 0,
      },
    ];
    const sales: Sale[] = [];
    const suppliers: Supplier[] = [
      {
        id: SUPPLIER_ID,
        name: "Wholesaler",
        phone: "",
        location: "",
        notes: "",
        balanceOwedUgx: 0,
        totalPurchasesUgx: 0,
        lastSupplyAt: null,
        createdAt: "2026-06-01T00:00:00.000Z",
        version: 1,
      },
    ];
    const purchases: Purchase[] = [];

    const snap = buildPostRestoreValidationSnapshot({
      products,
      stockMovements: movements,
      customers,
      sales,
      debtPayments: [],
      suppliers,
      purchases,
      supplierPayments: [],
    });

    expect(snap.overallStatus).toBe("healthy");
    expect(snap.inventory.ok).toBe(true);
    expect(snap.debt.ok).toBe(true);
    expect(snap.suppliers.ok).toBe(true);
  });

  it("flags debt mismatch without healing", () => {
    const customers: Customer[] = [
      {
        id: CUSTOMER_ID,
        name: "Bob",
        phone: "",
        location: "",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        version: 1,
        debtBalanceUgx: 50_000,
      },
    ];
    const sales: Sale[] = [
      {
        id: "sale-1",
        status: "completed",
        createdAt: "2026-06-11T10:00:00.000Z",
        updatedAt: "2026-06-11T10:00:00.000Z",
        subtotalUgx: 100_000,
        totalUgx: 100_000,
        cashPaidUgx: 0,
        debtUgx: 100_000,
        estimatedProfitUgx: 0,
        lines: [],
        pendingSync: false,
        lastSyncError: null,
        customerId: CUSTOMER_ID,
      },
    ];

    const snap = runPostRestoreValidationSnapshot({
      products: [],
      stockMovements: [],
      customers,
      sales,
      debtPayments: [],
      suppliers: [],
      purchases: [],
      supplierPayments: [],
    });

    expect(snap.debt.ok).toBe(false);
    expect(snap.debt.mismatchCount).toBe(1);
    expect(getLastPostRestoreValidation()?.debt.mismatchCount).toBe(1);
    expect(customers[0]!.debtBalanceUgx).toBe(50_000);
  });
});
