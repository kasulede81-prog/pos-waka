/**
 * Switching the business type / hospitality style with live state around.
 *
 * Rules pinned here:
 *  - nothing financial is ever altered (sales, sessions, stock, shift totals),
 *  - live table orders are never deleted — leaving hospitality either needs an explicit choice
 *    (merchant-initiated) or keeps them untouched (cloud-driven),
 *  - the active table cart is detached, with its unsaved lines written back to its own order first,
 *  - an unsaved cart is never silently discarded by opening a table,
 *  - an untouched kitchen default follows the style, an explicit choice is kept,
 *  - the cloud shop row wins over a stale snapshot / a terminal left running.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const net = vi.hoisted(() => ({
  shopRow: null as Record<string, unknown> | null,
  onboarding: null as { complete: boolean; missing: string[] } | null,
  queries: 0,
}));

vi.mock("./supabase", async (orig) => {
  const actual = await orig<typeof import("./supabase")>();
  return {
    ...actual,
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              net.queries += 1;
              return { data: net.shopRow, error: null };
            },
          }),
        }),
      }),
    },
  };
});
vi.mock("./ownerOnboarding", async (orig) => ({
  ...(await orig<typeof import("./ownerOnboarding")>()),
  fetchOwnerOnboardingStatus: async () => net.onboarding,
}));
vi.mock("../offline/shopScope", async (orig) => ({
  ...(await orig<typeof import("../offline/shopScope")>()),
  getActiveShopId: () => "11111111-1111-4111-8111-111111111111",
  isValidShopId: () => true,
}));

import type { Product } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { defaultHospitalityFloor, hospitalityKitchenEnabledFromPrefs } from "./hospitality";
import {
  hydrateLocalShopProfileFromCloud,
  refreshShopProfileFromCloudThrottled,
  resetShopProfileRefreshThrottleForTests,
} from "./businessProfile";
import { permissionCategoriesForBusiness } from "./enterpriseRoles/customRoles";
import { permissionsForRole } from "./permissions";

const STEAK: Product = {
  id: "steak",
  name: "Steak",
  sellingMode: "unit",
  baseUnit: "pcs",
  sellingPricePerUnitUgx: 100_000,
  costPricePerUnitUgx: 30_000,
  stockOnHand: 20,
  minimumStockAlert: 0,
  category: "Food",
  sku: "",
  updatedAt: "2026-09-17T08:00:00.000Z",
  version: 1,
};

function hospitalityShop(prefs: Record<string, unknown> = {}) {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "local:owner", role: "owner", displayName: "Owner" },
    products: [STEAK],
    sales: [],
    stockMovements: [],
    auditLogs: [],
    dayCloses: [],
    draftLines: [],
    draftCartDiscountUgx: 0,
    activePendingSaleId: null,
    preferences: {
      ...usePosStore.getState().preferences,
      businessType: "hospitality",
      hospitalityStyle: "restaurant",
      hospitalityModeEnabled: true,
      hospitalityKitchenEnabled: undefined,
      hospitalityManualKitchenFire: true,
      hospitalityFloor: defaultHospitalityFloor(),
      activeTableSessionId: null,
      onboardingDone: true,
      ...prefs,
    },
  });
  openTestShift();
}

/** Open a table with one Steak saved, plus (optionally) a second Steak added but NOT yet saved. */
function openTableOrder(opts: { unsavedExtraLine?: boolean } = {}) {
  const floor = usePosStore.getState().preferences.hospitalityFloor!;
  const opened = usePosStore.getState().openTable({ tableId: floor.tables[0]!.id, guestCount: 2 });
  expect(opened.ok).toBe(true);
  usePosStore.getState().addHospitalityDraftLine({ product: STEAK, quantity: 1 });
  usePosStore.getState().saveTableBill();
  if (opts.unsavedExtraLine) usePosStore.getState().addHospitalityDraftLine({ product: STEAK, quantity: 1 });
  const st = usePosStore.getState();
  return { sessionId: (opened as { sessionId: string }).sessionId, saleId: st.activePendingSaleId! };
}

const sale = (id: string) => usePosStore.getState().sales.find((s) => s.id === id)!;
const session = (id: string) => usePosStore.getState().preferences.hospitalityFloor!.sessions.find((s) => s.id === id)!;
const kitchen = () => usePosStore.getState().preferences.hospitalityKitchenEnabled;

beforeEach(() => {
  net.shopRow = null;
  net.onboarding = null;
  net.queries = 0;
  resetShopProfileRefreshThrottleForTests();
});

