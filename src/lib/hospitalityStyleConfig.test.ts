/**
 * ONE hospitality business type, three operating styles (restaurant / bar / restaurant_bar).
 * The style is UI/operational emphasis only — never a separate engine and never a separate
 * financial path. These tests pin what the existing settings control.
 */
import { describe, expect, it } from "vitest";
import type { HospitalityOperatingStyle, Product } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { defaultHospitalityFloor, hospitalityBarOnlyFromPrefs, hospitalityKitchenEnabledFromPrefs } from "./hospitality";
import { visibleHospitalityNavItems } from "./hospitalityNav";
import { BAR_FIRE_STATION_TYPES, KITCHEN_FIRE_STATION_TYPES } from "./kitchenRouting";

type Explicit = boolean | null | undefined;
const prefs = (style: HospitalityOperatingStyle | null, kitchen: Explicit, businessType = "hospitality" as const) => ({
  businessType,
  hospitalityModeEnabled: true,
  hospitalityKitchenEnabled: kitchen,
  hospitalityStyle: style,
});

describe("kitchen enabled resolution", () => {
  it("restaurant and restaurant + bar default to a kitchen", () => {
    expect(hospitalityKitchenEnabledFromPrefs(prefs("restaurant", undefined))).toBe(true);
    expect(hospitalityKitchenEnabledFromPrefs(prefs("restaurant_bar", undefined))).toBe(true);
  });

  it("bar defaults to NO kitchen (kitchen workflow is not mandatory for a bar)", () => {
    expect(hospitalityKitchenEnabledFromPrefs(prefs("bar", undefined))).toBe(false);
    expect(hospitalityKitchenEnabledFromPrefs(prefs("bar", null))).toBe(false);
  });

  it("an explicit merchant choice always wins over the style default", () => {
    expect(hospitalityKitchenEnabledFromPrefs(prefs("bar", true))).toBe(true);
    expect(hospitalityKitchenEnabledFromPrefs(prefs("restaurant", false))).toBe(false);
    expect(hospitalityKitchenEnabledFromPrefs(prefs("restaurant_bar", false))).toBe(false);
  });

  it("legacy business types keep resolving exactly as before", () => {
    expect(hospitalityKitchenEnabledFromPrefs(prefs(null, undefined, "bar" as never))).toBe(false);
    expect(hospitalityKitchenEnabledFromPrefs(prefs(null, undefined, "restaurant" as never))).toBe(true);
    expect(hospitalityKitchenEnabledFromPrefs(prefs(null, undefined, "restaurant_bar" as never))).toBe(true);
  });

  it("unspecified hospitality style keeps the kitchen on (nothing is hard-disabled)", () => {
    expect(hospitalityKitchenEnabledFromPrefs(prefs(null, undefined))).toBe(true);
  });

  it("non-hospitality shops never report a kitchen", () => {
    expect(hospitalityKitchenEnabledFromPrefs({ businessType: "kiosk_duka", hospitalityKitchenEnabled: true })).toBe(false);
  });

  it("bar-only = bar style with the kitchen off; a bar that turned the kitchen on is not bar-only", () => {
    expect(hospitalityBarOnlyFromPrefs(prefs("bar", undefined))).toBe(true);
    expect(hospitalityBarOnlyFromPrefs(prefs("bar", true))).toBe(false);
    expect(hospitalityBarOnlyFromPrefs(prefs("restaurant", false))).toBe(false);
    expect(hospitalityBarOnlyFromPrefs(prefs("restaurant_bar", undefined))).toBe(false);
  });
});

describe("hospitality navigation follows the style", () => {
  const all = () => true;
  const paths = (o: { kitchenEnabled: boolean; barOnly: boolean }) =>
    visibleHospitalityNavItems({ hasPerm: all, ...o }).map((i) => i.path);

  it("restaurant / restaurant + bar keep Kitchen and Expo", () => {
    expect(paths({ kitchenEnabled: true, barOnly: false })).toEqual(["/floor", "/kitchen", "/expo", "/floor/reservations", "/reports"]);
  });

  it("bar-only drops Expo and shows the bar screen instead of 'Kitchen'", () => {
    const items = visibleHospitalityNavItems({ hasPerm: all, kitchenEnabled: false, barOnly: true });
    expect(items.map((i) => i.path)).not.toContain("/expo");
    expect(items.find((i) => i.path === "/kitchen")?.labelKey).toBe("hospitalityStation_bar");
  });

  it("a bar that switched the kitchen ON gets the full navigation back", () => {
    const items = visibleHospitalityNavItems({ hasPerm: all, kitchenEnabled: true, barOnly: false });
    expect(items.map((i) => i.path)).toContain("/expo");
    expect(items.find((i) => i.path === "/kitchen")?.labelKey).toBe("navKitchen");
  });

  it("permissions still filter everything", () => {
    const items = visibleHospitalityNavItems({ hasPerm: (p) => p === "hospitality.floor", kitchenEnabled: true, barOnly: false });
    expect(items.map((i) => i.path)).toEqual(["/floor", "/floor/reservations"]);
  });
});

