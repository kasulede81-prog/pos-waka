import { beforeEach, describe, expect, it } from "vitest";
import type { Sale, SaleLine } from "../types";
import { actorHasPermission, actorHasEffectivePermission } from "./actorAuthorization";
import { completePosUnlock } from "./auth/staffLockScreen";
import { filterSalesForHomeScope, resolveVisibleHomeMetrics } from "./homeVisibility";
import {
  isSharedTerminalLockOperator,
  shouldShowEnterpriseStaffLockScreen,
} from "./lockPos";
import {
  authMembershipRole,
  authOperatorRole,
  resolveSessionActor,
} from "./sessionActor";
import { STAFF_SWITCH_HOLD_LABEL } from "./staffSwitchCartPolicy";
import { checkStorePermission } from "./storeAuthorization";
import { getActiveShopId, setActiveShopId } from "../offline/shopScope";
import { usePosStore } from "../store/usePosStore";

const OWNER_UUID = "11111111-1111-4111-8111-111111111111";
const CASHIER_UUID = "22222222-2222-4222-8222-222222222222";
const MARY_UUID = "55555555-5555-4555-8555-555555555555";
const STAFF_JOHN = "33333333-3333-4333-8333-333333333333";
const STAFF_MARY = "44444444-4444-4444-8444-444444444444";
const SHOP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOCAL_SNAPSHOT = { kind: "local_full" as const };

function staffAccounts() {
  return [
    {
      id: STAFF_JOHN,
      name: "John",
      role: "cashier" as const,
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      linkedAuthUserId: CASHIER_UUID,
    },
    {
      id: STAFF_MARY,
      name: "Mary",
      role: "cashier" as const,
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      linkedAuthUserId: MARY_UUID,
    },
  ];
}

function prefs(activeStaffId: string | null) {
  return {
    activeStaffId,
    staffAccounts: staffAccounts(),
  };
}

function ownerOperating(activeStaffId: string | null) {
  return resolveSessionActor({
    mode: "supabase",
    user: { id: OWNER_UUID, email: "owner@waka.invalid" } as never,
    email: "owner@waka.invalid",
    shopMemberRole: "owner",
    preferences: prefs(activeStaffId) as never,
  });
}

function authCashier() {
  return resolveSessionActor({
    mode: "supabase",
    user: { id: CASHIER_UUID, email: "john@waka.invalid" } as never,
    email: "john@waka.invalid",
    shopMemberRole: "cashier",
    preferences: {} as never,
  });
}

function sale(partial: Partial<Sale>): Sale {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    lines: [],
    totalUgx: 1000,
    subtotalUgx: 1000,
    cashPaidUgx: 1000,
    debtUgx: 0,
    estimatedProfitUgx: 0,
    createdAt: "2026-08-23T10:00:00.000Z",
    status: "completed",
    updatedAt: "2026-08-23T10:00:00.000Z",
    pendingSync: false,
    soldByUserId: `staff:${STAFF_JOHN}`,
    soldByAuthUserId: CASHIER_UUID,
    ...partial,
  };
}

const draftLine: SaleLine = {
  id: "line-1",
  productId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Soap",
  inputMode: "quantity",
  quantity: 1,
  unitPriceUgx: 1000,
  unitCostUgx: 400,
  lineTotalUgx: 1000,
  estimatedProfitUgx: 600,
  updatedAt: "2026-08-23T10:00:00.000Z",
};

function receiptsVisible(actor: ReturnType<typeof ownerOperating>, sales: Sale[]): Sale[] {
  if (authOperatorRole(actor) !== "cashier") return sales;
  return sales.filter((s) => {
    if (s.soldByUserId && s.soldByUserId === actor.userId) return true;
    if (actor.linkedAuthUserId && s.soldByAuthUserId === actor.linkedAuthUserId) return true;
    return false;
  });
}