describe("leaving hospitality with the active table cart", () => {
  it("detaches the cart, keeps the order, and writes the unsaved lines back to it first", () => {
    hospitalityShop();
    const { saleId, sessionId } = openTableOrder({ unsavedExtraLine: true });
    expect(usePosStore.getState().draftLines).toHaveLength(1); // merged qty 2 (unsaved)
    expect(usePosStore.getState().draftLines[0]!.quantity).toBe(2);
    expect(sale(saleId).lines[0]!.quantity).toBe(1); // only 1 saved so far

    usePosStore.getState().completeBusinessOnboarding("kiosk_duka");

    const st = usePosStore.getState();
    expect(st.preferences.businessType).toBe("kiosk_duka");
    expect(st.activePendingSaleId).toBeNull();
    expect(st.draftLines).toHaveLength(0);
    expect(st.preferences.activeTableSessionId).toBeNull();
    // the order is intact — and now holds what was on the screen (nothing was lost)
    expect(sale(saleId).status).toBe("pending");
    expect(sale(saleId).lines[0]!.quantity).toBe(2);
    expect(session(sessionId).status).toBe("open");
  });

  it("never alters finished sales or financial totals", () => {
    hospitalityShop();
    const first = openTableOrder();
    usePosStore.getState().recordTableBillPayment({ method: "cash", amountUgx: 100_000 });
    const res = usePosStore.getState().finalizeTableBill();
    expect(res.ok).toBe(true);
    const finished = JSON.stringify(sale(first.saleId));
    const shiftBefore = JSON.stringify((usePosStore.getState().preferences.shifts ?? [])[0]);
    const stockBefore = usePosStore.getState().products[0]!.stockOnHand;
    const movementsBefore = usePosStore.getState().stockMovements.length;

    // (state kept) second live order, then switch
    const floor = usePosStore.getState().preferences.hospitalityFloor!;
    usePosStore.getState().openTable({ tableId: floor.tables[1]!.id, guestCount: 2 });
    usePosStore.getState().addHospitalityDraftLine({ product: STEAK, quantity: 1 });
    usePosStore.getState().saveTableBill();
    const stockMid = usePosStore.getState().products[0]!.stockOnHand;
    usePosStore.getState().completeBusinessOnboarding("boutique");

    expect(JSON.stringify(sale(first.saleId))).toBe(finished);
    expect(usePosStore.getState().products[0]!.stockOnHand).toBe(stockMid);
    expect(stockBefore).toBe(stockMid);
    expect(usePosStore.getState().stockMovements.length).toBe(movementsBefore);
    expect(JSON.stringify((usePosStore.getState().preferences.shifts ?? [])[0])).toBe(shiftBefore);
    expect(usePosStore.getState().sales.filter((s) => s.status === "completed" || !s.status)).toHaveLength(1);
  });

  it("a cart that is NOT bound to a table (retail cart) is left alone", () => {
    hospitalityShop({ businessType: "kiosk_duka", hospitalityModeEnabled: false });
    usePosStore.getState().addHospitalityDraftLine({ product: STEAK, quantity: 1 });
    usePosStore.setState({ draftLines: [{ ...usePosStore.getState().draftLines[0]! }] });
    usePosStore.getState().completeBusinessOnboarding("hospitality", "restaurant");
    expect(usePosStore.getState().draftLines).toHaveLength(1);
  });
});

describe("merchant-initiated change away from hospitality with live orders", () => {
  it("is refused with an explicit reason; nothing changes", () => {
    hospitalityShop();
    const { saleId, sessionId } = openTableOrder();
    const before = { type: usePosStore.getState().preferences.businessType, salesJson: JSON.stringify(sale(saleId)) };
    const r = usePosStore.getState().updateBusinessType("kiosk_duka");
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("businessTypeChangeOpenOrders");
    expect(r.openOrders).toBe(1);
    expect(usePosStore.getState().preferences.businessType).toBe(before.type);
    expect(JSON.stringify(sale(saleId))).toBe(before.salesJson);
    expect(session(sessionId).status).toBe("open");
    expect(usePosStore.getState().activePendingSaleId).toBe(saleId); // cart untouched
  });

  it("proceeds when the merchant explicitly keeps the orders — they stay open and intact", () => {
    hospitalityShop();
    const { saleId, sessionId } = openTableOrder();
    const saleJson = JSON.stringify(sale(saleId));
    const r = usePosStore.getState().updateBusinessType("kiosk_duka", undefined, { keepOpenOrders: true });
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().preferences.businessType).toBe("kiosk_duka");
    expect(JSON.stringify(sale(saleId))).toBe(saleJson);
    expect(sale(saleId).status).toBe("pending");
    expect(session(sessionId).status).toBe("open");
    expect(usePosStore.getState().activePendingSaleId).toBeNull(); // only the binding is cleared
  });

  it("is allowed freely when there are no live orders, and for a style-only change", () => {
    hospitalityShop();
    expect(usePosStore.getState().updateBusinessType("hospitality", "bar").ok).toBe(true);
    openTableOrder();
    expect(usePosStore.getState().updateBusinessType("hospitality", "restaurant_bar").ok).toBe(true); // still hospitality
    expect(usePosStore.getState().updateBusinessType("kiosk_duka").ok).toBe(false);
  });
});