describe("onboarding persists the style-derived kitchen default", () => {
  const complete = (style: HospitalityOperatingStyle, existing?: boolean) => {
    usePosStore.setState({
      preferences: {
        ...usePosStore.getState().preferences,
        hospitalityKitchenEnabled: existing,
        hospitalityFloor: undefined,
      },
    });
    usePosStore.getState().completeBusinessOnboarding("hospitality", style);
    return usePosStore.getState().preferences;
  };

  it("bar -> kitchen off, restaurant -> on, restaurant + bar -> on", () => {
    expect(complete("bar").hospitalityKitchenEnabled).toBe(false);
    expect(complete("restaurant").hospitalityKitchenEnabled).toBe(true);
    expect(complete("restaurant_bar").hospitalityKitchenEnabled).toBe(true);
  });

  it("never overrides an explicit earlier choice", () => {
    expect(complete("bar", true).hospitalityKitchenEnabled).toBe(true);
    expect(complete("restaurant", false).hospitalityKitchenEnabled).toBe(false);
  });

  it("stores ONE business type for every style", () => {
    for (const style of ["restaurant", "bar", "restaurant_bar"] as const) {
      const p = complete(style);
      expect(p.businessType).toBe("hospitality");
      expect(p.hospitalityStyle).toBe(style);
    }
  });
});

describe("the style never changes the financial path", () => {
  const FOOD: Product = mk("plate", "Plate of food", "Food", 20_000);
  const BEER: Product = mk("beer", "Beer", "Beer", 5_000);
  function mk(id: string, name: string, category: string, price: number): Product {
    return {
      id,
      name,
      sellingMode: "unit",
      baseUnit: "pcs",
      sellingPricePerUnitUgx: price,
      costPricePerUnitUgx: 2_000,
      stockOnHand: 50,
      minimumStockAlert: 0,
      category,
      sku: "",
      updatedAt: "2026-09-17T08:00:00.000Z",
      version: 1,
    };
  }

  function run(style: HospitalityOperatingStyle) {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "local:owner", role: "owner", displayName: "Owner" },
      products: [FOOD, BEER],
      sales: [],
      auditLogs: [],
      dayCloses: [],
      draftLines: [],
      draftCartDiscountUgx: 0,
      activePendingSaleId: null,
      preferences: {
        ...usePosStore.getState().preferences,
        businessType: "hospitality",
        hospitalityStyle: style,
        hospitalityModeEnabled: true,
        hospitalityKitchenEnabled: style === "bar" ? false : true,
        hospitalityManualKitchenFire: true,
        hospitalityFloor: defaultHospitalityFloor(),
        hospitalityServiceChargePercent: 0,
        hospitalityTaxEnabled: false,
      },
    });
    openTestShift();
    const floor = usePosStore.getState().preferences.hospitalityFloor!;
    expect(usePosStore.getState().openTable({ tableId: floor.tables[0]!.id, guestCount: 2 }).ok).toBe(true);
    expect(usePosStore.getState().addHospitalityDraftLine({ product: FOOD, quantity: 1 }).ok).toBe(true);
    expect(usePosStore.getState().addHospitalityDraftLine({ product: BEER, quantity: 2 }).ok).toBe(true);
    usePosStore.getState().saveTableBill();
    usePosStore.getState().fireTableStationTickets(KITCHEN_FIRE_STATION_TYPES);
    usePosStore.getState().fireTableStationTickets(BAR_FIRE_STATION_TYPES);
    usePosStore.getState().recordTableBillPayment({ method: "cash", amountUgx: 30_000 });
    const res = usePosStore.getState().finalizeTableBill();
    expect(res.ok).toBe(true);
    const done = usePosStore.getState().sales.filter((s) => s.status === "completed" || !s.status);
    return { done, stock: usePosStore.getState().products.map((p) => [p.id, p.stockOnHand]) };
  }

  it.each(["restaurant", "bar", "restaurant_bar"] as const)(
    "%s: food + drinks settle as ONE sale through the same engine, stock deducted once",
    (style) => {
      const { done, stock } = run(style);
      expect(done).toHaveLength(1);
      expect(done[0]!.totalUgx).toBe(30_000);
      expect(done[0]!.lines).toHaveLength(2);
      expect(Object.fromEntries(stock as Array<[string, number]>)).toEqual({ plate: 49, beer: 48 });
    },
  );
});
