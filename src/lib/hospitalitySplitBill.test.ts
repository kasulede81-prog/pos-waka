/**
 * Split bills must add up EXACTLY to the one authoritative total
 * (computeRestaurantBillTotals -> finalizeDraftSale). Retail/Kiosk Duka remains the financial
 * source of truth: nothing here recomputes tax or service charge.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { BillSplitLine, Product } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { defaultHospitalityFloor } from "./hospitality";
import { computeRestaurantBillTotals, reconcileSplitsToTotal, splitBillByItem, splitBillBySeat, splitBillEqual } from "./restaurantBilling";

const sum = (splits: Array<{ amountUgx: number }>) => splits.reduce((n, s) => n + s.amountUgx, 0);
const split = (id: string, amountUgx: number): BillSplitLine => ({ id, label: id, amountUgx, paidUgx: 0, status: "open" });

describe("reconcileSplitsToTotal", () => {
  it("distributes the authoritative total exactly (no UGX lost or invented)", () => {
    for (const total of [1, 2, 3, 99_999, 100_000, 129_800, 1_000_003]) {
      for (const raws of [[60_000, 40_000], [1, 1, 1], [33_333, 33_333, 33_334], [7, 13, 29, 51], [500_000, 1]]) {
        const out = reconcileSplitsToTotal(raws.map((n, i) => split(`s${i}`, n)), total);
        expect(sum(out)).toBe(total);
        expect(out.every((s) => Number.isInteger(s.amountUgx) && s.amountUgx >= 0)).toBe(true);
      }
    }
  });

  it("keeps ids, labels and order and stays proportional", () => {
    const out = reconcileSplitsToTotal([split("seat-1", 60_000), split("seat-2", 40_000)], 129_800);
    expect(out.map((s) => s.id)).toEqual(["seat-1", "seat-2"]);
    expect(out.map((s) => s.amountUgx)).toEqual([77_880, 51_920]);
  });

  it("is a no-op when already exact, empty, or nothing to distribute", () => {
    const exact = [split("a", 50), split("b", 50)];
    expect(reconcileSplitsToTotal(exact, 100)).toBe(exact);
    expect(reconcileSplitsToTotal([], 100)).toEqual([]);
    const zero = [split("a", 0)];
    expect(reconcileSplitsToTotal(zero, 100)).toBe(zero);
  });

  it("equal splits already add up (remainder spread)", () => {
    expect(sum(splitBillEqual(129_800, 3))).toBe(129_800);
  });
});

const STEAK = { id: "steak", name: "Steak", sellingPricePerUnitUgx: 60_000 };
const SALAD = { id: "salad", name: "Salad", sellingPricePerUnitUgx: 40_000 };

function prod(p: { id: string; name: string; sellingPricePerUnitUgx: number }): Product {
  return {
    sellingMode: "unit",
    baseUnit: "pcs",
    costPricePerUnitUgx: 10_000,
    stockOnHand: 50,
    minimumStockAlert: 0,
    category: "Food",
    sku: "",
    updatedAt: "2026-09-17T08:00:00.000Z",
    version: 1,
    ...p,
  };
}

function setup(prefs: Record<string, unknown>, cartDiscountUgx = 0) {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "local:owner", role: "owner", displayName: "Owner" },
    products: [prod(STEAK), prod(SALAD)],
    sales: [],
    auditLogs: [],
    dayCloses: [],
    draftLines: [],
    draftCartDiscountUgx: 0,
    activePendingSaleId: null,
    preferences: {
      ...usePosStore.getState().preferences,
      businessType: "hospitality",
      hospitalityModeEnabled: true,
      hospitalityManualKitchenFire: true,
      hospitalityFloor: defaultHospitalityFloor(),
      ...prefs,
    },
  });
  openTestShift();
  const floor = usePosStore.getState().preferences.hospitalityFloor!;
  expect(usePosStore.getState().openTable({ tableId: floor.tables[0]!.id, guestCount: 2 }).ok).toBe(true);
  const s = usePosStore.getState();
  expect(s.addHospitalityDraftLine({ product: prod(STEAK), quantity: 1, seatNumber: 1 }).ok).toBe(true);
  expect(s.addHospitalityDraftLine({ product: prod(SALAD), quantity: 1, seatNumber: 2 }).ok).toBe(true);
  if (cartDiscountUgx > 0) expect(usePosStore.getState().setDraftCartDiscount(cartDiscountUgx).ok).toBe(true);
  expect(usePosStore.getState().saveTableBill().ok).toBe(true);
}

function grandTotal(): number {
  const st = usePosStore.getState();
  const sale = st.sales.find((x) => x.id === st.activePendingSaleId)!;
  return computeRestaurantBillTotals({
    lines: st.draftLines,
    cartDiscountUgx: st.draftCartDiscountUgx,
    billDraft: sale.billDraft ?? null,
    prefs: st.preferences,
  }).grandTotalUgx;
}

function storedSplits(): BillSplitLine[] {
  const st = usePosStore.getState();
  return st.sales.find((x) => x.id === st.activePendingSaleId)!.billDraft!.splits;
}

function applyBySeat() {
  const st = usePosStore.getState();
  return st.applyTableBillSplits({ mode: "by_seat", splits: splitBillBySeat(st.draftLines, 2) });
}

const SC_TAX_EXCLUSIVE = {
  hospitalityServiceChargePercent: 10,
  hospitalityTaxEnabled: true,
  hospitalityTaxPercent: 18,
  hospitalityTaxMode: "exclusive",
};
const SC_TAX_INCLUSIVE = { ...SC_TAX_EXCLUSIVE, hospitalityTaxMode: "inclusive" };

describe("split bill totals reconcile with the settled sale", () => {
  beforeEach(() => undefined);

  it("tax-exclusive + service charge: stored by-seat splits add up to the grand total", () => {
    setup(SC_TAX_EXCLUSIVE);
    // 100,000 + 10% service = 110,000; +18% tax on that = 129,800
    expect(grandTotal()).toBe(129_800);
    expect(applyBySeat().ok).toBe(true);
    expect(sum(storedSplits())).toBe(129_800);
  });

  it("tax-inclusive + service charge: tax is not added again, splits add up to the grand total", () => {
    setup(SC_TAX_INCLUSIVE);
    expect(grandTotal()).toBe(110_000);
    expect(applyBySeat().ok).toBe(true);
    expect(sum(storedSplits())).toBe(110_000);
  });

  it("discount: splits follow the discounted total", () => {
    setup({ hospitalityServiceChargePercent: 0, hospitalityTaxEnabled: false }, 10_000);
    expect(grandTotal()).toBe(90_000);
    expect(applyBySeat().ok).toBe(true);
    expect(sum(storedSplits())).toBe(90_000);
  });

  it("paying every split then settling records exactly the sum of the splits (one sale)", () => {
    setup(SC_TAX_EXCLUSIVE);
    expect(applyBySeat().ok).toBe(true);
    for (const s of storedSplits()) {
      expect(usePosStore.getState().recordTableBillPayment({ method: "cash", amountUgx: s.amountUgx, splitId: s.id }).ok).toBe(true);
    }
    const res = usePosStore.getState().finalizeTableBill();
    expect(res.ok).toBe(true);
    const sales = usePosStore.getState().sales.filter((x) => x.status === "completed" || !x.status);
    expect(sales).toHaveLength(1);
    expect(sales[0]!.totalUgx).toBe(129_800);
    expect(sum(sales[0]!.splitBreakdown ?? [])).toBe(sales[0]!.totalUgx);
  });

  it("by-item splits reconcile too", () => {
    setup(SC_TAX_EXCLUSIVE);
    const st = usePosStore.getState();
    const assignments: Record<string, string> = {};
    st.draftLines.forEach((l, i) => (assignments[l.id ?? l.productId] = i === 0 ? "A" : "B"));
    const raw = splitBillByItem(st.draftLines, assignments, { A: "Bill A", B: "Bill B" });
    expect(sum(raw)).toBe(100_000);
    expect(st.applyTableBillSplits({ mode: "by_item", splits: raw }).ok).toBe(true);
    expect(sum(storedSplits())).toBe(129_800);
  });

  it("custom splits must equal the total, otherwise they are rejected", () => {
    setup(SC_TAX_EXCLUSIVE);
    const bad = usePosStore.getState().applyTableBillSplits({ mode: "custom", splits: [split("x", 100_000), split("y", 20_000)] });
    expect(bad.ok).toBe(false);
    expect(bad.errorKey).toBe("splitTotalMismatch");
    const good = usePosStore.getState().applyTableBillSplits({ mode: "custom", splits: [split("x", 100_000), split("y", 29_800)] });
    expect(good.ok).toBe(true);
  });

  it("splits made stale by later changes are reconciled to the recorded total at settlement", () => {
    setup({ hospitalityServiceChargePercent: 0, hospitalityTaxEnabled: false });
    expect(applyBySeat().ok).toBe(true);
    // a third dish is added AFTER the split was applied, so the stored splits (100,000) are stale
    expect(usePosStore.getState().addHospitalityDraftLine({ product: prod(SALAD), quantity: 1 }).ok).toBe(true);
    usePosStore.getState().saveTableBill();
    expect(usePosStore.getState().recordTableBillPayment({ method: "cash", amountUgx: 140_000 }).ok).toBe(true);
    const res = usePosStore.getState().finalizeTableBill();
    expect(res.ok).toBe(true);
    const sale = usePosStore.getState().sales.find((x) => x.id === (res as { saleId: string }).saleId)!;
    expect(sale.totalUgx).toBe(140_000);
    expect(sum(sale.splitBreakdown ?? [])).toBe(140_000);
  });
});

describe("split-bill payments", () => {
  it("two guests paying the same amount for different splits are both accepted", () => {
    setup({ hospitalityServiceChargePercent: 0, hospitalityTaxEnabled: false });
    const st = usePosStore.getState();
    expect(st.applyTableBillSplits({ mode: "equal", splits: splitBillEqual(100_000, 2) }).ok).toBe(true);
    const ids = storedSplits().map((s) => s.id!);
    expect(usePosStore.getState().recordTableBillPayment({ method: "cash", amountUgx: 50_000, splitId: ids[0] }).ok).toBe(true);
    const second = usePosStore.getState().recordTableBillPayment({ method: "cash", amountUgx: 50_000, splitId: ids[1] });
    expect(second.ok).toBe(true);
    expect(second.canFinalize).toBe(true);
  });

  it("the same payment repeated for the SAME split is still treated as a double tap", () => {
    setup({ hospitalityServiceChargePercent: 0, hospitalityTaxEnabled: false });
    const st = usePosStore.getState();
    expect(st.applyTableBillSplits({ mode: "equal", splits: splitBillEqual(100_000, 2) }).ok).toBe(true);
    const id = storedSplits()[0]!.id!;
    expect(usePosStore.getState().recordTableBillPayment({ method: "cash", amountUgx: 20_000, splitId: id }).ok).toBe(true);
    const again = usePosStore.getState().recordTableBillPayment({ method: "cash", amountUgx: 20_000, splitId: id });
    expect(again.ok).toBe(false);
    expect(again.errorKey).toBe("billPaymentDuplicate");
  });

  it("non-cash payments cannot exceed the remaining balance; cash may (change)", () => {
    setup({ hospitalityServiceChargePercent: 0, hospitalityTaxEnabled: false });
    const over = usePosStore.getState().recordTableBillPayment({ method: "mobile_money", amountUgx: 500_000 });
    expect(over.ok).toBe(false);
    expect(over.errorKey).toBe("billPaymentExceedsBalance");
    expect(usePosStore.getState().recordTableBillPayment({ method: "cash", amountUgx: 120_000 }).ok).toBe(true);
  });
});
