import { describe, expect, it } from "vitest";
import {
  buildHospitalityKitchenPdfBlob,
  buildHospitalityMenuPdfBlob,
  buildHospitalityTableRevenuePdfBlob,
  buildHospitalityWaiterPdfBlob,
} from "./hospitalityDocumentExports";
import type { HospitalityReportSummary } from "./hospitalityReports";

const sample: HospitalityReportSummary = {
  completedBillCount: 3,
  totalRevenueUgx: 30_000,
  avgBillUgx: 10_000,
  waiters: [{ waiterId: "w1", label: "Ali", billCount: 2, revenueUgx: 20_000, avgBillUgx: 10_000 }],
  categoryMix: [{ kind: "food", revenueUgx: 20_000, quantity: 4 }],
  tables: [{ label: "T1", billCount: 1, revenueUgx: 10_000 }],
  peakHours: [{ hour: 12, label: "12:00", billCount: 2, revenueUgx: 15_000 }],
  menu: {
    menuItemCount: 3,
    reliableCostCount: 1,
    needsCostCount: 1,
    unverifiedCostCount: 1,
    topDishes: [
      {
        productId: "p1",
        name: "Chicken plate",
        unitsSold: 2,
        revenueUgx: 20_000,
        sellPriceUgx: 10_000,
        costStatus: "estimated",
        currentCostUgx: 2_000,
        currentMarginPct: 80,
        realized: {
          basis: "complete",
          revenueUgx: 20_000,
          costUgx: 15_000,
          profitUgx: 5_000,
          marginPct: 25,
          snapshotLineCount: 2,
          missingSnapshotLineCount: 0,
        },
        soldLineCount: 2,
      },
    ],
    topDrinks: [
      {
        productId: "p2",
        name: "Soda",
        unitsSold: 3,
        revenueUgx: 6_000,
        sellPriceUgx: 2_000,
        costStatus: "unverified",
        currentCostUgx: null,
        currentMarginPct: null,
        realized: {
          basis: "partial",
          revenueUgx: 6_000,
          costUgx: 4_000,
          profitUgx: 2_000,
          marginPct: 33.33,
          snapshotLineCount: 2,
          missingSnapshotLineCount: 1,
        },
        soldLineCount: 3,
      },
    ],
    lowMargin: [
      {
        productId: "p3",
        name: "Legacy plate",
        unitsSold: 1,
        revenueUgx: 5_000,
        sellPriceUgx: 5_000,
        costStatus: "estimated",
        currentCostUgx: 4_000,
        currentMarginPct: 20,
        realized: null,
        soldLineCount: 1,
      },
    ],
    topModifiers: [{ optionLabel: "Extra sauce", groupLabel: "Extras", count: 2 }],
    ingredientCostGaps: [
      { ingredientId: "spice", name: "Spice mix", unit: "kg", dishCount: 1, reason: "zero_cost" },
    ],
    ingredientDemand: {
      rows: [
        {
          ingredientId: "rice",
          name: "Rice",
          unit: "kg",
          quantityBase: 1.4,
          estimatedCostUgx: 5_600,
          costStatus: "trusted",
          dishCount: 2,
        },
        {
          ingredientId: "spice",
          name: "Spice mix",
          unit: "kg",
          quantityBase: 0.2,
          estimatedCostUgx: null,
          costStatus: "unavailable",
          dishCount: 1,
        },
      ],
      missingIngredients: [
        { ingredientId: "ghost", unit: "kg", quantityBase: 1, dishCount: 1 },
      ],
      noRecipeDishes: [
        { productId: "p4", name: "No recipe plate", unitsSold: 1, reason: "no_recipe" },
      ],
    },
  },
};

describe("hospitalityExport", () => {
  it("builds waiter PDF", () => {
    const blob = buildHospitalityWaiterPdfBlob("en", sample);
    expect(blob.size).toBeGreaterThan(200);
  });

  it("builds kitchen PDF", () => {
    const blob = buildHospitalityKitchenPdfBlob("en", sample);
    expect(blob.size).toBeGreaterThan(200);
  });

  it("builds table PDF", () => {
    const blob = buildHospitalityTableRevenuePdfBlob("en", sample);
    expect(blob.size).toBeGreaterThan(200);
  });

  it("builds menu PDF with period and margin labels", () => {
    const blob = buildHospitalityMenuPdfBlob("en", sample, "October 2026");
    expect(blob.size).toBeGreaterThan(300);
  });
});
