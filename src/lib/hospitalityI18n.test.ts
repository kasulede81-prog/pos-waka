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
