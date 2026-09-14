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

  it("inventory values full crate stock at current cost (coincides with pack cost here, since the stored unit cost carries full precision)", () => {
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

  it("SALE COGS: partial pack-slot COGS still stays exact after selling half the crate (unchanged by the inventory-valuation fix)", () => {
    // This is the FIFO slot invariant that must survive untouched: sold COGS
    // (12 slots) + remaining-slots COGS (12 slots) == the original pack cost.
    // It exercises `lineCostForProductQuantity`/`lineCostFromPackSlots`
    // directly — the sale-COGS path — not `inventoryLineValueAtCostUgx`.
    const product = {
      costPricePerUnitUgx: unitCostFromPackTotal(packCost, units),
      buyingPackCostUgx: packCost,
      conversionRate: units,
      packCostUnitsDepleted: 12,
    };
    const remainingSlotsCogs = lineCostForProductQuantity(product, 12, undefined, 12);
    expect(remainingSlotsCogs).toBe(9_996);
    expect(lineCostFromPackSlots(packCost, units, 12, 12)).toBe(9_996);
    expect(lineCostFromPackSlots(packCost, units, 0, 12) + remainingSlotsCogs).toBe(20_000);
  });

  it("INVENTORY VALUE: after selling half the crate, remaining stock values at CURRENT cost, not remaining pack-slot cost", () => {
    // Deliberate behavior change from the old pack-slot-aware formula: the
    // 12 remaining units are now worth 12 × costPricePerUnitUgx (10,000),
    // not the 9,996 the old FIFO-slot remainder happened to compute. This is
    // the fix — a stale/rounded per-unit cost or a mid-pack sale no longer
    // makes "Stock value" disagree with stockOnHand × costPricePerUnitUgx,
    // which is what the Products table/export already show.
    const product = {
      stockOnHand: 12,
      costPricePerUnitUgx: unitCostFromPackTotal(packCost, units),
      buyingPackCostUgx: packCost,
      conversionRate: units,
      packCostUnitsDepleted: 12,
    };
    expect(inventoryLineValueAtCostUgx(product)).toBe(10_000);
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

describe("inventoryValueAtCostUgx — current-cost inventory valuation", () => {
  /**
   * INCIDENT: Inventory Overview "Stock value" previously routed through
   * `lineCostForProductQuantity` (the pack-cost/FIFO path built for SALE
   * COGS), which prefers a stored `buyingPackCostUgx` over the live
   * `costPricePerUnitUgx` whenever one is present. `recordPurchase`
   * (usePosStore.ts) only recomputes `costPricePerUnitUgx` on restock and
   * never touches `buyingPackCostUgx`, so a pack-priced product's stale
   * invoice total could silently understate its current stock value versus
   * what the Products table/CSV export (which read `costPricePerUnitUgx`
   * directly) showed for the same product.
   *
   * Fix: inventory valuation is now always `stockOnHand × costPricePerUnitUgx`
   * — it no longer reads `buyingPackCostUgx`/`conversionRate` at all. Sale-line
   * COGS (`lineCostForProductQuantity`, tested separately below and
   * elsewhere in this file) is untouched — these are deliberately different
   * questions with different formulas.
   */

  it("TEST 1 — controlled 3-product case: 240×875 + 370×500 + 100×3000 = 695,000", () => {
    const total = inventoryValueAtCostUgx([
      { stockOnHand: 240, costPricePerUnitUgx: 875 },
      { stockOnHand: 370, costPricePerUnitUgx: 500 },
      { stockOnHand: 100, costPricePerUnitUgx: 3_000 },
    ]);
    expect(total).toBe(695_000);
  });

  it("TEST 2 — exact post-sale case: 216×875 + 367×500 + 97.5×3000 = 665,000", () => {
    const total = inventoryValueAtCostUgx([
      { stockOnHand: 216, costPricePerUnitUgx: 875 },
      { stockOnHand: 367, costPricePerUnitUgx: 500 },
      { stockOnHand: 97.5, costPricePerUnitUgx: 3_000 },
    ]);
    expect(total).toBe(665_000);
  });

  it("TEST 3 — a stale buyingPackCostUgx is ignored; current cost wins", () => {
    // 1 sack = 100kg, current cost 3,000/kg, but an old invoice recorded
    // buyingPackCostUgx=225,000 (2,250/kg) that a later restock never updated.
    const value = inventoryLineValueAtCostUgx({
      stockOnHand: 100,
      costPricePerUnitUgx: 3_000,
      // @ts-expect-error — intentionally passing the now-unused legacy pack
      // fields to prove they have zero effect on the result.
      conversionRate: 100,
      buyingPackCostUgx: 225_000,
    });
    expect(value).toBe(300_000);
    expect(value).not.toBe(225_000);
  });

  it("TEST 4 — a buyingPackCostUgx that still agrees with current cost gives the same answer", () => {
    const value = inventoryLineValueAtCostUgx({
      stockOnHand: 100,
      costPricePerUnitUgx: 3_000,
      // @ts-expect-error — same as above: present but unused.
      conversionRate: 100,
      buyingPackCostUgx: 300_000,
    });
    expect(value).toBe(300_000);
  });

  it("TEST 5 — zero stock contributes zero regardless of pack metadata", () => {
    const value = inventoryLineValueAtCostUgx({
      stockOnHand: 0,
      costPricePerUnitUgx: 3_000,
      // @ts-expect-error — present but unused.
      conversionRate: 100,
      buyingPackCostUgx: 300_000,
    });
    expect(value).toBe(0);
  });

  it("REGRESSION — a non-pack product values the same as before (no behavior change for the common case)", () => {
    const total = inventoryValueAtCostUgx([
      { stockOnHand: 24, costPricePerUnitUgx: unitCostFromPackTotal(20_000, 24) },
      { stockOnHand: 10, costPricePerUnitUgx: 500 },
    ]);
    // 24 * (20_000/24) rounds back to exactly 20_000 when the stored cost
    // carries full precision (no staleness/rounding drift in this fixture).
    expect(total).toBe(20_000 + 5_000);
  });
});

describe("sale-line COGS via lineCostForProductQuantity — unaffected by the inventory-valuation fix", () => {
  it("a pack-priced product's FULL-pack sale still sums exactly to buyingPackCostUgx (FIFO, unchanged)", () => {
    const product = {
      costPricePerUnitUgx: 833, // a rounded display cost, deliberately NOT 20_000/24
      buyingPackCostUgx: 20_000,
      conversionRate: 24,
      packCostUnitsDepleted: 0,
    };
    // This is the exact function sale finalization calls — proves it still
    // prefers the precise pack invoice total over the rounded display cost,
    // which is the correct behavior for COGS (unchanged by this fix).
    expect(lineCostForProductQuantity(product, 24)).toBe(20_000);
  });

  it("a partial-pack sale still FIFO-allocates against buyingPackCostUgx (unchanged)", () => {
    const product = {
      costPricePerUnitUgx: 833,
      buyingPackCostUgx: 20_000,
      conversionRate: 24,
      packCostUnitsDepleted: 0,
    };
    // 12 of 24 slots from a 20,000 pack (833 base + 1 for the first 8 remainder slots)
    const cost = lineCostForProductQuantity(product, 12);
    expect(cost).toBe(20_000 - lineCostFromPackSlots(20_000, 24, 12, 12));
    expect(cost + lineCostFromPackSlots(20_000, 24, 12, 12)).toBe(20_000);
  });
});