describe("Path S PIN least-privilege operating context", () => {
  beforeEach(() => {
    usePosStore.getState().resetForSignOut();
    usePosStore.setState({
      _hydrated: true,
      preferences: {
        ...usePosStore.getState().preferences,
        ...prefs(null),
      },
    });
  });

  it("1 — owner operating as owner keeps owner permissions", () => {
    const actor = ownerOperating(null);
    expect(authOperatorRole(actor)).toBe("owner");
    expect(actorHasPermission(actor, "settings.shop")).toBe(true);
    expect(actorHasPermission(actor, "owner.dashboard")).toBe(true);
  });

  it("2–4 — PIN cashier effective role matches display name", () => {
    const actor = ownerOperating(STAFF_JOHN);
    expect(actor.displayName).toBe("John");
    expect(actor.activeStaffId).toBe(STAFF_JOHN);
    expect(authOperatorRole(actor)).toBe("cashier");
    expect(actor.role).toBe("cashier");
    expect(authMembershipRole(actor)).toBe("owner");
  });

  it("3 — PIN switch updates effective permissions immediately", () => {
    expect(actorHasPermission(ownerOperating(null), "settings.shop")).toBe(true);
    expect(actorHasPermission(ownerOperating(STAFF_JOHN), "settings.shop")).toBe(false);
  });

  it("5–6 — cashier home policy after PIN; owner policy unused", () => {
    const cashier = ownerOperating(STAFF_JOHN);
    const owner = ownerOperating(null);
    expect(resolveVisibleHomeMetrics(authOperatorRole(cashier)).scope).toBe("personal");
    expect(resolveVisibleHomeMetrics(authOperatorRole(owner)).scope).toBe("shop_wide");
    const sales = [
      sale({ id: "s-john" }),
      sale({ id: "s-owner", soldByUserId: OWNER_UUID, soldByAuthUserId: OWNER_UUID }),
    ];
    expect(filterSalesForHomeScope(sales, "personal", cashier).map((s) => s.id)).toEqual(["s-john"]);
  });

  it("7–9 — Sales History cashier filter; owner restored on switch-back", () => {
    const sales = [
      sale({ id: "s-john" }),
      sale({ id: "s-owner", soldByUserId: OWNER_UUID, soldByAuthUserId: OWNER_UUID }),
    ];
    expect(receiptsVisible(ownerOperating(STAFF_JOHN), sales).map((s) => s.id)).toEqual(["s-john"]);
    expect(receiptsVisible(ownerOperating(null), sales)).toHaveLength(2);
  });

  it("10–14 — PIN cashier cannot use owner-only client authorization", () => {
    const actor = ownerOperating(STAFF_JOHN);
    expect(actorHasPermission(actor, "settings.shop")).toBe(false);
    expect(actorHasPermission(actor, "settings.devices")).toBe(false);
    expect(actorHasPermission(actor, "reports.view")).toBe(false);
    expect(actorHasEffectivePermission(actor, "settings.shop", LOCAL_SNAPSHOT, "supabase")).toBe(false);
    expect(checkStorePermission(actor, "settings.shop").ok).toBe(false);
    usePosStore.setState({ sessionActor: actor });
    const before = usePosStore.getState().preferences.shopDisplayName;
    usePosStore.getState().setPreferences({ shopDisplayName: "Hijack" });
    expect(usePosStore.getState().preferences.shopDisplayName).toBe(before);
  });

  it("E — dedicated Auth cashier path is unchanged", () => {
    const actor = authCashier();
    expect(actor.authUserId).toBe(CASHIER_UUID);
    expect(authOperatorRole(actor)).toBe("cashier");
    expect(actorHasPermission(actor, "settings.shop")).toBe(false);
    expect(actorHasPermission(actor, "pos.sell")).toBe(true);
  });

  it("15–17 — unsaved owner cart is parked, not completed under cashier", () => {
    const owner = ownerOperating(null);
    usePosStore.setState({
      sessionActor: owner,
      draftLines: [draftLine],
      activePendingSaleId: null,
      sales: [],
    });
    const switched = usePosStore.getState().switchStaffAccount(STAFF_JOHN);
    expect(switched.ok).toBe(true);
    const state = usePosStore.getState();
    expect(state.draftLines).toEqual([]);
    expect(state.activePendingSaleId).toBeNull();
    expect(state.sales).toHaveLength(1);
    expect(state.sales[0]?.status).toBe("pending");
    expect(state.sales[0]?.referenceLabel).toBe(STAFF_SWITCH_HOLD_LABEL);
    expect(state.sales[0]?.soldByUserId).toBe(OWNER_UUID);
    expect(state.sales.filter((s) => s.status === "completed")).toHaveLength(0);
  });

  it("18 — lock/unlock same cashier keeps effective staff id", () => {
    usePosStore.setState({
      preferences: {
        ...usePosStore.getState().preferences,
        ...prefs(STAFF_JOHN),
        posLocked: true,
      },
    });
    expect(completePosUnlock(STAFF_JOHN).ok).toBe(true);
    expect(usePosStore.getState().preferences.activeStaffId).toBe(STAFF_JOHN);
    expect(authOperatorRole(ownerOperating(STAFF_JOHN))).toBe("cashier");
  });

  it("19 — cashier A → cashier B changes seller id", () => {
    usePosStore.setState({
      preferences: { ...usePosStore.getState().preferences, ...prefs(STAFF_JOHN) },
    });
    expect(usePosStore.getState().switchStaffAccount(STAFF_MARY).ok).toBe(true);
    const actor = ownerOperating(usePosStore.getState().preferences.activeStaffId ?? null);
    expect(actor.activeStaffId).toBe(STAFF_MARY);
    expect(actor.displayName).toBe("Mary");
    expect(authOperatorRole(actor)).toBe("cashier");
  });

  it("20 — cashier → owner restores owner permissions", () => {
    usePosStore.setState({
      preferences: { ...usePosStore.getState().preferences, ...prefs(STAFF_JOHN) },
    });
    expect(usePosStore.getState().switchStaffAccount(null).ok).toBe(true);
    const actor = ownerOperating(null);
    expect(authOperatorRole(actor)).toBe("owner");
    expect(actorHasPermission(actor, "settings.shop")).toBe(true);
  });

  it("21–22 — refresh/restart re-resolve from persisted activeStaffId", () => {
    usePosStore.setState({
      preferences: { ...usePosStore.getState().preferences, ...prefs(STAFF_JOHN) },
    });
    const restored = ownerOperating(usePosStore.getState().preferences.activeStaffId ?? null);
    expect(restored.displayName).toBe("John");
    expect(authOperatorRole(restored)).toBe("cashier");
    expect(actorHasPermission(restored, "settings.shop")).toBe(false);
  });

  it("23 — staff switch does not change active shop", () => {
    setActiveShopId(SHOP_A);
    expect(getActiveShopId()).toBe(SHOP_A);
    expect(usePosStore.getState().switchStaffAccount(STAFF_JOHN).ok).toBe(true);
    expect(getActiveShopId()).toBe(SHOP_A);
  });

  it("24 — staff must belong to the active shop directory", () => {
    const missing = usePosStore.getState().switchStaffAccount("00000000-0000-4000-8000-000000000000");
    expect(missing.ok).toBe(false);
    expect(usePosStore.getState().preferences.activeStaffId).toBeNull();
  });

  it("shared terminal lock still works while effective role is cashier", () => {
    const actor = ownerOperating(STAFF_JOHN);
    expect(authOperatorRole(actor)).toBe("cashier");
    expect(
      isSharedTerminalLockOperator({
        authOperatorRole: authMembershipRole(actor),
        hasPathSStaffSession: false,
      }),
    ).toBe(true);
    expect(
      shouldShowEnterpriseStaffLockScreen({
        posLocked: true,
        authOperatorRole: authMembershipRole(actor),
        hasPathSStaffSession: false,
        pathname: "/pos/sell",
        canManageShopSettings: actorHasPermission(actor, "settings.shop"),
      }),
    ).toBe(true);
  });
});
