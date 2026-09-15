import { describe, expect, it } from "vitest";
import type { Product, SaleLine } from "../types";
import { formatQuantityWithFractions } from "./formatQuantityWithFractions";
import {
  buildReceiptLineQuantityDisplay,
  formatReceiptLineCalculation,
  formatSaleLineQuantity,
  resolveSaleLineQuantity,
} from "./saleQuantityLabel";

describe("formatQuantityWithFractions", () => {
  const cases: [number, string][] = [
    [0.5, "½ kg"],
    [1.25, "1¼ kg"],
    [1.5, "1½ kg"],
    [1.75, "1¾ kg"],
    [2.125, "2⅛ kg"],
    [2.375, "2⅜ kg"],
    [3.25, "3¼ kg"],
    [3.5, "3½ kg"],
    [3.75, "3¾ kg"],
    [4.625, "4⅝ kg"],
    [0.125, "⅛ kg"],
    [0.333, "⅓ kg"],
    [0.667, "⅔ kg"],
  ];

  it.each(cases)("formats %f as %s", (qty, expected) => {
    expect(formatQuantityWithFractions(qty, "kg")).toBe(expected);
  });

  it("falls back to decimals when no fraction matches", () => {
    expect(formatQuantityWithFractions(3.438, "kg")).toBe("3.438 kg");
  });
});

describe("resolveSaleLineQuantity", () => {
  const moneyLine = (partial: Partial<SaleLine>): SaleLine => ({
    id: "l1",
    productId: "p1",
    name: "Rice",
    inputMode: "money",
    quantity: 13000,
    unitPriceUgx: 4000,
    unitCostUgx: 2000,
    lineTotalUgx: 13000,
    estimatedProfitUgx: 5000,
    moneyAmountUgx: 13000,
    ...partial,
  });

  it("derives quantity from custom amount ÷ unit price", () => {
    expect(resolveSaleLineQuantity(moneyLine({ quantity: 13000 }))).toBe(3.25);
    expect(resolveSaleLineQuantity(moneyLine({ quantity: 3.25 }))).toBe(3.25);
  });

  it("keeps quantity mode lines unchanged", () => {
    const line: SaleLine = {
      id: "l1",
      productId: "p1",
      name: "Soap",
      inputMode: "quantity",
      quantity: 2,
      unitPriceUgx: 500,
      unitCostUgx: 300,
      lineTotalUgx: 1000,
      estimatedProfitUgx: 400,
    };
    expect(resolveSaleLineQuantity(line)).toBe(2);
  });
});

describe("buildReceiptLineQuantityDisplay", () => {
  const rice: Product = {
    id: "p1",
    name: "Rice",
    sellingPricePerUnitUgx: 4000,
    costPricePerUnitUgx: 2000,
    stockOnHand: 100,
    baseUnit: "kg",
    sellingMode: "weighted",
    category: "General",
    sku: "",
    minimumStockAlert: 0,
    version: 1,
    updatedAt: "",
  };

  it("shows fraction quantity with calculation for money lines", () => {
    const line: SaleLine = {
      id: "l1",
      productId: "p1",
      name: "Rice",
      inputMode: "money",
      quantity: 3.25,
      unitPriceUgx: 4000,
      unitCostUgx: 2000,
      lineTotalUgx: 13000,
      estimatedProfitUgx: 5000,
      moneyAmountUgx: 13000,
    };
    const display = buildReceiptLineQuantityDisplay(line, rice);
    expect(display.quantityLabel).toBe("3¼ kg");
    expect(display.showCalculation).toBe(true);
    expect(formatReceiptLineCalculation(display.quantityLabel, 4000, 13000)).toBe(
      "3¼ kg × UGX 4,000 = UGX 13,000",
    );
  });

  it("formats sale line quantity consistently", () => {
    const line: SaleLine = {
      id: "l1",
      productId: "p1",
      name: "Rice",
      inputMode: "money",
      quantity: 13000,
      unitPriceUgx: 4000,
      unitCostUgx: 2000,
      lineTotalUgx: 13000,
      estimatedProfitUgx: 5000,
      moneyAmountUgx: 13000,
    };
    expect(formatSaleLineQuantity(line, rice)).toBe("3¼ kg");
  });

  it("shows sell units on receipt for partial pack sales (1 kg from 100 kg sack)", () => {
    const kayiso: Product = {
      id: "p2",
      name: "kayiso",
      sellingPricePerUnitUgx: 4000,
      costPricePerUnitUgx: 3000,
      stockOnHand: 100,
      baseUnit: "kg",
      buyingUnit: "sack",
      conversionRate: 100,
      sellingMode: "weighted",
      category: "General",
      sku: "",
      minimumStockAlert: 0,
      version: 1,
      updatedAt: "",
    };
    const line: SaleLine = {
      id: "l2",
      productId: "p2",
      name: "kayiso",
      inputMode: "quantity",
      quantity: 1,
      unitPriceUgx: 4000,
      unitCostUgx: 3000,
      lineTotalUgx: 4000,
      estimatedProfitUgx: 1000,
      baseUnit: "kg",
    };
    const display = buildReceiptLineQuantityDisplay(line, kayiso);
    expect(display.quantityLabel).toBe("1 kg");
    expect(formatReceiptLineCalculation(display.quantityLabel, 4000, 4000)).toBe(
      "1 kg × UGX 4,000 = UGX 4,000",
    );
  });

  it("shows custom money amount as fractional kg on receipt", () => {
    const line: SaleLine = {
      id: "l3",
      productId: "p2",
      name: "kayiso",
      inputMode: "money",
      quantity: 1,
      unitPriceUgx: 4000,
      unitCostUgx: 3000,
      lineTotalUgx: 10000,
      estimatedProfitUgx: 2500,
      moneyAmountUgx: 10000,
      baseUnit: "kg",
    };
    const kayiso: Product = {
      id: "p2",
      name: "kayiso",
      sellingPricePerUnitUgx: 4000,
      costPricePerUnitUgx: 3000,
      stockOnHand: 100,
      baseUnit: "kg",
      buyingUnit: "sack",
      conversionRate: 100,
      sellingMode: "weighted",
      category: "General",
      sku: "",
      minimumStockAlert: 0,
      version: 1,
      updatedAt: "",
    };
    expect(buildReceiptLineQuantityDisplay(line, kayiso).quantityLabel).toBe("2½ kg");
  });
});
