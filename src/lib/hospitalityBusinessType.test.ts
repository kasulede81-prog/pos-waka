/**
 * Hospitality business-type consolidation — spec matrix (11 points).
 *
 * ONE unified Hospitality business type; Restaurant / Bar / Restaurant + Bar
 * are an operating configuration (hospitalityStyle), never separate financial
 * or product architectures. All sales still flow through finalizeDraftSale().
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Product, SaleLine } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import {
  businessTypeForHospitalityStyle,
  hospitalityStyleForStyleId,
  HOSPITALITY_ONBOARDING_STYLES,
} from "../config/hospitalityOnboarding";
import { ONBOARDING_BUSINESS_CARDS } from "../config/onboardingFlow";
import { getBusinessProfile, BUSINESS_TYPE_IDS } from "../config/businessTypes";
import {
  defaultKitchenEnabledForBusinessType,
  defaultMenuCategoriesForBusinessType,
  hospitalityStyleForBusinessType,
  isBarOnlyMode,
  isHospitalityBusinessType,
} from "./hospitality";
import { isPharmacyBusinessType } from "./pharmacy";

const DISH_ID = "dish-1";
const DRINK_ID = "drink-1";
const ING_A_ID = "ing-a";

function baseProduct(partial: Partial<Product> & Pick<Product, "id" | "name">): Product {
  return {
    sellingMode: "unit",
    baseUnit: "pcs",
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 3_000,
    stockOnHand: 100,
    minimumStockAlert: 0,
    category: "Food",
    sku: "",
    updatedAt: "2026-09-18T08:00:00.000Z",
    version: 1,
    ...partial,
  };
}

const ingA = baseProduct({ id: ING_A_ID, name: "Ingredient A", costPricePerUnitUgx: 1_000, baseUnit: "u", menu: { productKind: "ingredient" } });
const drink = baseProduct({ id: DRINK_ID, name: "Soda", sellingPricePerUnitUgx: 2_000, costPricePerUnitUgx: 1_200, stockOnHand: 50, baseUnit: "bottle", category: "Drinks" });
const dish = baseProduct({
  id: DISH_ID,
  name: "Dish",
  costPricePerUnitUgx: 0,
  stockOnHand: 0,
  baseUnit: "portion",
  menu: {
    productKind: "finished_menu",
    prepMode: "batch_prepared",
    recipe: {
      yieldQty: 20,
      lines: [{ ingredientProductId: ING_A_ID, quantityBase: 40, unitLabel: "u" }],
    },
    modifierGroups: [],
    variants: [],
  },
});

function qtyLine(p: Product, quantity: number, id: string): SaleLine {
  return {
    id,
    productId: p.id,
    name: p.name,
    inputMode: "quantity",
    quantity,
    unitPriceUgx: p.sellingPricePerUnitUgx,
    unitCostUgx: p.costPricePerUnitUgx,
    lineTotalUgx: p.sellingPricePerUnitUgx * quantity,
    estimatedProfitUgx: (p.sellingPricePerUnitUgx - p.costPricePerUnitUgx) * quantity,
    updatedAt: "2026-09-18T08:05:00.000Z",
  };
}

function seedStore() {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
    preferences: {
      businessType: "kiosk_duka",
      kioskQuickSell: true,
      onboardingDone: false,
    },
    products: [{ ...ingA }, { ...drink }, { ...dish }],
    customers: [],
    sales: [],
    stockMovements: [],
    archivedStockMovements: [],
    voidRecords: [],
    archivedVoidRecords: [],
    returnRecords: [],
    archivedReturnRecords: [],
    auditLogs: [],
    archivedAuditLogs: [],
    draftLines: [],
    draftCartDiscountUgx: 0,
    activePendingSaleId: null,
    draftInput: null,
    draftSaleCustomerId: "",
    draftSaleCustomerName: "",
    draftSaleCustomerPhone: "",
    draftPaymentMethod: "cash",
  });
  expect(openTestShift().ok).toBe(true);
}

const prefs = () => usePosStore.getState().preferences;

describe("hospitality business type consolidation", () => {
  beforeEach(() => {
    seedStore();
  });

  // 1 — New merchant can select Hospitality (exactly one top-level option).
  it("1: onboarding shows exactly ONE Hospitality option, not three", () => {
    const groupCards = ONBOARDING_BUSINESS_CARDS.filter((c) => c.hospitalityGroup);
    expect(groupCards).toHaveLength(1);
    for (const legacy of ["restaurant", "bar", "restaurant_bar"] as const) {
      expect(ONBOARDING_BUSINESS_CARDS.some((c) => c.businessType === legacy)).toBe(false);
      // Legacy values remain valid BusinessType ids (backward compatibility).
      expect(BUSINESS_TYPE_IDS).toContain(legacy);
    }
    expect(BUSINESS_TYPE_IDS).toContain("hospitality");
    // The secondary configuration exposes the three operating styles.
    const styles = HOSPITALITY_ONBOARDING_STYLES.filter((s) => s.businessType === "hospitality");
    expect(styles.map((s) => s.style)).toEqual(["restaurant", "restaurant", "bar", "restaurant_bar"]);
  });

  // 2–4 — Each configuration maps to Hospitality with its style preserved.
  it("2–4: restaurant / bar / restaurant+bar configurations map to Hospitality", () => {
    for (const [styleId, style] of [
      ["restaurant", "restaurant"],
      ["bar", "bar"],
      ["restaurant_bar", "restaurant_bar"],
    ] as const) {
      expect(businessTypeForHospitalityStyle(styleId)).toBe("hospitality");
      expect(hospitalityStyleForStyleId(styleId)).toBe(style);
    }
  });

  // 5 — All three configurations use the same Hospitality path.
  it("5: all three configurations use the same Hospitality engine path", () => {
    for (const style of ["restaurant", "bar", "restaurant_bar"] as const) {
      expect(isHospitalityBusinessType("hospitality")).toBe(true);
      usePosStore.getState().completeBusinessOnboarding("hospitality", style);
      expect(prefs().businessType).toBe("hospitality");
      expect(prefs().hospitalityStyle).toBe(style);
      expect(prefs().hospitalityModeEnabled).toBe(true);
      // Bar configuration emphasizes drinks (kitchen off by default); the
      // others keep the kitchen on. Same implementation either way.
      expect(defaultKitchenEnabledForBusinessType("hospitality", style)).toBe(style !== "bar");
      expect(isBarOnlyMode("hospitality", true, null, style)).toBe(style === "bar");
    }
  });

  // 6 — Food sale still uses finalizeDraftSale().
  it("6: food sale finalizes through the shared sale engine", () => {
    usePosStore.getState().completeBusinessOnboarding("hospitality", "restaurant");
    expect(usePosStore.getState().prepareMenuBatch({ productId: DISH_ID, portions: 20, batchId: "b1" }).ok).toBe(true);
    usePosStore.setState({ draftLines: [qtyLine(product(DISH_ID), 2, "l1")] });
    const res = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
    expect(res.ok).toBe(true);
    expect(usePosStore.getState().sales.filter((s) => s.status === "completed")).toHaveLength(1);
    // Ingredients were consumed at preparation, not again at sale.
    expect(product(ING_A_ID).stockOnHand).toBe(60);
    expect(product(DISH_ID).stockOnHand).toBe(18);
  });

  // 7 — Drink sale still uses finalizeDraftSale().
  it("7: drink sale finalizes through the shared sale engine", () => {
    usePosStore.getState().completeBusinessOnboarding("hospitality", "bar");
    usePosStore.setState({ draftLines: [qtyLine(product(DRINK_ID), 3, "l1")] });
    const res = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
    expect(res.ok).toBe(true);
    expect(product(DRINK_ID).stockOnHand).toBe(47);
  });

  // 8 — Combined food + drink = exactly ONE WAKA Sale.
  it("8: combined food + drink checkout creates exactly ONE sale", () => {
    usePosStore.getState().completeBusinessOnboarding("hospitality", "restaurant_bar");
    expect(usePosStore.getState().prepareMenuBatch({ productId: DISH_ID, portions: 20, batchId: "b1" }).ok).toBe(true);
    usePosStore.setState({
      draftLines: [qtyLine(product(DISH_ID), 1, "l1"), qtyLine(product(DRINK_ID), 2, "l2")],
    });
    const res = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
    expect(res.ok).toBe(true);
    const sales = usePosStore.getState().sales.filter((s) => s.status === "completed");
    expect(sales).toHaveLength(1);
    expect(sales[0]!.totalUgx).toBe(14_000);
  });

  // 9 — Existing merchants with legacy restaurant/bar values still load correctly.
  it("9: legacy stored values load and derive their operating configuration", () => {
    for (const [legacy, style, kitchenOn] of [
      ["restaurant", "restaurant", true],
      ["bar", "bar", false],
      ["restaurant_bar", "restaurant_bar", true],
    ] as const) {
      expect(isHospitalityBusinessType(legacy)).toBe(true);
      expect(hospitalityStyleForBusinessType(legacy)).toBe(style);
      expect(defaultKitchenEnabledForBusinessType(legacy)).toBe(kitchenOn);
      expect(getBusinessProfile(legacy).dashboardVariant).toBe("service");
      usePosStore.setState({
        preferences: { businessType: "kiosk_duka", kioskQuickSell: true, onboardingDone: false },
      });
      usePosStore.getState().completeBusinessOnboarding(legacy);
      expect(prefs().businessType).toBe(legacy);
      expect(prefs().hospitalityModeEnabled).toBe(true);
      expect(prefs().hospitalityKitchenEnabled).toBe(kitchenOn);
    }
    // An explicit style always wins over legacy derivation.
    expect(hospitalityStyleForBusinessType("hospitality", "bar")).toBe("bar");
    expect(hospitalityStyleForBusinessType("bar", "restaurant_bar")).toBe("restaurant_bar");
    // Menu defaults follow the effective configuration.
    expect(defaultMenuCategoriesForBusinessType("hospitality", "bar")).toContain("Beer");
    expect(defaultMenuCategoriesForBusinessType("bar")).toContain("Beer");
    expect(defaultMenuCategoriesForBusinessType("hospitality", "restaurant")).toContain("Food");
    expect(defaultMenuCategoriesForBusinessType("hospitality", null)).toContain("Food");
  });

  // 10 — Retail/Duka remains unchanged.
  it("10: retail stays a plain non-hospitality business type", () => {
    expect(isHospitalityBusinessType("kiosk_duka")).toBe(false);
    usePosStore.getState().completeBusinessOnboarding("kiosk_duka");
    expect(prefs().businessType).toBe("kiosk_duka");
    expect(prefs().hospitalityModeEnabled).not.toBe(true);
    expect(getBusinessProfile("kiosk_duka").dashboardVariant).toBe("kiosk");
  });

  // 11 — Pharmacy remains unchanged.
  it("11: pharmacy stays its own business type and mode", () => {
    expect(isPharmacyBusinessType("pharmacy")).toBe(true);
    expect(isHospitalityBusinessType("pharmacy")).toBe(false);
    usePosStore.getState().completeBusinessOnboarding("pharmacy");
    expect(prefs().businessType).toBe("pharmacy");
    expect(prefs().pharmacyModeEnabled).toBe(true);
    expect(prefs().hospitalityModeEnabled).not.toBe(true);
  });
});

function product(id: string): Product {
  return usePosStore.getState().products.find((p) => p.id === id)!;
}
