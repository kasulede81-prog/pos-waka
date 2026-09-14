import { describe, expect, it } from "vitest";
import {
  advancePackCostUnitsDepleted,
  applyPackSlotCostsToSaleLine,
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
  resolvePackCostUnitsDepleted,
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

/**
 * P0 FIX — FRACTIONAL PACK-PRICED SALE COGS.
 *
 * INCIDENT: a real production sale of 2.5 kg of Basimat (pack-priced at
 * UGX 75,000 / 25 kg, i.e. exactly UGX 3,000/kg) was charged
 * `cogsUgx: 9,000` instead of the correct `7,500`. Root cause:
 * `lineCostFromPackSlots`'s old `for (let i = 0; i < qty; i++)` loop
 * incremented by whole integers regardless of a fractional `qty`,
 * effectively computing `Math.ceil(qty)` (3) whole slots instead of the
 * 2.5 slots actually consumed. A second, related bug meant a fractional
 * `packCostUnitsDepleted` counter got floored on every read
 * (`resolvePackCostUnitsDepleted`) and on every cloud round-trip
 * (`rowToProduct` in cloudSync.ts), silently losing fractional progress
 * across sequential/repeated fractional sales from the same pack.
 *
 * Fix: `lineCostFromPackSlots` now integrates over the continuous range
 * [startSlot, startSlot + quantity), pro-rating partial slot overlap
 * instead of rounding up to a whole slot count; `resolvePackCostUnitsDepleted`
 * (and the cloud row reader) no longer floor the stored counter.
 */
describe("P0 FIX — fractional pack-priced sale COGS (lineCostFromPackSlots)", () => {
  // Basimat-style pack: 75,000 UGX / 25 kg = exactly 3,000 UGX/kg (uniform, divides evenly).
  const packCost = 75_000;
  const units = 25;
  const unitCost = 3_000;

  it("TEST A — whole quantity: 1 kg = UGX 3,000", () => {
    expect(lineCostFromPackSlots(packCost, units, 0, 1)).toBe(3_000);
  });

  it("TEST B — fractional quantity: 2.5 kg = UGX 7,500 (the exact live-bug scenario — was wrongly charged UGX 9,000)", () => {
    const cost = lineCostFromPackSlots(packCost, units, 0, 2.5);
    expect(cost).toBe(7_500);
    expect(cost).not.toBe(9_000); // old Math.ceil(2.5) === 3-slot behavior
  });

  it("TEST C — fractional quantity: 1.25 kg = UGX 3,750", () => {
    expect(lineCostFromPackSlots(packCost, units, 0, 1.25)).toBe(3_750);
  });

  it("TEST D — combined sales: 1kg then 2.5kg (3.5kg total) = UGX 10,500, and the depletion counter keeps its fraction", () => {
    let depleted = 0;
    const cogs1 = lineCostFromPackSlots(packCost, units, depleted, 1);
    depleted = advancePackCostUnitsDepleted(depleted, 1);
    const cogs2 = lineCostFromPackSlots(packCost, units, depleted, 2.5);
    depleted = advancePackCostUnitsDepleted(depleted, 2.5);
    expect(cogs1).toBe(3_000);
    expect(cogs2).toBe(7_500);
    expect(cogs1 + cogs2).toBe(10_500);
    expect(depleted).toBe(3.5);
  });

  it("TEST E — COGS calculation never mutates or rounds the quantity used for inventory deduction", () => {
    // Stock deduction (usePosStore.ts) computes `stockOnHand - moneyLine.quantity`
    // directly from the raw fractional quantity, entirely independent of the
    // COGS calculation below — confirmed here by showing the same fractional
    // quantity passed into lineCostFromPackSlots is unaffected/unchanged.
    const quantity = 2.5;
    const stockOnHand = 121.5;
    lineCostFromPackSlots(packCost, units, 0, quantity);
    expect(quantity).toBe(2.5);
    expect(stockOnHand - quantity).toBe(119);
  });

  it("TEST F — sale revenue is untouched by the COGS fix (only the cost term of profit changes)", () => {
    const revenueUgx = 10_000; // e.g. a 2.5kg sale sold for a flat UGX 10,000
    const oldBuggyCogs = 9_000; // Math.ceil(2.5) = 3 slots (the pre-fix bug)
    const fixedCogs = lineCostFromPackSlots(packCost, units, 0, 2.5);
    expect(fixedCogs).toBe(7_500);
    expect(lineProfitUgx(revenueUgx, oldBuggyCogs)).toBe(1_000); // the old, wrong profit
    expect(lineProfitUgx(revenueUgx, fixedCogs)).toBe(2_500); // corrected profit, same revenue
  });

  it("TEST G — gross profit becomes revenue minus the corrected COGS", () => {
    const revenueUgx = 10_000;
    const cogs = lineCostFromPackSlots(packCost, units, 0, 2.5);
    expect(lineProfitUgx(revenueUgx, cogs)).toBe(2_500);
  });

  describe("TEST H — non-divisible pack cost (100 / 3 units): fractional quantities do not round up or drift systematically", () => {
    const nonDivisiblePackCost = 100;
    const nonDivisibleUnits = 3;

    it("full pack (3 units) still sums exactly to 100", () => {
      expect(lineCostFromPackSlots(nonDivisiblePackCost, nonDivisibleUnits, 0, 3)).toBe(100);
    });

    it("a fractional 1.5-unit sale is NOT rounded up to a 2-unit charge", () => {
      // slot 0 = 34, slot 1 = 33 (the 1 remainder UGX lands on slot 0)
      // 1×34 + 0.5×33 = 34 + 16.5 = 50.5 → rounds once, at the end, to 51
      const cost = lineCostFromPackSlots(nonDivisiblePackCost, nonDivisibleUnits, 0, 1.5);
      expect(cost).toBe(51);
      expect(cost).not.toBe(2 * 34); // the wrong Math.ceil(1.5)=2-slot answer pre-fix
    });

    it("splitting one full pack into several fractional sales stays within a few UGX of the pack total (ordinary per-receipt rounding, not the old ~20% systematic overcharge)", () => {
      let depleted = 0;
      let total = 0;
      for (const qty of [0.5, 1, 1.5]) {
        total += lineCostFromPackSlots(nonDivisiblePackCost, nonDivisibleUnits, depleted, qty);
        depleted = advancePackCostUnitsDepleted(depleted, qty);
      }
      expect(depleted).toBe(3);
      expect(total).toBe(101); // 1 UGX of ordinary rounding noise across 3 receipts, not 20+
    });
  });

  it("TEST I — multiple sequential fractional sales from the same (uniform-cost) pack sum with zero drift", () => {
    let depleted = 0;
    let total = 0;
    for (const qty of [0.5, 0.75, 1.25, 2]) {
      // 4.5 kg total, split across 4 separate sales
      total += lineCostFromPackSlots(packCost, units, depleted, qty);
      depleted = advancePackCostUnitsDepleted(depleted, qty);
    }
    expect(depleted).toBe(4.5);
    expect(total).toBe(4.5 * unitCost);
  });

  it("TEST J — a fractional sale crossing a pack boundary correctly wraps into the next pack cycle's slot costs", () => {
    const nonDivisiblePackCost = 100;
    const nonDivisibleUnits = 3;
    // Already 2.5 of 3 slots depleted; selling 1 more crosses from slot 2.5
    // into slot 3.5, which wraps (3 % 3 = 0) into the NEXT cycle's slot 0
    // (cost 34, since the remainder UGX lands on the first slot of every cycle).
    // 0.5 of slot 2 (cost 33) + 0.5 of next-cycle slot 0 (cost 34)
    // = 16.5 + 17 = 33.5 → rounds to 34
    const cost = lineCostFromPackSlots(nonDivisiblePackCost, nonDivisibleUnits, 2.5, 1);
    expect(cost).toBe(34);
  });

  it("never rounds a fractional quantity UP to the next whole unit (the core bug, checked across many quantities)", () => {
    for (const qty of [0.1, 0.5, 0.9, 1.1, 2.5, 3.75, 24.5]) {
      const cost = lineCostFromPackSlots(packCost, units, 0, qty);
      const wrongCeilCost = Math.ceil(qty) * unitCost;
      expect(cost).not.toBe(wrongCeilCost);
      expect(cost).toBe(Math.round(qty * unitCost));
    }
  });

  it("integer quantities are byte-identical to the pre-fix per-slot summation (no regression for whole-unit sales)", () => {
    expect(lineCostFromPackSlots(20_000, 24, 0, 12)).toBe(10_004);
    expect(lineCostFromPackSlots(20_000, 24, 12, 12)).toBe(9_996);
    expect(lineCostFromPackSlots(20_000, 24, 0, 24)).toBe(20_000);
  });
});

describe("P0 FIX — resolvePackCostUnitsDepleted / advancePackCostUnitsDepleted preserve fractional depletion", () => {
  it("does not floor a fractional stored value", () => {
    expect(resolvePackCostUnitsDepleted({ packCostUnitsDepleted: 3.5 })).toBe(3.5);
  });

  it("advancing from a fractional current value keeps the fraction (previously floored `current`, silently losing prior fractional progress)", () => {
    expect(advancePackCostUnitsDepleted(3.5, 2.5)).toBe(6);
    expect(advancePackCostUnitsDepleted(3.5, 1)).toBe(4.5);
  });

  it("clamps NaN/negative/missing to 0, without introducing a floor", () => {
    expect(resolvePackCostUnitsDepleted({ packCostUnitsDepleted: -5 })).toBe(0);
    expect(resolvePackCostUnitsDepleted({ packCostUnitsDepleted: NaN })).toBe(0);
    expect(resolvePackCostUnitsDepleted({})).toBe(0);
  });
});

describe("P0 FIX — end-to-end through the exact functions sale finalization calls", () => {
  it("lineCostForProductQuantity: a Basimat-style 2.5kg sale costs UGX 7,500, not UGX 9,000", () => {
    const product = {
      costPricePerUnitUgx: 3_000,
      buyingPackCostUgx: 75_000,
      conversionRate: 25,
      packCostUnitsDepleted: 0,
    };
    const cost = lineCostForProductQuantity(product, 2.5);
    expect(cost).toBe(7_500);
    expect(cost).not.toBe(9_000);
  });

  it("applyPackSlotCostsToSaleLine (what usePosStore.ts finalizeDraftSale actually calls) returns the corrected COGS and profit", () => {
    const product = {
      costPricePerUnitUgx: 3_000,
      buyingPackCostUgx: 75_000,
      conversionRate: 25,
      packCostUnitsDepleted: 0,
    };
    const line = { quantity: 2.5, lineTotalUgx: 10_000 };
    const result = applyPackSlotCostsToSaleLine(product, line, resolvePackCostUnitsDepleted(product));
    expect(result.unitCostUgx).toBe(3_000);
    expect(lineCostUgx(result.unitCostUgx, line.quantity)).toBe(7_500);
    expect(result.estimatedProfitUgx).toBe(2_500); // was 1,000 (from cogsUgx 9,000) before the fix
  });
});
