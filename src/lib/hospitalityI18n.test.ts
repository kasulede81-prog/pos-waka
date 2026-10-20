import { describe, expect, it } from "vitest";
import { t } from "./i18n";
import { swOverrides } from "./i18n/swOverrides";

/** Recent Hospitality costing, reporting, demand, and export keys. */
const KEYS = [
  // Menu costing
  "menuCostRecipeNotSet",
  "menuCostEstimated",
  "menuCostEstimatedShort",
  "menuCostIncomplete",
  "menuCostIncompleteBody",
  "menuCostMissingIngredient",
  "menuCostZeroCostIngredient",
  "menuCostGuidedTitle",
  "menuCostGuidedBody",
  "menuCostGuidedAddIngredient",
  "menuCostGuidedExamplesTitle",
  "menuCostExampleRice",
  "menuCostExampleChicken",
  "menuCostExampleChips",
  "menuCostGuidedNoIngredients",
  "menuCostBannerTitle",
  "menuCostBannerBody",
  "menuCostBannerAction",
  "menuCostFoodCostEstimated",
  "menuCostEstimatedNote",
  "menuCostVerifiedCostShort",
  "menuCostCostNotConfirmed",
  "menuCostProductCostTitle",
  "menuCostProductCostLabel",
  "menuCostProductProfitLabel",
  "menuCostVerifiedManual",
  "menuCostVerifiedPurchase",
  "menuCostProductCostNote",
  "menuCostProductCostNotConfirmedTitle",
  "menuCostProductCostGeneratedBody",
  "menuCostProductCostUnknownBody",
  "menuCostProductCostNotSetBody",
  "menuCostSelectIngredient",
  "menuCostQuantity",
  "menuCostRemoveIngredient",
  "setupCostMenuStep",
  "setupCostMenuAction",
  "menuCostPanelTitle",
  "menuCostFoodCost",
  "menuCostSellPrice",
  "menuCostProfit",
  "menuCostMargin",
  // Prepared-dish cost basis (recipe ingredient vs full batch cost)
  "hospitalityPrepBatchesOpen",
  "hospitalityPrepBatchesTitle",
  "hospitalityPrepBatchesSub",
  "hospitalityPrepSelectDish",
  "hospitalityPrepNoDishes",
  "menuPrepMode",
  "menuPrepMadeToOrder",
  "menuPrepBatchPrepared",
  "menuPrepAvailable",
  "menuPrepPrepare",
  "menuPrepPortions",
  "menuPrepConfirm",
  "menuPrepRequired",
  "menuPrepShortage",
  "menuPrepBatchesTitle",
  "menuPrepWaste",
  "menuPrepCancel",
  "menuPrepReason",
  "menuPrepConfirmWaste",
  "menuPrepUnitCost",
  "menuPrepTotalCost",
  "menuPrepRemaining",
  "menuPrepStatus",
  "menuPrepDate",
  "menuPrepExpectedPortions",
  "menuPrepActualPortions",
  "menuPrepActualYieldHint",
  "menuPrepYieldEstimated",
  "menuPrepYieldActual",
  "menuPrepIngredientCostEstimate",
  "menuPrepIngredientCostActual",
  "menuPrepActualIngredientCost",
  "menuPrepAdditionalCosts",
  "menuPrepAdditionalCostHint",
  "menuPrepCostCharcoal",
  "menuPrepCostLabour",
  "menuPrepCostPackaging",
  "menuPrepAddCost",
  "menuPrepRemoveCost",
  "menuPrepBatchCost",
  "menuPrepIngredientCostTotal",
  "menuPrepAdditionalCostTotal",
  "menuPrepSaleCogsPerPlate",
  "menuPrepCostPerPlate",
  "menuPrepRecipeCostPerPlate",
  "menuPrepBatchCostBasisNote",
  "menuPrepSellingPrice",
  "menuPrepProjectionTitle",
  "menuPrepProjectionNote",
  "menuPrepProjectedRevenue",
  "menuPrepProjectedProfit",
  "menuPrepRemainingValue",
  "menuPrepWasteValue",
  "menuPrepMissingIngredient",
  "menuPrepInvalidCost",
  "menuPrepLegacyBatch",
  "prepModeRequiresBatch",
  "prepRequiresRecipe",
  "unbatchedStock",
  "insufficientPreparedStock",
  "prepAvailableShort",
  // Historical-margin / menu report
  "hospitalityReportsMenuTitle",
  "hospitalityReportsMenuHint",
  "hospitalityReportsMenuItems",
  "hospitalityReportsReliableCost",
  "hospitalityReportsNeedsCost",
  "hospitalityReportsUnverifiedCost",
  "hospitalityReportsTopDrinks",
  "hospitalityReportsLowMargin",
  "hospitalityReportsSoldMargin",
  "hospitalityReportsSoldMarginPartial",
  "hospitalityReportsEstimatedMargin",
  "hospitalityReportsMarginUnavailable",
  "hospitalityReportsIngredientGaps",
  "hospitalityReportsIngredientGapRow",
  "hospitalityReportsIngredientZeroCost",
  "hospitalityReportsIngredientMissing",
  "hospitalityReportsNoMenuSales",
  "hospitalityReportsNoLowMargin",
  "hospitalityReportsNoIngredientGaps",
  "hospitalityReportsTopDishes",
  "hospitalityReportsTopModifiers",
  // Ingredient demand
  "hospitalityIngredientDemandTitle",
  "hospitalityIngredientDemandHint",
  "hospitalityIngredientDemandEmpty",
  "hospitalityIngredientDemandCostUnavailable",
  "hospitalityIngredientDemandDishCount",
  "hospitalityIngredientDemandGapsTitle",
  "hospitalityIngredientDemandNoRecipe",
  "hospitalityIngredientDemandMissingProduct",
  "hospitalityIngredientDemandMissingIngredient",
  // Prep batch report
  "hospitalityPrepBatchReportTitle",
  "hospitalityPrepBatchReportHint",
  "hospitalityPrepBatchReportEmpty",
  "hospitalityPrepBatchReportBatches",
  "hospitalityPrepBatchReportPortions",
  "hospitalityPrepBatchReportActualPortions",
  "hospitalityPrepBatchReportExpected",
  "hospitalityPrepBatchReportActual",
  "hospitalityPrepBatchReportYieldVariance",
  "hospitalityPrepBatchReportCostPerPlate",
  "hospitalityPrepBatchReportWasted",
  "hospitalityPrepBatchReportCurrentStock",
  "hospitalityPrepBatchReportYieldUnknown",
  "hospitalityPrepBatchReportLegacy",
  "hospitalityPrepBatchReportUndated",
  "hospitalityPrepBatchReportOutsideRange",
  "hospitalityPrepBatchReportUsage",
  "hospitalityPrepBatchReportSoldNet",
  "hospitalityPrepBatchReportSoldGross",
  "hospitalityPrepBatchReportReturned",
  "hospitalityPrepBatchReportCancelled",
  "hospitalityPrepBatchReportSalesRevenue",
  "hospitalityPrepBatchReportSalesCogs",
  "hospitalityPrepBatchReportUnknown",
  "hospitalityPrepBatchReportReturnsUnavailable",
  "hospitalityPrepBatchReportReconciliationLine",
  "hospitalityPrepBatchReportReconciled",
  "hospitalityPrepBatchReportUnreconciled",
  "hospitalityPrepBatchReportReconciliationSummary",
  "hospitalityPrepBatchReportScopeNote",
  "hospitalityPrepBatchReportSalesNote",
  "hospitalityPrepBatchReportSnapshotMissing",
  "hospitalityPrepBatchReportSnapshotPartial",
  "hospitalityPrepBatchReportMissingAllocation",
  "hospitalityPrepBatchReportUnallocatedSales",
  "hospitalityPrepBatchReportMissingSnapshot",
  "hospitalityPrepBatchReportPartialSnapshot",
  "hospitalityPrepBatchReportMissingReturnCogs",
  "hospitalityPrepBatchReportUnattributedReturns",
  "hospitalityPrepBatchReportCancelledUnknown",
  // Menu export
  "hospitalityExportMenuPdf",
  "hospitalityMenuExportPeriod",
  "hospitalityMenuExportSnapshotNote",
  // Cancellation/void report
  "hospitalityCancelledItemsTitle",
  "hospitalityCancelledItemsHint",
  "hospitalityCancelledItemsEmpty",
  "hospitalityCancelledSourceLineVoid",
  "hospitalityCancelledSourceWholeBill",
  "hospitalityCancelledSourceKitchen",
  "hospitalityCancelledLineVoids",
  "hospitalityCancelledWholeBillVoids",
  "hospitalityCancelledKitchenCancellations",
  "hospitalityCancelledRecordedValue",
  "hospitalityCancelledSaleTimeCost",
  "hospitalityCancelledSaleTimeCostPartial",
  "hospitalityCancelledCostNotRecorded",
  "hospitalityCancelledNoSnapshot",
  "hospitalityCancelledValueNote",
  "hospitalityCancelledReasonUnknown",
  "hospitalityCancelledTicketLabel",
  "hospitalityCancelledSummaryCount",
  "hospitalityCancelledSnapshotCoverage",
  // Shared void reason labels used by the cancellation report
  "voidReason_wrong_item",
  "voidReason_customer_changed_mind",
  "voidReason_returned_item",
  "voidReason_wrong_quantity",
  "voidReason_other",
  // Table service duration and turnover
  "hospitalityTableServiceTitle",
  "hospitalityTableServiceHint",
  "hospitalityTableServiceCompleted",
  "hospitalityTableServiceAvgDuration",
  "hospitalityTableServiceOpenNow",
  "hospitalityTableServiceMissingEnd",
  "hospitalityTableServiceByTable",
  "hospitalityTableServiceOpenTables",
  "hospitalityTableServiceNoCompleted",
  "hospitalityTableServiceNoOpen",
  "hospitalityTableServiceStatusOpen",
  "hospitalityTableServiceStatusPaymentPending",
  "hospitalityTableServiceGuests",
  "hospitalityTableServiceCycles",
  "hospitalityTableServiceOpenNote",
  "hospitalityTableServiceExcludedNote",
] as const;

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{?([A-Za-z0-9_]+)\}?\}/g)].map((match) => match[1]!).sort();
}

