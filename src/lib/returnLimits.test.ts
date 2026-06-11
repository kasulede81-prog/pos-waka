import { describe, expect, it } from "vitest";
import type { ReturnRecord, Sale, SaleLine } from "../types";
import {
  originalLinePaidUgx,
  remainingRefundableForLineQty,
  suggestReturnRefundUgx,
  validateReturnAgainstSale,
} from "./returnLimits";
import { returnRestocksInventory } from "./returnPolicy";

const SALE_ID = "sale-1";
const PROD_A = "prod-a";
const PROD_B = "prod-b";

function line(
  productId: string,
  quantity: number,
  lineTotalUgx: number,
  overrides: Partial<SaleLine> = {},
): SaleLine {
  return {
    id: `line-${productId}`,
    productId,
    name: productId,
    quantity,
    unitPriceUgx: lineTotalUgx / quantity,
    unitCostUgx: 100,
    estimatedProfitUgx: lineTotalUgx - quantity * 100,
    inputMode: "quantity",
    lineTotalUgx,
    ...overrides,
  };
}

function sale(totalUgx: number, lines: SaleLine[]): Sale {
  return {
    id: SALE_ID,
    status: "completed",
    createdAt: "2026-06-11T10:00:00.000Z",
    updatedAt: "2026-06-11T10:00:00.000Z",
    subtotalUgx: lines.reduce((a, l) => a + l.lineTotalUgx, 0),
    totalUgx,
    cashPaidUgx: totalUgx,
    debtUgx: 0,
    estimatedProfitUgx: 5000,
    lines,
    pendingSync: false,
    lastSyncError: null,
    customerId: null,
  };
}

function returnRec(
  productId: string,
  quantity: number,
  refundAmountUgx: number,
): ReturnRecord {
  return {
    id: crypto.randomUUID(),
    saleId: SALE_ID,
    productId,
    productName: productId,
    quantity,
    refundAmountUgx,
    reason: "damaged",
    actorUserId: "u1",
    createdAt: "2026-06-11T11:00:00.000Z",
  };
}

describe("returnLimits — cart discount allocation", () => {
  const lines = [line(PROD_A, 2, 6000), line(PROD_B, 1, 4000)];
  const discountedSale = sale(8000, lines);

  it("allocates refund by what customer paid, not list line total", () => {
    expect(originalLinePaidUgx(discountedSale, PROD_A, [])).toBe(4800);
    expect(originalLinePaidUgx(discountedSale, PROD_B, [])).toBe(3200);
    expect(suggestReturnRefundUgx(discountedSale, PROD_A, 2, [])).toBe(4800);
    expect(suggestReturnRefundUgx(discountedSale, PROD_A, 1, [])).toBe(2400);
  });

  it("partial returns do not over-refund on second return", () => {
    const afterFirst = { ...discountedSale, totalUgx: 5600 };
    const records = [returnRec(PROD_A, 1, 2400)];

    expect(suggestReturnRefundUgx(afterFirst, PROD_A, 1, records)).toBe(2400);
    expect(remainingRefundableForLineQty(afterFirst, PROD_A, 1, records)).toBe(2400);

    const check = validateReturnAgainstSale({
      sale: afterFirst,
      productId: PROD_A,
      quantity: 1,
      refundAmountUgx: 2400,
      returnRecords: records,
    });
    expect(check.ok).toBe(true);

    const over = validateReturnAgainstSale({
      sale: afterFirst,
      productId: PROD_A,
      quantity: 1,
      refundAmountUgx: 3000,
      returnRecords: records,
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errorKey).toBe("returnExceedsLine");
  });

  it("rejects refund above list line total when cart discount applied", () => {
    const check = validateReturnAgainstSale({
      sale: discountedSale,
      productId: PROD_A,
      quantity: 2,
      refundAmountUgx: 6000,
      returnRecords: [],
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.errorKey).toBe("returnExceedsLine");
  });
});

describe("returnPolicy — inventory", () => {
  it("only wrong_item restocks sellable inventory", () => {
    expect(returnRestocksInventory("wrong_item")).toBe(true);
    expect(returnRestocksInventory("damaged")).toBe(false);
    expect(returnRestocksInventory("warm_bad")).toBe(false);
    expect(returnRestocksInventory("broken")).toBe(false);
    expect(returnRestocksInventory("other")).toBe(false);
  });
});
