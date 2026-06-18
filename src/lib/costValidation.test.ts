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
  it("divides pack cost by pieces", () => {
    expect(unitCostFromPack(19992, 24)).toBe(833);
    expect(unitCostFromPack(1992, 24)).toBe(83);
  });
});

describe("computeCostValidationPreview", () => {
  it("builds preview from pack inputs", () => {
    const p = computeCostValidationPreview({
      packCostUgx: 19992,
      piecesPerPack: 24,
      sellPriceUgx: 1000,
    });
    expect(p.unitCostUgx).toBe(833);
    expect(p.profitPerUnitUgx).toBe(167);
    expect(p.marginPct).toBe(16.7);
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

  it("does not warn for healthy margin", () => {
    const preview = computeCostValidationPreview({
      packCostUgx: 19992,
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
