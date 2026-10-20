/**
 * Hospitality ingredient low-stock policy.
 *
 * Semantics under test:
 *  - the saved shop threshold is a fallback for Hospitality ingredients only;
 *  - a positive per-product `minimumStockAlert` always wins;
 *  - missing/zero/negative/non-finite settings are ignored;
 *  - retail and pharmacy behavior is unchanged;
 *  - every low-stock consumer reads the same effective threshold.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Product, ShopPreferences } from "../types";
import {
  applyHospitalityLowStockPolicy,
  getHospitalityLowStockPolicyContext,
  getHospitalityLowStockPolicyRevision,
  hospitalityLowStockPolicyToken,
  resetHospitalityLowStockPolicyContext,
} from "./lowStockPolicyContext";
import { isLowStock, isLowStockForSellCard, lowStockThreshold } from "./sellingEngine";
import { countInventoryStockStatus, computeInventoryWorkspaceDashboardStats } from "./inventoryWorkspaceStats";
import { localGetInventoryInsights } from "./localReporting";
import { computeOwnerAlerts } from "./ownerAlerts";
import { buildRestockSuggestions } from "./restockSuggestions";
import { buildMonthlyBusinessReport } from "./monthlyBusinessReport";
import { buildReportingProductsFingerprint } from "./computationResultCache";
import { tTemplate } from "./i18n";
import { usePosStore } from "../store/usePosStore";

const NOW = "2026-10-20T08:00:00.000Z";

function product(partial: Partial<Product> & Pick<Product, "id" | "name">): Product {
  return {
    sellingMode: "unit",
    baseUnit: "kg",
    sellingPricePerUnitUgx: 0,
    costPricePerUnitUgx: 1_000,
    stockOnHand: 5,
    minimumStockAlert: 0,
    category: "Kitchen",
    sku: "",
    updatedAt: NOW,
    version: 1,
    menu: { productKind: "ingredient", modifierGroups: [], variants: [] },
    ...partial,
  };
}

const ingredient = product({ id: "ing", name: "Chicken", stockOnHand: 5, minimumStockAlert: 0 });
const semiFinished = product({
  id: "semi",
  name: "Marinade",
  stockOnHand: 5,
  minimumStockAlert: 0,
  menu: { productKind: "semi_finished", modifierGroups: [], variants: [] },
});
const explicitAbove = product({ id: "explicit-hi", name: "Rice", stockOnHand: 5, minimumStockAlert: 3 });
const explicitBelow = product({ id: "explicit-lo", name: "Beans", stockOnHand: 2, minimumStockAlert: 3 });
const retail = product({
  id: "retail",
  name: "Soda",
  stockOnHand: 1,
  minimumStockAlert: 0,
  menu: { productKind: "retail", modifierGroups: [], variants: [] },
});
const finishedDish = product({
  id: "dish",
  name: "Plate",
  stockOnHand: 1,
  minimumStockAlert: 0,
  menu: { productKind: "finished_menu", modifierGroups: [], variants: [] },
});
const retailThreshold = product({
  id: "retail-min",
  name: "Water",
  stockOnHand: 5,
  minimumStockAlert: 5,
  menu: { productKind: "retail", modifierGroups: [], variants: [] },
});
const retailOut = product({
  id: "retail-out",
  name: "Empty",
  stockOnHand: 0,
  minimumStockAlert: 0,
  menu: { productKind: "retail", modifierGroups: [], variants: [] },
});

const ALL = [ingredient, semiFinished, explicitAbove, explicitBelow, retail, finishedDish, retailThreshold, retailOut];

function enablePolicy(threshold: number | null | undefined = 10) {
  applyHospitalityLowStockPolicy({ hospitalityMode: true, lowStockThreshold: threshold });
}

describe("policy semantics and precedence", () => {
  beforeEach(() => resetHospitalityLowStockPolicyContext());
  afterEach(() => resetHospitalityLowStockPolicyContext());

  it("does nothing when no policy setting is saved", () => {
    expect(isLowStock(ingredient)).toBe(false);
    expect(lowStockThreshold(ingredient)).toBe(0);
    expect(isLowStock(retailThreshold)).toBe(true);
  });

  it("applies the shop threshold to ingredients and semi-finished items only", () => {
    enablePolicy(10);
    expect(lowStockThreshold(ingredient)).toBe(10);
    expect(isLowStock(ingredient)).toBe(true);
    expect(isLowStock(semiFinished)).toBe(true);

    expect(lowStockThreshold(retail)).toBe(0);
    expect(isLowStock(retail)).toBe(false);
    expect(isLowStock(finishedDish)).toBe(false);
    expect(lowStockThreshold(finishedDish)).toBe(0);
  });

  it("keeps a positive per-product minimum above the shop policy", () => {
    enablePolicy(10);
    expect(lowStockThreshold(explicitAbove)).toBe(3);
    expect(isLowStock(explicitAbove)).toBe(false);
    expect(lowStockThreshold(explicitBelow)).toBe(3);
    expect(isLowStock(explicitBelow)).toBe(true);
  });

  it("treats stock equal to the effective threshold as low", () => {
    enablePolicy(10);
    expect(isLowStock(ingredient)).toBe(true); // stock 5 < 10
    expect(isLowStock(product({ id: "eq", name: "Eq", stockOnHand: 10 }))).toBe(true);
    expect(isLowStock(product({ id: "above", name: "Above", stockOnHand: 10.5 }))).toBe(false);
  });

  it("ignores the policy outside Hospitality mode", () => {
    applyHospitalityLowStockPolicy({ hospitalityMode: false, lowStockThreshold: 10 });
    expect(getHospitalityLowStockPolicyContext()).toEqual({ enabled: false, threshold: null });
    expect(isLowStock(ingredient)).toBe(false);
  });

  it("rejects zero, negative, NaN, Infinity, and missing thresholds", () => {
    for (const value of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
      resetHospitalityLowStockPolicyContext();
      applyHospitalityLowStockPolicy({ hospitalityMode: true, lowStockThreshold: value });
      expect(getHospitalityLowStockPolicyContext()).toEqual({ enabled: true, threshold: null });
      expect(isLowStock(ingredient)).toBe(false);
    }
  });

  it("preserves retail low-stock behavior with the policy enabled", () => {
    enablePolicy(10);
    expect(isLowStock(retailThreshold)).toBe(true);
    expect(isLowStock(retailOut)).toBe(false);
    expect(lowStockThreshold(retailOut)).toBe(0);
  });

  it("keeps POS sell badges consistent without changing retail zero-stock badges", () => {
    enablePolicy(10);
    expect(isLowStockForSellCard(ingredient)).toBe(true);
    expect(isLowStockForSellCard(retail)).toBe(false);
    expect(isLowStockForSellCard(retailOut)).toBe(true); // historical zero-stock badge
    expect(isLowStockForSellCard(retailThreshold)).toBe(true);
  });

  it("changes revision and token only when the effective policy changes", () => {
    const before = getHospitalityLowStockPolicyRevision();
    enablePolicy(10);
    const afterEnable = getHospitalityLowStockPolicyRevision();
    expect(afterEnable).toBeGreaterThan(before);
    expect(hospitalityLowStockPolicyToken()).toBe("h:10");

    enablePolicy(10);
    expect(getHospitalityLowStockPolicyRevision()).toBe(afterEnable);
    enablePolicy(20);
    expect(getHospitalityLowStockPolicyRevision()).toBeGreaterThan(afterEnable);
    expect(hospitalityLowStockPolicyToken()).toBe("h:20");

    resetHospitalityLowStockPolicyContext();
    expect(hospitalityLowStockPolicyToken()).toBe("none");
  });
});

describe("consumer consistency with the policy enabled", () => {
  beforeEach(() => {
    resetHospitalityLowStockPolicyContext();
    enablePolicy(10);
  });
  afterEach(() => resetHospitalityLowStockPolicyContext());

  it("uses the same effective threshold in inventory counts and dashboards", () => {
    const status = countInventoryStockStatus(ALL);
    // ingredient (policy), semiFinished (policy), explicitBelow (product min),
    // retailThreshold (explicit retail min) — retailThreshold proves retail is untouched.
    expect(status.lowStockCount).toBe(4);

    const dashboard = computeInventoryWorkspaceDashboardStats({
      products: ALL,
      purchases: [],
      supplierPayments: [],
      suppliers: [],
      businessType: "restaurant",
    });
    expect(dashboard.lowStockCount).toBe(status.lowStockCount);
  });

  it("reports the effective minimum and reorder quantity in inventory insights", () => {
    const insights = localGetInventoryInsights(ALL);
    const ids = insights.lowStock.map((row) => row.productId).sort();
    expect(ids).toEqual(["explicit-lo", "ing", "retail-min", "semi"]);

    const policyRow = insights.lowStock.find((row) => row.productId === "ing")!;
    expect(policyRow.minimumStockAlert).toBe(10);
    const policyReorder = insights.restockRecommendations.find((row) => row.productId === "ing")!;
    expect(policyReorder.suggestedReorderQty).toBe(15);

    const explicitRow = insights.lowStock.find((row) => row.productId === "explicit-lo")!;
    expect(explicitRow.minimumStockAlert).toBe(3);
    const explicitReorder = insights.restockRecommendations.find((row) => row.productId === "explicit-lo")!;
    expect(explicitReorder.suggestedReorderQty).toBe(4);
  });

  it("raises the owner alert and restock hint from the policy threshold", () => {
    const alerts = computeOwnerAlerts({
      products: ALL,
      dayCloses: [],
      auditLogs: [],
      preferences: {} as ShopPreferences,
      todayDebtUgx: 0,
    });
    const lowAlert = alerts.find((alert) => alert.id === "low-stock");
    expect(lowAlert?.titleVars?.count).toBe(4);

    const hints = buildRestockSuggestions("en", ALL, [], []);
    expect(hints[0]).toBe(tTemplate("en", "restockHintMultiLow", { count: "4" }));
  });

  it("keeps the monthly report on the same threshold (no divergent ?? 5 default)", () => {
    const report = buildMonthlyBusinessReport({
      monthKey: "2026-10",
      shopName: "Test",
      sales: [],
      returnRecords: [],
      products: ALL,
      staffAccounts: [],
    });
    expect(report.inventorySummary.lowStockCount).toBe(4);
  });

  it("invalidates report caches when the policy changes", () => {
    const before = buildReportingProductsFingerprint(ALL);
    enablePolicy(20);
    const after = buildReportingProductsFingerprint(ALL);
    expect(after).not.toBe(before);
  });
});

describe("store wiring", () => {
  afterAll(() => {
    const prefs = usePosStore.getState().preferences;
    usePosStore.setState({
      preferences: {
        ...prefs,
        businessType: "kiosk_duka",
        hospitalityModeEnabled: false,
        hospitalityIngredientPolicy: null,
      },
    });
    resetHospitalityLowStockPolicyContext();
  });

  it("derives the context from saved preferences and disables it outside Hospitality mode", () => {
    const base = usePosStore.getState().preferences;
    usePosStore.setState({
      preferences: {
        ...base,
        businessType: "restaurant",
        hospitalityModeEnabled: true,
        hospitalityIngredientPolicy: { policy: "warn", lowStockThreshold: 10 },
      },
    });
    expect(getHospitalityLowStockPolicyContext()).toEqual({ enabled: true, threshold: 10 });
    expect(isLowStock(ingredient)).toBe(true);

    usePosStore.setState({
      preferences: { ...usePosStore.getState().preferences, businessType: "kiosk_duka" },
    });
    expect(getHospitalityLowStockPolicyContext()).toEqual({ enabled: false, threshold: null });
    expect(isLowStock(ingredient)).toBe(false);
  });
});
