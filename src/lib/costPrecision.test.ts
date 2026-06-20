import { describe, expect, it } from "vitest";
import {
  advancePackCostUnitsDepleted,
  costPerBaseFromBuyingUnitCostPrecise,
  formatUgxDisplay,
  inventoryLineValueAtCostUgx,
  inventoryValueAtCostUgx,
  lineCostForProductQuantity,
  lineCostFromPackAllocation,
  lineCostFromPackSlots,
  lineCostUgx,
  lineProfitUgx,
  packSlotUnitCostUgx,
  retractPackCostUnitsDepleted,
  unitCostFromPackTotal,
  weightedCostAfterStockInPrecise,
} from "./costPrecision";

describe("crate breakdown (20_000 / 24)", () => {
  const packCost = 20_000;
  const units = 24;
  const sellPrice = 1_000;

  it("stores exact unit cost, not floored 833", () => {
    const unitCost = unitCostFromPackTotal(packCost, units);
    expect(unitCost).toBeCloseTo(833.3333333333, 8);
    expect(Math.floor(unitCost)).toBe(833);
  });

  it("full crate sale profit equals 4_000 UGX", () => {
    const product = {
      costPricePerUnitUgx: unitCostFromPackTotal(packCost, units),
      buyingPackCostUgx: packCost,
      conversionRate: units,
    };
    const revenue = sellPrice * units;
    const cost = lineCostForProductQuantity(product, units);
    expect(cost).toBe(20_000);
    expect(lineProfitUgx(revenue, cost)).toBe(4_000);
  });

  it("pack allocation matches parent cost for full pack quantity", () => {
    expect(lineCostFromPackAllocation(packCost, units, units)).toBe(20_000);
    expect(lineCostFromPackSlots(packCost, units, 0, 12)).toBe(10_004);
    expect(lineCostFromPackSlots(packCost, units, 12, 12)).toBe(9_996);
    expect(lineCostFromPackSlots(packCost, units, 0, 12) + lineCostFromPackSlots(packCost, units, 12, 12)).toBe(
      20_000,
    );
  });

  it("inventory values full crate stock at pack cost", () => {
    const product = {
      stockOnHand: 24,
      costPricePerUnitUgx: unitCostFromPackTotal(packCost, units),
      buyingPackCostUgx: packCost,
      conversionRate: units,
    };
    expect(inventoryLineValueAtCostUgx(product)).toBe(20_000);
  });

  it("24 separate unit sales sum exactly to pack cost (zero COGS drift)", () => {
    let depleted = 0;
    let totalCogs = 0;
    const product = {
      costPricePerUnitUgx: unitCostFromPackTotal(packCost, units),
      buyingPackCostUgx: packCost,
      conversionRate: units,
      packCostUnitsDepleted: 0,
    };
    for (let i = 0; i < units; i++) {
      const cogs = lineCostForProductQuantity(product, 1, undefined, depleted);
      totalCogs += cogs;
      depleted = advancePackCostUnitsDepleted(depleted, 1);
      product.packCostUnitsDepleted = depleted;
    }
    expect(totalCogs).toBe(20_000);
    expect(depleted).toBe(24);
  });

  it("remainder slots absorb extra UGX (8×834 + 16×833)", () => {
    const slotCosts = Array.from({ length: units }, (_, i) => packSlotUnitCostUgx(packCost, units, i));
    expect(slotCosts.filter((c) => c === 834).length).toBe(8);
    expect(slotCosts.filter((c) => c === 833).length).toBe(16);
    expect(slotCosts.reduce((a, b) => a + b, 0)).toBe(20_000);
  });

  it("partial inventory valuation stays exact after selling half the crate", () => {
    const product = {
      stockOnHand: 12,
      costPricePerUnitUgx: unitCostFromPackTotal(packCost, units),
      buyingPackCostUgx: packCost,
      conversionRate: units,
      packCostUnitsDepleted: 12,
    };
    expect(inventoryLineValueAtCostUgx(product)).toBe(9_996);
    expect(lineCostFromPackSlots(packCost, units, 12, 12)).toBe(9_996);
    expect(lineCostFromPackSlots(packCost, units, 0, 12) + inventoryLineValueAtCostUgx(product)).toBe(20_000);
  });

  it("void/return retract restores slot allocation", () => {
    let depleted = advancePackCostUnitsDepleted(0, 5);
    depleted = retractPackCostUnitsDepleted(depleted, 2);
    expect(depleted).toBe(3);
    const cogs = lineCostFromPackSlots(packCost, units, depleted, 1);
    expect(cogs).toBe(packSlotUnitCostUgx(packCost, units, 3));
  });
});

describe("carton (37_500 / 48)", () => {
  it("derives exact unit cost and full-carton COGS", () => {
    const packCost = 37_500;
    const units = 48;
    const unitCost = unitCostFromPackTotal(packCost, units);
    expect(unitCost).toBeCloseTo(781.25, 4);
    const product = {
      costPricePerUnitUgx: unitCost,
      buyingPackCostUgx: packCost,
      conversionRate: units,
    };
    expect(lineCostForProductQuantity(product, units)).toBe(37_500);
  });
});

describe("bakery tray (15_000 / 20 rolls)", () => {
  it("profit on full tray matches invoice minus revenue", () => {
    const packCost = 15_000;
    const units = 20;
    const sellEach = 900;
    const product = {
      costPricePerUnitUgx: unitCostFromPackTotal(packCost, units),
      buyingPackCostUgx: packCost,
      conversionRate: units,
    };
    const revenue = sellEach * units;
    const cost = lineCostForProductQuantity(product, units);
    expect(cost).toBe(15_000);
    expect(lineProfitUgx(revenue, cost)).toBe(revenue - 15_000);
  });
});

describe("sack / kg weighted (100_000 / 50 kg)", () => {
  it("derives fractional cost per kg", () => {
    expect(unitCostFromPackTotal(100_000, 50)).toBe(2_000);
    expect(lineCostUgx(2_000, 2.5)).toBe(5_000);
  });
});

describe("weighted average restock", () => {
  it("keeps decimal precision in running average", () => {
    const avg = weightedCostAfterStockInPrecise(10, 833.3333333333, 14, 850);
    expect(avg).toBeCloseTo(843.0555555555, 4);
  });
});

describe("costPerBaseFromBuyingUnitCostPrecise", () => {
  it("matches pack breakdown without rounding unit cost", () => {
    expect(costPerBaseFromBuyingUnitCostPrecise(24, 20_000)).toBeCloseTo(833.3333333333, 8);
  });
});

describe("display rounding", () => {
  it("rounds only for display", () => {
    expect(formatUgxDisplay(833.3333333333)).toBe(833);
    expect(formatUgxDisplay(4000.4)).toBe(4000);
  });
});

describe("inventoryValueAtCostUgx", () => {
  it("sums pack-aware line values", () => {
    const total = inventoryValueAtCostUgx([
      {
        stockOnHand: 24,
        costPricePerUnitUgx: unitCostFromPackTotal(20_000, 24),
        buyingPackCostUgx: 20_000,
        conversionRate: 24,
      },
      {
        stockOnHand: 10,
        costPricePerUnitUgx: 500,
        conversionRate: null,
      },
    ]);
    expect(total).toBe(20_000 + 5_000);
  });
});
