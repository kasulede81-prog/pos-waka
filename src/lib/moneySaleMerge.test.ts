import { describe, expect, it } from "vitest";
import type { Product, SaleLine } from "../types";
import {
  mergeDraftSaleLine,
  mergeMoneyDraftSaleLine,
  rebuildDraftLineQuantity,
  shouldMergeDraftSaleLines,
} from "./draftCart";
import { buildSaleLine } from "./sellingEngine";
import { totalDraftQuantityForProduct } from "./draftStockCheck";

const rice: Product = {
  id: "rice",
  name: "Rice",
  sellingMode: "unit",
  baseUnit: "kg",
  sellingPricePerUnitUgx: 4000,
  costPricePerUnitUgx: 2500,
  stockOnHand: 100,
  minimumStockAlert: 5,
  category: "Food",
  sku: "",
  updatedAt: "2026-06-11T08:00:00.000Z",
  version: 1,
};

function moneyLine(amount: number): SaleLine {
  const built = buildSaleLine(rice, "money", amount);
  expect(built.line).toBeTruthy();
  return built.line!;
}

describe("shouldMergeDraftSaleLines", () => {
  it("merges quantity with quantity only", () => {
    const qty = buildSaleLine(rice, "quantity", 2).line!;
    expect(shouldMergeDraftSaleLines(qty, buildSaleLine(rice, "quantity", 1).line!)).toBe(true);
  });

  it("never merges money mode lines (Option A)", () => {
    const m1 = moneyLine(5000);
    const m2 = moneyLine(5000);
    expect(shouldMergeDraftSaleLines(m1, m2)).toBe(false);
  });

  it("never merges money with quantity", () => {
    const m = moneyLine(5000);
    const q = buildSaleLine(rice, "quantity", 1).line!;
    expect(shouldMergeDraftSaleLines(m, q)).toBe(false);
    expect(shouldMergeDraftSaleLines(q, m)).toBe(false);
  });
});

describe("money sale merge — Option A (keep separate)", () => {
  it("two UGX 5,000 money sales stay as separate lines when not merged", () => {
    const m1 = moneyLine(5000);
    const m2 = moneyLine(5000);
    expect(m1.inputMode).toBe("money");
    expect(m2.inputMode).toBe("money");
    expect(m1.lineTotalUgx).toBe(5000);
    expect(m2.lineTotalUgx).toBe(5000);
    expect(m1.quantity).toBeCloseTo(1.25, 4);
    expect(m2.quantity).toBeCloseTo(1.25, 4);
  });

  it("stock check sums all draft lines for same product", () => {
    const m1 = moneyLine(5000);
    const m2 = moneyLine(5000);
    const total = totalDraftQuantityForProduct([m1, m2], rice.id, undefined, moneyLine(5000));
    expect(total).toBeCloseTo(3.75, 4);
  });
});

describe("money sale merge — Option B (explicit merge)", () => {
  it("merges money lines by summing amounts and recalculating once", () => {
    const m1 = moneyLine(5000);
    const m2 = moneyLine(5000);
    const merged = mergeMoneyDraftSaleLine(m1, m2, rice);
    expect(merged.inputMode).toBe("money");
    expect(merged.lineTotalUgx).toBe(10_000);
    expect(merged.moneyAmountUgx).toBe(10_000);
    expect(merged.quantity).toBe(2.5);
    expect(merged.quantity * rice.sellingPricePerUnitUgx).toBe(10_000);
  });

  it("mergeDraftSaleLine uses Option B when both lines are money", () => {
    const m1 = moneyLine(5000);
    const m2 = moneyLine(5000);
    const merged = mergeDraftSaleLine(m1, m2, rice);
    expect(merged.inputMode).toBe("money");
    expect(merged.lineTotalUgx).toBe(10_000);
  });
});

describe("rebuildDraftLineQuantity", () => {
  it("refuses to rebuild a money-mode line", () => {
    const m = moneyLine(5000);
    expect(rebuildDraftLineQuantity(rice, 2, m)).toBeNull();
  });

  it("quantity merge preserves quantity mode", () => {
    const q1 = buildSaleLine(rice, "quantity", 2).line!;
    const q2 = buildSaleLine(rice, "quantity", 1).line!;
    const merged = mergeDraftSaleLine(q1, q2, rice);
    expect(merged.inputMode).toBe("quantity");
    expect(merged.quantity).toBe(3);
    expect(merged.lineTotalUgx).toBe(12_000);
  });
});

describe("rice money sale example", () => {
  it("UGX 5,000 + UGX 5,000 = UGX 10,000 with quantity 2.5 kg when merged", () => {
    const merged = mergeMoneyDraftSaleLine(moneyLine(5000), moneyLine(5000), rice);
    expect(merged.lineTotalUgx).toBe(10_000);
    expect(merged.quantity).toBe(2.5);
  });

  it("separate lines preserve exact UGX amounts", () => {
    const lines = [moneyLine(5000), moneyLine(5000)];
    expect(lines.reduce((a, l) => a + l.lineTotalUgx, 0)).toBe(10_000);
    expect(lines.every((l) => l.inputMode === "money")).toBe(true);
  });
});
