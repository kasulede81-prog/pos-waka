import { afterEach, describe, expect, it } from "vitest";
import {
  clearSaleStockEnforcement,
  markSaleEligibleForStockEnforcement,
  saleEligibleForStockEnforcement,
} from "./onlineSaleEnforcement";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

afterEach(() => {
  clearSaleStockEnforcement(A);
  clearSaleStockEnforcement(B);
});

describe("onlineSaleEnforcement registry", () => {
  it("is false by default (offline-safe: unknown sales are never enforced)", () => {
    expect(saleEligibleForStockEnforcement(A)).toBe(false);
  });

  it("marks and reads a sale as eligible", () => {
    markSaleEligibleForStockEnforcement(A);
    expect(saleEligibleForStockEnforcement(A)).toBe(true);
    expect(saleEligibleForStockEnforcement(B)).toBe(false);
  });

  it("clears eligibility after sync", () => {
    markSaleEligibleForStockEnforcement(A);
    clearSaleStockEnforcement(A);
    expect(saleEligibleForStockEnforcement(A)).toBe(false);
  });

  it("ignores empty ids", () => {
    markSaleEligibleForStockEnforcement("");
    expect(saleEligibleForStockEnforcement("")).toBe(false);
  });
});