describe("recent Hospitality i18n coverage", () => {
  it("has no duplicate keys in the coverage list", () => {
    expect(new Set(KEYS).size).toBe(KEYS.length);
  });

  it("resolves every key in en, lg, and sw with genuine translations", () => {
    for (const key of KEYS) {
      const english = t("en", key);
      expect(english, `en.${key}`).toBeTruthy();
      expect(english, `en.${key}`).not.toBe(key);

      for (const lang of ["lg", "sw"] as const) {
        const value = t(lang, key);
        expect(value, `${lang}.${key}`).toBeTruthy();
        expect(value, `${lang}.${key}`).not.toBe(key);
        expect(value, `${lang}.${key}`).not.toBe(english);
      }
    }
  });

  it("preserves every interpolation placeholder in translations", () => {
    for (const key of KEYS) {
      const english = placeholders(t("en", key));
      for (const lang of ["lg", "sw"] as const) {
        expect(placeholders(t(lang, key)), `${lang}.${key}`).toEqual(english);
      }
    }
  });

  it("Swahili overrides carry every key", () => {
    for (const key of KEYS) {
      expect(swOverrides[key], key).toBeTruthy();
    }
  });
});

describe("batch cost labels match the shared cost model", () => {
  it("describes the full batch cost as the sale COGS basis in every language", () => {
    for (const lang of ["en", "lg", "sw"] as const) {
      const sale = t(lang, "menuPrepSaleCogsPerPlate").toLowerCase();
      expect(sale, lang).toContain("full batch cost");
      expect(sale, lang).not.toContain("recipe basis");
      expect(sale, lang).not.toContain("management");
    }
  });

  it("describes unitCostUgx as the frozen ingredient record, never sale COGS", () => {
    for (const lang of ["en", "lg", "sw"] as const) {
      const ingredient = t(lang, "menuPrepCostPerPlate").toLowerCase();
      expect(ingredient, lang).toContain("ingredient");
      expect(ingredient, lang).not.toContain("management");
      expect(ingredient, lang).not.toContain("sale cogs");
    }
  });
});
