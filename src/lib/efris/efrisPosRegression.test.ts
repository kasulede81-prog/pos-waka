import { beforeEach, describe, expect, it } from "vitest";
import type { Product, SaleLine } from "../../types";
import { usePosStore } from "../../store/usePosStore";
import { openTestShift } from "../../test/shiftTestSetup";

const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const product: Product = {
  id: PRODUCT_ID,
  name: "Soap",
  sellingPricePerUnitUgx: 5_000,
  costPricePerUnitUgx: 2_000,
  stockOnHand: 10,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 2,
  updatedAt: "2026-06-01T08:00:00.000Z",
  version: 1,
};

const line: SaleLine = {
  id: "line-1",
  productId: PRODUCT_ID,
  name: "Soap",
  inputMode: "quantity",
  quantity: 2,
  unitPriceUgx: 5_000,
  unitCostUgx: 2_000,
  lineTotalUgx: 10_000,
  estimatedProfitUgx: 6_000,
  updatedAt: "2026-06-02T10:00:00.000Z",
};

describe("EFRIS Phase 1 — POS sale regression (EFRIS disabled)", () => {
  beforeEach(() => {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
      products: [{ ...product }],
      customers: [],
      sales: [],
      draftLines: [{ ...line }],
      draftCartDiscountUgx: 0,
      activePendingSaleId: null,
      stockMovements: [],
    });
    openTestShift();
  });

  it("completes a WAKA sale, deducts stock, and does not depend on EFRIS", () => {
    const res = usePosStore.getState().finalizeDraftSale({
      debtUgx: 0,
      paymentMethod: "cash",
      amountPaidUgx: 10_000,
      changeGivenUgx: 0,
    });
    expect(res.ok).toBe(true);
    const state = usePosStore.getState();
    const sale = state.sales[0];
    expect(sale?.status).toBe("completed");
    expect(sale?.totalUgx).toBe(10_000);
    expect(sale?.pendingSync).toBe(true);
    expect(state.products[0]?.stockOnHand).toBe(8);
    expect(state.draftLines).toHaveLength(0);
    expect(sale).not.toHaveProperty("efris_state");
    expect(sale).not.toHaveProperty("efrisState");
  });

  it("unsaved cart void is not a completed EFRIS sale", () => {
    const res = usePosStore.getState().voidCurrentCart();
    expect(res.ok).toBe(true);
    const sale = usePosStore.getState().sales.find((s) => s.id === res.saleId);
    expect(sale?.status).toBe("cancelled");
    expect(sale).not.toHaveProperty("efris_state");
    expect(sale).not.toHaveProperty("efrisState");
    expect(usePosStore.getState().products[0]?.stockOnHand).toBe(10);
  });
});
