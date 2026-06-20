import { describe, expect, it } from "vitest";
import {
  buildFinanceDiagnosticRows,
  computeCostValidationPreview,
  filterFinanceDiagnosticRows,
  getCostValidationWarnings,
  sortFinanceDiagnosticRows,
  summarizeFinanceHealth,
  unitCostFromPack,
} from "./costValidation";

describe("unitCostFromPack", () => {
  it("keeps decimal precision from pack ÷ pieces", () => {
    expect(unitCostFromPack(20_000, 24)).toBeCloseTo(833.3333333333, 8);
    expect(unitCostFromPack(37_500, 48)).toBeCloseTo(781.25, 4);
  });
});

describe("computeCostValidationPreview", () => {
  it("builds preview from pack inputs with exact unit cost", () => {
    const p = computeCostValidationPreview({
      packCostUgx: 20_000,
      piecesPerPack: 24,
      sellPriceUgx: 1000,
    });
    expect(p.unitCostUgx).toBeCloseTo(833.3333333333, 8);
    expect(p.profitPerUnitUgx).toBeCloseTo(166.6666666667, 4);
    expect(p.marginPct).toBeCloseTo(16.7, 1);
  });

  it("builds preview from direct unit cost", () => {
    const p = computeCostValidationPreview({
      unitCostUgx: 84,
      sellPriceUgx: 1000,
    });
    expect(p.unitCostUgx).toBe(84);
    expect(p.profitPerUnitUgx).toBe(916);
    expect(p.marginPct).toBe(91.6);
  });
});

describe("getCostValidationWarnings", () => {
  it("warns when unit cost is below 10% of sell price", () => {
    const preview = computeCostValidationPreview({ unitCostUgx: 84, sellPriceUgx: 1000 });
    expect(getCostValidationWarnings(preview)).toContain("low_unit_cost");
    expect(getCostValidationWarnings(preview)).toContain("high_margin");
  });

  it("does not warn for healthy margin on crate breakdown", () => {
    const preview = computeCostValidationPreview({
      packCostUgx: 20_000,
      piecesPerPack: 24,
      sellPriceUgx: 1000,
    });
    expect(getCostValidationWarnings(preview)).toEqual([]);
  });
});

describe("finance diagnostic rows", () => {
  it("sorts by lowest cost and highest margin", () => {
    const rows = buildFinanceDiagnosticRows([
      {
        id: "a",
        name: "A",
        stockOnHand: 10,
        costPricePerUnitUgx: 500,
        sellingPricePerUnitUgx: 1000,
      },
      {
        id: "b",
        name: "B",
        stockOnHand: 5,
        costPricePerUnitUgx: 50,
        sellingPricePerUnitUgx: 1000,
      },
    ]);
    expect(sortFinanceDiagnosticRows(rows, "lowest_cost")[0]?.productId).toBe("b");
    expect(sortFinanceDiagnosticRows(rows, "highest_margin")[0]?.productId).toBe("b");
    expect(rows[0]?.stockValueUgx).toBe(5000);
  });

  it("classifies suspicious low cost as critical", () => {
    const rows = buildFinanceDiagnosticRows([
      {
        id: "soda",
        name: "Soda",
        stockOnHand: 24,
        costPricePerUnitUgx: 84,
        sellingPricePerUnitUgx: 1000,
      },
    ]);
    expect(rows[0]?.severity).toBe("critical");
    expect(rows[0]?.flags).toContain("unit_cost_under_10pct");
    expect(rows[0]?.flags).toContain("margin_over_80");
  });

  it("values pack stock at full pack cost when metadata present", () => {
    const rows = buildFinanceDiagnosticRows([
      {
        id: "crate",
        name: "Soda crate",
        stockOnHand: 24,
        costPricePerUnitUgx: 20_000 / 24,
        sellingPricePerUnitUgx: 1000,
        buyingPackCostUgx: 20_000,
        conversionRate: 24,
      },
    ]);
    expect(rows[0]?.stockValueUgx).toBe(20_000);
  });

  it("filters and summarizes health counts", () => {
    const rows = buildFinanceDiagnosticRows([
      {
        id: "a",
        name: "A",
        stockOnHand: 1,
        costPricePerUnitUgx: 0,
        sellingPricePerUnitUgx: 1000,
      },
      {
        id: "b",
        name: "B",
        stockOnHand: 2,
        costPricePerUnitUgx: 100,
        sellingPricePerUnitUgx: 1000,
      },
    ]);
    const health = summarizeFinanceHealth(rows);
    expect(health.missingCost).toBe(1);
    expect(filterFinanceDiagnosticRows(rows, "cost_zero")).toHaveLength(1);
  });
});
