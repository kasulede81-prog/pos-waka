import { describe, expect, it } from "vitest";
import { draftQuantityExceedsStock, mergedDraftQuantity } from "./draftStockCheck";
import type { Product, SaleLine } from "../types";

const product = (stockOnHand: number): Product =>
  ({
    id: "p1",
    stockOnHand,
  }) as Product;

const line = (quantity: number): SaleLine =>
  ({
    productId: "p1",
    quantity,
  }) as SaleLine;

describe("draftStockCheck", () => {
  it("flags quantity above stock", () => {
    expect(draftQuantityExceedsStock(product(5), 6)).toBe(true);
    expect(draftQuantityExceedsStock(product(5), 5)).toBe(false);
  });

  it("merges draft quantities", () => {
    expect(mergedDraftQuantity(undefined, 2)).toBe(2);
    expect(mergedDraftQuantity(line(3), 2)).toBe(5);
  });
});
