import { describe, expect, it } from "vitest";
import type { SaleLine } from "../types";
import { applyDiscountToLine, moneyLineAmountForQuantity } from "./saleAdjustments";
import { resolveSaleLineQuantity } from "./saleQuantityLabel";
import { formatDraftLineQty } from "./draftCart";
import type { Product } from "../types";

function qtyLine(overrides: Partial<SaleLine> = {}): SaleLine {
  return {
    id: "l1",
    productId: "p1",
    name: "intel-128GB/8GB RAM",
    inputMode: "quantity",
    quantity: 1,
    unitPriceUgx: 300_000,
    unitCostUgx: 200_000,
    lineTotalUgx: 300_000,
    estimatedProfitUgx: 100_000,
    ...overrides,
  };
}

function moneyPieceLine(overrides: Partial<SaleLine> = {}): SaleLine {
  return qtyLine({
    inputMode: "money",
    moneyAmountUgx: 300_000,
    ...overrides,
  });
}

describe("applyDiscountToLine does not change sold quantity", () => {
  it("keeps 1 piece when a quantity line is discounted to a custom price", () => {
    const next = applyDiscountToLine(qtyLine(), "final", 20_000);
    expect(next).not.toBeNull();
    expect(next!.quantity).toBe(1);
    expect(next!.inputMode).toBe("quantity");
    expect(next!.lineTotalUgx).toBe(20_000);
    expect(next!.discountUgx).toBe(280_000);
    expect(next!.originalLineTotalUgx).toBe(300_000);
    expect(resolveSaleLineQuantity(next!)).toBe(1);
  });

  it("keeps 1 piece when a money line is discounted to a custom price", () => {
    const next = applyDiscountToLine(moneyPieceLine(), "final", 20_000);
    expect(next).not.toBeNull();
    expect(next!.quantity).toBe(1);
    expect(next!.inputMode).toBe("money");
    expect(next!.lineTotalUgx).toBe(20_000);
    expect(next!.moneyAmountUgx).toBe(300_000);
    expect(moneyLineAmountForQuantity(next!)).toBe(300_000);
    expect(resolveSaleLineQuantity(next!)).toBe(1);
  });

  it("still shows 1 piece in the cart qty label after a price discount", () => {
    const product: Product = {
      id: "p1",
      name: "intel-128GB/8GB RAM",
      sellingPricePerUnitUgx: 300_000,
      costPricePerUnitUgx: 200_000,
      stockOnHand: 416,
      baseUnit: "piece",
      sellingMode: "unit",
      category: "General",
      sku: "",
      minimumStockAlert: 0,
      version: 1,
      updatedAt: "",
    };
    const next = applyDiscountToLine(moneyPieceLine(), "final", 20_000)!;
    expect(formatDraftLineQty(product, next)).toBe("1 piece");
    expect(formatDraftLineQty(product, next)).not.toContain("0.067");
  });
});
