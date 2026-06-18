import { describe, expect, it, beforeEach } from "vitest";
import { usePosStore, applyRestoredSnapshotFromBackup } from "../store/usePosStore";
import type { Product } from "../types";
import type { PersistedSnapshot } from "../offline/localDb";

const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CUSTOMER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const baseProduct: Product = {
  id: PRODUCT_ID,
  name: "Item",
  sellingPricePerUnitUgx: 1_000,
  costPricePerUnitUgx: 100,
  stockOnHand: 10,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 2,
  updatedAt: "2026-05-31T09:00:00.000Z",
  version: 1,
};

function seedStore(role: "cashier" | "owner") {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "staff:1", role, displayName: "Tester" },
    products: [baseProduct],
    customers: [
      {
        id: CUSTOMER_ID,
        name: "Buyer",
        phone: "",
        location: "",
        debtBalanceUgx: 5_000,
        createdAt: "2026-05-01T00:00:00.000Z",
        version: 1,
      },
    ],
    purchases: [],
    stockMovements: [],
    auditLogs: [],
  });
}

function minimalSnapshot(): PersistedSnapshot {
  return {
    products: [baseProduct],
    customers: [],
    sales: [],
    preferences: usePosStore.getState().preferences,
    debtPayments: [],
    dayCloses: [],
    updatedAt: new Date().toISOString(),
  };
}

describe("usePosStore — cashier mutation regression", () => {
  beforeEach(() => {
    seedStore("cashier");
  });

  it("cashier adjustStock is denied and does not change stock", () => {
    usePosStore.getState().adjustStock(PRODUCT_ID, -1, "sold");
    expect(usePosStore.getState().products[0]!.stockOnHand).toBe(10);
    expect(usePosStore.getState().auditLogs.some((a) => a.action === "auth_forbidden")).toBe(true);
  });

  it("cashier addDebtPayment succeeds", () => {
    usePosStore.getState().beginShift();
    const r = usePosStore.getState().addDebtPayment(CUSTOMER_ID, 1_000);
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().customers[0]!.debtBalanceUgx).toBe(4_000);
  });

  it("cashier finalizeDraftSale with credit succeeds", () => {
    usePosStore.getState().beginShift();
    usePosStore.setState({
      draftLines: [
        {
          id: "line-1",
          productId: PRODUCT_ID,
          name: "Item",
          inputMode: "quantity",
          quantity: 1,
          unitPriceUgx: 1_000,
          unitCostUgx: 100,
          lineTotalUgx: 1_000,
          estimatedProfitUgx: 900,
          updatedAt: "2026-06-02T10:00:00.000Z",
        },
      ],
      draftCartDiscountUgx: 0,
    });
    const r = usePosStore.getState().finalizeDraftSale({
      debtUgx: 1_000,
      paymentMethod: "credit",
      amountPaidUgx: 0,
      changeGivenUgx: 0,
      customerName: "Walk-in debtor",
    });
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().sales).toHaveLength(1);
    expect(usePosStore.getState().sales[0]?.debtUgx).toBe(1_000);
  });

  it("cashier voidCashExpense is denied with auth_forbidden audit", () => {
    usePosStore.setState({
      cashExpenses: [
        {
          id: "exp-1",
          category: "transport",
          amountUgx: 5000,
          description: "",
          paidOn: "2026-05-31",
          createdAt: "2026-05-31T10:00:00.000Z",
          createdByUserId: "staff:1",
          pendingSync: false,
        },
      ],
    });
    const r = usePosStore.getState().voidCashExpense("exp-1", "wrong entry");
    expect(r.ok).toBe(false);
    expect(usePosStore.getState().auditLogs.some((a) => a.action === "auth_forbidden")).toBe(true);
  });

  it("cashier updateProduct fails", () => {
    const r = usePosStore.getState().updateProduct(PRODUCT_ID, { sellingPricePerUnitUgx: 2_000 });
    expect(r.ok).toBe(false);
    expect(usePosStore.getState().products[0]!.sellingPricePerUnitUgx).toBe(1_000);
  });

  it("cashier backup restore throws forbidden", async () => {
    await expect(applyRestoredSnapshotFromBackup(minimalSnapshot())).rejects.toThrow("forbidden");
    expect(usePosStore.getState().auditLogs.some((a) => a.action === "auth_forbidden")).toBe(true);
  });
});

describe("usePosStore — owner mutations allowed", () => {
  beforeEach(() => {
    seedStore("owner");
  });

  it("owner adjustStock changes stock", () => {
    usePosStore.getState().adjustStock(PRODUCT_ID, -1, "sold");
    expect(usePosStore.getState().products[0]!.stockOnHand).toBe(9);
  });
});
