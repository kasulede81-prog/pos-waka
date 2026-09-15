import { describe, expect, it } from "vitest";
import { deriveCorrectionFromPackCost, validateCorrectionForm } from "./financialCorrectionForm";

describe("deriveCorrectionFromPackCost", () => {
  it("matches the exact N&C basimat spec", () => {
    const { corrected, basis } = deriveCorrectionFromPackCost(
      { quantity: 2.5, packCostUgx: 75000, conversionRate: 25 },
      10000,
    );
    expect(corrected.unitCostUgx).toBe(3000);
    expect(corrected.cogsUgx).toBe(7500);
    expect(corrected.grossProfitUgx).toBe(2500);
    expect(corrected.estimatedProfitUgx).toBe(2500);
    expect(basis).toEqual({ basisType: "pack_cost_conversion", packCostUgx: 75000, conversionRate: 25 });
  });

  it("matches all 6 shop-1a110d2e lines from the approved correction batch", () => {
    // super: packCost 150000, conv 100, qty 1.25, revenue 2500 -> unitCost 1500, cogs 1875, profit 625
    expect(deriveCorrectionFromPackCost({ quantity: 1.25, packCostUgx: 150000, conversionRate: 100 }, 2500).corrected).toMatchObject({
      unitCostUgx: 1500,
      cogsUgx: 1875,
      grossProfitUgx: 625,
    });
    // 3 inch: packCost 200000, conv 50, qty 0.5, revenue 2500 -> unitCost 4000, cogs 2000, profit 500
    expect(deriveCorrectionFromPackCost({ quantity: 0.5, packCostUgx: 200000, conversionRate: 50 }, 2500).corrected).toMatchObject({
      unitCostUgx: 4000,
      cogsUgx: 2000,
      grossProfitUgx: 500,
    });
    // kayiso (both lines): packCost 330000, conv 100, qty 0.25, revenue 1000 -> unitCost 3300, cogs 825, profit 175
    expect(deriveCorrectionFromPackCost({ quantity: 0.25, packCostUgx: 330000, conversionRate: 100 }, 1000).corrected).toMatchObject({
      unitCostUgx: 3300,
      cogsUgx: 825,
      grossProfitUgx: 175,
    });
  });

  it("matches all 4 shop-8769f725 lines from the approved correction batch", () => {
    // Kakiri Sugar: packCost 70000, conv 25, qty 0.6, revenue 2400 -> unitCost 2800, cogs 1680, profit 720
    expect(deriveCorrectionFromPackCost({ quantity: 0.6, packCostUgx: 70000, conversionRate: 25 }, 2400).corrected).toMatchObject({
      unitCostUgx: 2800,
      cogsUgx: 1680,
      grossProfitUgx: 720,
    });
    // Beans: packCost 60000, conv 15, qty 0.5, revenue 2000 -> unitCost 4000, cogs 2000, profit 0
    expect(deriveCorrectionFromPackCost({ quantity: 0.5, packCostUgx: 60000, conversionRate: 15 }, 2000).corrected).toMatchObject({
      unitCostUgx: 4000,
      cogsUgx: 2000,
      grossProfitUgx: 0,
    });
    // Maize flour (both lines): packCost 44000, conv 20, qty 0.5, revenue 1250 -> unitCost 2200, cogs 1100, profit 150
    expect(deriveCorrectionFromPackCost({ quantity: 0.5, packCostUgx: 44000, conversionRate: 20 }, 1250).corrected).toMatchObject({
      unitCostUgx: 2200,
      cogsUgx: 1100,
      grossProfitUgx: 150,
    });
  });
});

describe("validateCorrectionForm", () => {
  const before = { unitCostUgx: 3600, cogsUgx: 9000, grossProfitUgx: 1000, estimatedProfitUgx: 1000 };
  const corrected = { unitCostUgx: 3000, cogsUgx: 7500, grossProfitUgx: 2500, estimatedProfitUgx: 2500 };

  it("requires a reason", () => {
    expect(validateCorrectionForm({ reason: "", before, corrected })).toBe("reason_required");
    expect(validateCorrectionForm({ reason: "  ", before, corrected })).toBe("reason_required");
  });

  it("rejects a too-short reason", () => {
    expect(validateCorrectionForm({ reason: "ok", before, corrected })).toBe("reason_too_short");
  });

  it("rejects a negative corrected cost", () => {
    expect(
      validateCorrectionForm({
        reason: "Pack cost was mis-entered at setup",
        before,
        corrected: { ...corrected, cogsUgx: -1 },
      }),
    ).toBe("negative_cost");
  });

  it("rejects a no-op correction (does not provide a generic fix-nothing path)", () => {
    expect(validateCorrectionForm({ reason: "Valid reason text", before, corrected: before })).toBe("cost_unchanged");
  });

  it("accepts a valid correction", () => {
    expect(
      validateCorrectionForm({ reason: "Pack cost was 75,000/25kg=3,000/kg at sale time", before, corrected }),
    ).toBeNull();
  });
});
