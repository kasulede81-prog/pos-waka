import { describe, expect, it, beforeEach } from "vitest";
import type { Product, SaleLine } from "../types";
import { cartDiscountFromPendingSale, computeDraftCheckoutTotals, estimatedProfitAfterCartDiscount } from "./draftCart";
import { buildPendingSaleFromDraft } from "./hospitality";
import { mergePendingSales } from "./pendingSaleMerge";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";

const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const baseProduct: Product = {
  id: PRODUCT_ID,
  name: "Soap",
  sellingPricePerUnitUgx: 10_000,
  costPricePerUnitUgx: 3_000,
  stockOnHand: 20,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 2,
  updatedAt: "2026-06-01T08:00:00.000Z",
  version: 1,
};

const draftLine: SaleLine = {
  id: "line-1",
  productId: PRODUCT_ID,
  name: "Soap",
  inputMode: "quantity",
  quantity: 2,
  unitPriceUgx: 10_000,
  unitCostUgx: 3_000,
  lineTotalUgx: 20_000,
  estimatedProfitUgx: 14_000,
  updatedAt: "2026-06-02T10:00:00.000Z",
};

describe("cartDiscountFromPendingSale", () => {
  it("restores cart discount so payable matches held total", () => {
    const held = buildPendingSaleFromDraft({
      saleId: "pending-1",
      lines: [draftLine],
      cartDiscountUgx: 5_000,
    });
    const restored = cartDiscountFromPendingSale(held);
    const checkout = computeDraftCheckoutTotals(held.lines, restored);
    expect(checkout.payableUgx).toBe(held.totalUgx);
    expect(restored).toBe(5_000);
  });
});

describe("estimatedProfitAfterCartDiscount", () => {
  it("scales profit down when cart discount applies", () => {
    const profit = estimatedProfitAfterCartDiscount([draftLine], 5_000);
    expect(profit).toBe(Math.round(14_000 * 0.75));
  });
});

describe("mergePendingSales cart discount", () => {
  it("preserves cart discount from newer held sale header", () => {
    const lineB: SaleLine = {
      ...draftLine,
      id: "line-2",
      productId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      name: "Rice",
      lineTotalUgx: 10_000,
      estimatedProfitUgx: 7_000,
    };
    const heldA = buildPendingSaleFromDraft({
      saleId: "a",
      lines: [draftLine],
      cartDiscountUgx: 0,
    });
    const heldB = buildPendingSaleFromDraft({
      saleId: "b",
      lines: [lineB],
      cartDiscountUgx: 2_000,
    });
    heldB.updatedAt = "2026-06-03T10:00:00.000Z";
    heldA.updatedAt = "2026-06-02T10:00:00.000Z";
    const merged = mergePendingSales(heldA, heldB);
    expect(merged.totalUgx).toBe(28_000);
    expect(cartDiscountFromPendingSale(merged)).toBe(2_000);
  });
});

describe("resumePendingSale — cart discount round-trip", () => {
  beforeEach(() => {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
      products: [baseProduct],
      customers: [],
      sales: [],
      draftLines: [draftLine],
      draftCartDiscountUgx: 5_000,
      activePendingSaleId: null,
      draftInput: null,
    });
    expect(openTestShift().ok).toBe(true);
  });

  it("held sale with discount keeps same payable after resume and re-checkout math", () => {
    const save = usePosStore.getState().savePendingSale("Counter hold");
    expect(save.ok).toBe(true);

    const held = usePosStore.getState().sales.find((s) => s.id === save.saleId);
    expect(held?.totalUgx).toBe(15_000);

    const resume = usePosStore.getState().resumePendingSale(save.saleId!);
    expect(resume.ok).toBe(true);

    const state = usePosStore.getState();
    const checkout = computeDraftCheckoutTotals(state.draftLines, state.draftCartDiscountUgx);
    expect(checkout.payableUgx).toBe(15_000);
    expect(state.draftCartDiscountUgx).toBe(5_000);
  });
});
