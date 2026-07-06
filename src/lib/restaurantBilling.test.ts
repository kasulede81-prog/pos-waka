import { describe, expect, it } from "vitest";
import {
  computeRestaurantBillTotals,
  deriveAggregatePaymentMethod,
  emptyBillDraft,
  isDuplicatePayment,
  splitBillBySeat,
  splitBillEqual,
  validateCustomSplits,
} from "./restaurantBilling";
import type { SaleLine } from "../types";

function line(id: string, total: number, seat?: number): SaleLine {
  return {
    id,
    productId: id,
    name: id,
    inputMode: "quantity",
    quantity: 1,
    unitPriceUgx: total,
    unitCostUgx: 0,
    lineTotalUgx: total,
    estimatedProfitUgx: total,
    seatNumber: seat,
  };
}

describe("restaurantBilling", () => {
  it("computes service charge, tax, and tip on grand total", () => {
    const totals = computeRestaurantBillTotals({
      lines: [line("a", 100_000)],
      cartDiscountUgx: 0,
      billDraft: {
        ...emptyBillDraft(),
        serviceChargePercent: 10,
        taxPercent: 0,
        tipMode: "percent",
        tipPercent: 5,
      },
      prefs: { businessType: "restaurant" } as import("../types").ShopPreferences,
    });
    expect(totals.serviceChargeUgx).toBe(10_000);
    expect(totals.tipUgx).toBe(5_500);
    expect(totals.grandTotalUgx).toBe(115_500);
    expect(totals.remainingBalanceUgx).toBe(115_500);
  });

  it("tracks partial payments against remaining balance", () => {
    const totals = computeRestaurantBillTotals({
      lines: [line("a", 50_000)],
      cartDiscountUgx: 0,
      billDraft: {
        ...emptyBillDraft(),
        payments: [
          {
            id: "p1",
            method: "cash",
            amountUgx: 20_000,
            recordedAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(totals.paidTotalUgx).toBe(20_000);
    expect(totals.remainingBalanceUgx).toBe(30_000);
  });

  it("splits equally with remainder on first guests", () => {
    const splits = splitBillEqual(100_003, 4);
    expect(splits).toHaveLength(4);
    expect(splits.reduce((a, s) => a + s.amountUgx, 0)).toBe(100_003);
  });

  it("splits by seat from line seat numbers", () => {
    const splits = splitBillBySeat([line("1", 30_000, 1), line("2", 20_000, 2)], 2);
    expect(splits.find((s) => s.seatNumber === 1)?.amountUgx).toBe(30_000);
    expect(splits.find((s) => s.seatNumber === 2)?.amountUgx).toBe(20_000);
  });

  it("validates custom splits sum to total", () => {
    expect(validateCustomSplits([{ label: "A", amountUgx: 60_000 }, { label: "B", amountUgx: 40_000 }], 100_000)).toBe(
      true,
    );
    expect(validateCustomSplits([{ label: "A", amountUgx: 50_000 }], 100_000)).toBe(false);
  });

  it("derives mixed payment method from multiple payments", () => {
    expect(
      deriveAggregatePaymentMethod([
        { id: "1", method: "cash", amountUgx: 10_000, recordedAt: "" },
        { id: "2", method: "mobile_money", amountUgx: 5_000, recordedAt: "" },
      ]),
    ).toBe("mixed");
  });

  it("detects duplicate payments within window", () => {
    const payments = [{ id: "1", method: "cash" as const, amountUgx: 10_000, recordedAt: new Date().toISOString() }];
    expect(isDuplicatePayment(payments, { amountUgx: 10_000, method: "cash" })).toBe(true);
    expect(isDuplicatePayment(payments, { amountUgx: 9_000, method: "cash" })).toBe(false);
  });
});