describe("opening a table never silently discards an unsaved cart", () => {
  it("is refused while an unbound cart has lines, allowed once it is cleared", () => {
    hospitalityShop();
    // an unsaved takeaway / carried-over cart
    usePosStore.getState().addHospitalityDraftLine({ product: STEAK, quantity: 1 });
    expect(usePosStore.getState().draftLines).toHaveLength(1);
    const floor = usePosStore.getState().preferences.hospitalityFloor!;
    const r = usePosStore.getState().openTable({ tableId: floor.tables[0]!.id, guestCount: 2 });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("draftCartInProgress");
    expect(usePosStore.getState().draftLines).toHaveLength(1); // still there
    expect(usePosStore.getState().openNamedTab({ tabLabel: "Bar tab" }).errorKey).toBe("draftCartInProgress");
    usePosStore.getState().clearDraft();
    expect(usePosStore.getState().openTable({ tableId: floor.tables[0]!.id, guestCount: 2 }).ok).toBe(true);
  });

  it("does not get in the way of a normal table order", () => {
    hospitalityShop();
    const floor = usePosStore.getState().preferences.hospitalityFloor!;
    expect(usePosStore.getState().openTable({ tableId: floor.tables[0]!.id, guestCount: 2 }).ok).toBe(true);
    usePosStore.getState().addHospitalityDraftLine({ product: STEAK, quantity: 1 });
    usePosStore.getState().saveTableBill();
    usePosStore.getState().clearActiveTableOrder(); // leaving the table detaches it
    expect(usePosStore.getState().openTable({ tableId: floor.tables[1]!.id, guestCount: 2 }).ok).toBe(true);
  });
});

describe("hospitality style changes are reflected", () => {
  it("an untouched kitchen default follows the style (bar -> restaurant -> bar)", () => {
    hospitalityShop({ hospitalityStyle: null, hospitalityKitchenEnabled: undefined });
    usePosStore.getState().completeBusinessOnboarding("hospitality", "bar");
    expect(kitchen()).toBe(false);
    expect(hospitalityKitchenEnabledFromPrefs(usePosStore.getState().preferences)).toBe(false);
    usePosStore.getState().updateBusinessType("hospitality", "restaurant");
    expect(kitchen()).toBe(true);
    expect(hospitalityKitchenEnabledFromPrefs(usePosStore.getState().preferences)).toBe(true);
    usePosStore.getState().updateBusinessType("hospitality", "bar");
    expect(kitchen()).toBe(false);
    usePosStore.getState().updateBusinessType("hospitality", "restaurant_bar");
    expect(kitchen()).toBe(true);
  });

  it("an explicit merchant choice is kept across style changes", () => {
    hospitalityShop({ hospitalityStyle: "restaurant", hospitalityKitchenEnabled: false }); // restaurant that turned the kitchen off
    usePosStore.getState().updateBusinessType("hospitality", "restaurant_bar");
    expect(kitchen()).toBe(false);
    usePosStore.getState().updateBusinessType("hospitality", "bar");
    expect(kitchen()).toBe(false);
    hospitalityShop({ hospitalityStyle: "bar", hospitalityKitchenEnabled: true }); // bar that turned the kitchen on
    usePosStore.getState().updateBusinessType("hospitality", "bar");
    expect(kitchen()).toBe(true);
    usePosStore.getState().updateBusinessType("hospitality", "restaurant");
    expect(kitchen()).toBe(true);
  });

  it("retail -> hospitality derives the kitchen default from the new style", () => {
    hospitalityShop({ businessType: "kiosk_duka", hospitalityStyle: null, hospitalityKitchenEnabled: undefined, hospitalityModeEnabled: false });
    usePosStore.getState().completeBusinessOnboarding("hospitality", "bar");
    expect(usePosStore.getState().preferences.hospitalityModeEnabled).toBe(true);
    expect(kitchen()).toBe(false);
  });
});

