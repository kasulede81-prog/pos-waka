import { describe, expect, it } from "vitest";
import {
  buildHospitalityCancellationExportBlock,
  buildHospitalityKitchenPdfBlob,
  buildHospitalityMenuPdfBlob,
  buildHospitalityPrepBatchExportBlock,
  buildHospitalityTableRevenuePdfBlob,
  buildHospitalityTableServiceExportBlock,
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
  prepBatches: {
    rows: [
      {
        batchId: "batch-1",
        productId: "p1",
        productName: "Chicken plate",
        preparedAt: "2026-06-02T10:00:00.000Z",
        status: "active",
        yieldBasis: "actual",
        costBasis: "recipe_estimate",
        portionsPrepared: 18,
        expectedPortions: 20,
        actualPortions: 18,
        yieldVariancePortions: -2,
        ingredientCostPerPlateUgx: 2_780,
        costPerPlateUgx: 4_033,
        ingredientCostUgx: 55_600,
        additionalCostUgx: 17_000,
        totalBatchCostUgx: 72_600,
        wastedPortions: 2,
        wasteValueUgx: 8_066,
        remainingPortions: 14,
        remainingValueUgx: 56_462,
        legacyCost: false,
      },
      {
        batchId: "batch-legacy",
        productId: "p1",
        productName: "Chicken plate",
        preparedAt: "2026-06-03T10:00:00.000Z",
        status: "depleted",
        yieldBasis: null,
        costBasis: null,
        portionsPrepared: 20,
        expectedPortions: null,
        actualPortions: null,
        yieldVariancePortions: null,
        ingredientCostPerPlateUgx: 2_780,
        costPerPlateUgx: 2_780,
        ingredientCostUgx: 55_600,
        additionalCostUgx: 0,
        totalBatchCostUgx: 55_600,
        wastedPortions: 0,
        wasteValueUgx: 0,
        remainingPortions: 0,
        remainingValueUgx: 0,
        legacyCost: true,
      },
    ],
    batchCount: 2,
    portionsPrepared: 38,
    yieldMeasuredBatchCount: 1,
    expectedPortions: 20,
    actualPortions: 18,
    yieldVariancePortions: -2,
    totalBatchCostUgx: 128_200,
    wastedPortions: 2,
    wasteValueUgx: 8_066,
    remainingPortions: 14,
    remainingValueUgx: 56_462,
    legacyBatchCount: 1,
    undatedBatchCount: 1,
    outsideRangeBatchCount: 2,
    historyScope: "persisted_batches_only",
  },
  tableService: {
    completedCount: 2,
    completedDurationMinutes: 135,
    averageCompletedDurationMinutes: 67.5,
    completedByTable: [
      {
        tableLabel: "Table 1",
        completedCount: 1,
        totalDurationMinutes: 90,
        averageDurationMinutes: 90,
      },
      {
        tableLabel: "Table 2",
        completedCount: 1,
        totalDurationMinutes: 45,
        averageDurationMinutes: 45,
      },
    ],
    openCount: 1,
    openTables: [
      {
        sessionId: "s3",
        tableLabel: "Table 3",
        status: "open",
        openedAt: "2026-06-04T17:00:00.000Z",
        elapsedMinutes: 60,
        guestCount: 4,
      },
    ],
    missingEndEvidenceCount: 0,
    invalidIntervalCount: 0,
    outsideRangeCount: 0,
  },
  cancellations: {
    rows: [
      {
        id: "void:line",
        source: "line_void",
        productId: "p1",
        productName: "Chicken plate",
        quantity: 1,
        occurredAt: "2026-06-02T13:00:00.000Z",
        actorLabel: "Alice",
        reason: "wrong_item",
        note: "sent back",
        saleId: "sale-1",
        contextLabel: "Table 1",
        ticketNumber: null,
        recordedValueUgx: 10_000,
        saleTimeCostUgx: 2_000,
        saleTimeCostBasis: "complete",
        costStatus: "snapshot",
      },
      {
        id: "kitchen:1",
        source: "kitchen_ticket",
        productId: "p2",
        productName: "Soda",
        quantity: 2,
        occurredAt: "2026-06-03T15:00:00.000Z",
        actorLabel: "Chef",
        reason: "Out of stock",
        note: null,
        saleId: "sale-2",
        contextLabel: "Table 5",
        ticketNumber: 7,
        recordedValueUgx: null,
        saleTimeCostUgx: null,
        saleTimeCostBasis: null,
        costStatus: "unavailable",
      },
    ],
    lineVoidCount: 1,
    wholeBillVoidCount: 0,
    kitchenCancellationCount: 1,
    totalQuantity: 3,
    totalRecordedValueUgx: 10_000,
    totalSaleTimeCostUgx: 2_000,
    saleTimeCostRowCount: 1,
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

  it("builds the prep batch export block with production and current stock separated", () => {
    const block = buildHospitalityPrepBatchExportBlock("en", sample);
    const text = block.lines.join("\n");
    expect(block.title).toBe("Prep batch production");
    expect(text).toContain("Yield variance: -2");
    expect(text).toContain("Current remaining stock");
    expect(text).toContain("legacy");
    expect(text).toContain("have no readable prepared date");
    expect(text).toContain("fall outside this period");
    // Recipe/ingredient basis and full batch cost stay distinguishable.
    expect(text).toContain("Recipe ingredient cost / plate (frozen estimate): UGX 2,780");
    expect(text).toContain("Additional costs (whole batch): UGX 17,000");
    expect(text).toContain("Full batch cost (ingredients + extras): UGX 72,600");
    expect(text).toContain("Full batch cost / plate (sale COGS): UGX 4,033");
    expect(text).toContain("sale COGS and stock value use it");
  });

  it("does not show expected yield alone when actual yield is unrecorded", () => {
    const unknownYield: HospitalityReportSummary = {
      ...sample,
      prepBatches: {
        ...sample.prepBatches,
        rows: [
          {
            ...sample.prepBatches.rows[0]!,
            batchId: "unknown-yield",
            actualPortions: null,
            yieldVariancePortions: null,
          },
        ],
        batchCount: 1,
        yieldMeasuredBatchCount: 0,
        expectedPortions: 0,
        actualPortions: 0,
        yieldVariancePortions: 0,
        legacyBatchCount: 0,
        undatedBatchCount: 0,
        outsideRangeBatchCount: 0,
      },
    };
    const text = buildHospitalityPrepBatchExportBlock("en", unknownYield).lines.join("\n");
    expect(text).toContain("Portions prepared: 18");
    expect(text).not.toContain("Expected:");
    expect(text).not.toContain("Yield variance:");
    expect(text).toContain("no recorded actual yield");
  });

  it("builds table PDF", () => {
    const blob = buildHospitalityTableRevenuePdfBlob("en", sample);
    expect(blob.size).toBeGreaterThan(200);
  });

  it("builds menu PDF with period and margin labels", () => {
    const blob = buildHospitalityMenuPdfBlob("en", sample, "October 2026");
    expect(blob.size).toBeGreaterThan(300);
  });

  it("exports the table service block from the report summary", () => {
    const block = buildHospitalityTableServiceExportBlock("en", sample);
    expect(block.title).toBe("Table service duration & turnover");
    expect(block.hint).toContain("Completed cycles require both openedAt and closedAt");
    const text = block.lines.join("\n");
    expect(text).toContain("Completed cycles: 2");
    expect(text).toContain("Average duration: 1h 8m");
    expect(text).toContain("Table 1");
    expect(text).toContain("Open now: 1");
    expect(text).toContain("Table 3");
    expect(text).toContain("Current elapsed time — not completed turnover.");
  });

  it("exports the cancellation block from the report summary", () => {
    const block = buildHospitalityCancellationExportBlock("en", sample);
    expect(block.title).toBe("Cancelled & voided menu items");
    expect(block.hint).toContain("not kitchen waste");
    expect(block.hint).toContain("does not mean food was prepared or wasted");
    const text = block.lines.join("\n");
    expect(text).toContain("Line void");
    expect(text).toContain("Kitchen ticket cancellation");
    expect(text).toContain("Chicken plate");
    expect(text).toContain("Soda");
    expect(text).toContain("Wrong item");
    expect(text).toContain("Recorded void value: UGX 10,000");
    expect(text).toContain("Sale-time cost snapshot: UGX 2,000");
    expect(text).toContain("No sale-time cost snapshot");
    expect(text).toContain("Table 5");
    expect(block.valueNote).toContain("not a food-cost or waste value");
  });
});