describe("the cloud shop row is the authority for the business type", () => {
  const shop = (business_type: string) => ({
    id: "11111111-1111-4111-8111-111111111111",
    organization_id: "o1",
    name: "Kasule's Place",
    business_type,
    phone_e164: null,
  });

  it("applies an admin switch when cloud onboarding is complete (unchanged behaviour)", async () => {
    hospitalityShop({ businessType: "kiosk_duka", hospitalityModeEnabled: false });
    net.shopRow = shop("hospitality");
    net.onboarding = { complete: true, missing: [] };
    await hydrateLocalShopProfileFromCloud();
    expect(usePosStore.getState().preferences.businessType).toBe("hospitality");
  });

  it("applies it even when onboarding status is unavailable, if this device is already onboarded (was ignored)", async () => {
    hospitalityShop({ businessType: "kiosk_duka", hospitalityModeEnabled: false, onboardingDone: true });
    net.shopRow = shop("hospitality");
    net.onboarding = null; // phone-login staff / placeholder e-mail / multi-shop user: RPC gives nothing
    await hydrateLocalShopProfileFromCloud();
    expect(usePosStore.getState().preferences.businessType).toBe("hospitality");
    expect(usePosStore.getState().preferences.hospitalityModeEnabled).toBe(true);
  });

  it("still does not skip the wizard on a device that has not been onboarded", async () => {
    hospitalityShop({ businessType: "kiosk_duka", hospitalityModeEnabled: false, onboardingDone: false });
    net.shopRow = shop("hospitality");
    net.onboarding = { complete: false, missing: ["business_type"] };
    await hydrateLocalShopProfileFromCloud();
    expect(usePosStore.getState().preferences.businessType).toBe("kiosk_duka");
  });

  it("re-applies the cloud type over a stale restored snapshot", async () => {
    hospitalityShop();
    // a snapshot restore brought back the pre-switch type
    usePosStore.setState((st) => ({ preferences: { ...st.preferences, businessType: "kiosk_duka" } }));
    net.shopRow = shop("hospitality");
    net.onboarding = null;
    await hydrateLocalShopProfileFromCloud();
    expect(usePosStore.getState().preferences.businessType).toBe("hospitality");
  });

  it("an admin switch away from hospitality never destroys live orders", async () => {
    hospitalityShop();
    const { saleId, sessionId } = openTableOrder();
    const saleJson = JSON.stringify(sale(saleId));
    net.shopRow = shop("kiosk_duka");
    net.onboarding = null;
    await hydrateLocalShopProfileFromCloud();
    expect(usePosStore.getState().preferences.businessType).toBe("kiosk_duka");
    expect(JSON.stringify(sale(saleId))).toBe(saleJson);
    expect(session(sessionId).status).toBe("open");
    expect(usePosStore.getState().sales.filter((s) => s.status === "completed" || !s.status)).toHaveLength(0);
  });

  it("the resume refresh is throttled (a terminal left open picks the switch up, without hammering the API)", async () => {
    hospitalityShop({ businessType: "kiosk_duka", hospitalityModeEnabled: false });
    net.shopRow = shop("hospitality");
    net.onboarding = null;
    await refreshShopProfileFromCloudThrottled();
    expect(usePosStore.getState().preferences.businessType).toBe("hospitality");
    const q = net.queries;
    await refreshShopProfileFromCloudThrottled();
    await refreshShopProfileFromCloudThrottled();
    expect(net.queries).toBe(q);
  });
});

describe("custom-role permissions follow the existing (least-privilege) architecture", () => {
  it("base roles get hospitality permissions from their role definition", () => {
    expect(permissionsForRole("waiter")).toContain("hospitality.order");
    expect(permissionsForRole("kitchen")).toContain("hospitality.kitchen");
    expect(permissionsForRole("owner")).toContain("hospitality.settle");
  });

  it("the role editor offers the hospitality permission category once the shop is hospitality", () => {
    expect(permissionCategoriesForBusiness("hospitality").map((c) => c.id)).toContain("hospitality");
    expect(permissionCategoriesForBusiness("kiosk_duka").map((c) => c.id)).not.toContain("hospitality");
  });
});
