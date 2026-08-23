import { describe, expect, it } from "vitest";
import type { Sale } from "../types";
import { filterSalesForHomeScope, resolveVisibleHomeMetrics } from "./homeVisibility";
import { authOperatorRole, resolveSessionActor } from "./sessionActor";
import { buildSoldByNameByUserId, resolveSoldByUserId } from "./soldByLabels";
import { summarizeTodaySales } from "./todaySalesSummary";

const OWNER_UUID = "11111111-1111-4111-8111-111111111111";
const CASHIER_UUID = "22222222-2222-4222-8222-222222222222";
const STAFF_JOHN = "33333333-3333-4333-8333-333333333333";
const STAFF_MARY = "44444444-4444-4444-8444-444444444444";

function staffPrefs(activeStaffId: string) {
  return {
    activeStaffId,
    staffAccounts: [
      {
        id: STAFF_JOHN,
        name: "John",
        role: "cashier" as const,
        active: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        linkedAuthUserId: CASHIER_UUID,
      },
    ],
  };
}

function ownerActor(activeStaffId: string | null) {
  return resolveSessionActor({
    mode: "supabase",
    user: { id: OWNER_UUID, email: "owner@waka.invalid" } as never,
    email: "owner@waka.invalid",
    shopMemberRole: "owner",
    preferences: (activeStaffId ? staffPrefs(activeStaffId) : {}) as never,
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

describe("STAFF-V2 Phase 11c read visibility scope", () => {
  it("A — owner only: authRole owner, shop-wide scope", () => {
    const actor = ownerActor(null);
    expect(actor.authRole).toBe("owner");
    expect(resolveVisibleHomeMetrics(authOperatorRole(actor)).scope).toBe("shop_wide");
  });

  it("B — owner + John PIN: operator owner, seller cashier, shop-wide visibility", () => {
    const actor = ownerActor(STAFF_JOHN);
    expect(actor.authRole).toBe("owner");
    expect(actor.role).toBe("cashier");
    const scope = resolveVisibleHomeMetrics(authOperatorRole(actor));
    expect(scope.scope).toBe("shop_wide");
    const sales = [
      sale({ id: "s-john", soldByUserId: `staff:${STAFF_JOHN}` }),
      sale({ id: "s-mary", soldByUserId: `staff:${STAFF_MARY}`, soldByAuthUserId: null }),
    ];
    expect(filterSalesForHomeScope(sales, scope.scope, actor)).toHaveLength(2);
    const personal = summarizeTodaySales(sales, new Date("2026-08-23T12:00:00.000Z"));
    expect(personal.count).toBe(2);
  });

  it("C — John Auth login: personal cashier scope", () => {
    const actor = resolveSessionActor({
      mode: "supabase",
      user: { id: CASHIER_UUID, email: "john@waka.invalid" } as never,
      email: "john@waka.invalid",
      shopMemberRole: "cashier",
      preferences: {} as never,
    });
    expect(actor.authRole).toBe("cashier");
    expect(resolveVisibleHomeMetrics(authOperatorRole(actor)).scope).toBe("personal");
    const sales = [
      sale({ id: "s-john" }),
      sale({ id: "s-mary", soldByUserId: `staff:${STAFF_MARY}`, soldByAuthUserId: null }),
    ];
    const scoped = filterSalesForHomeScope(
      sales,
      resolveVisibleHomeMetrics(authOperatorRole(actor)).scope,
      actor,
    );
    expect(scoped.map((s) => s.id)).toEqual(["s-john"]);
    const today = summarizeTodaySales(sales, new Date("2026-08-23T12:00:00.000Z"), { matchActor: actor });
    expect(today.count).toBe(1);
  });

  it("D — seller labels preserved under owner operator", () => {
    const actor = ownerActor(STAFF_JOHN);
    expect(authOperatorRole(actor)).toBe("owner");
    expect(actor.displayName).toBe("John");
    const map = buildSoldByNameByUserId({
      staffAccounts: staffPrefs(STAFF_JOHN).staffAccounts,
      ownerUserId: OWNER_UUID,
      ownerDisplayName: "Owner",
      shopDisplayName: "Waka Shop",
    });
    expect(resolveSoldByUserId("en", `staff:${STAFF_JOHN}`, map, "Waka Shop")).toBe("John");
    expect(resolveSoldByUserId("en", OWNER_UUID, map, "Waka Shop")).toBe("Owner");
  });

  it("E — legacy PIN: no crash; writer owner; seller unknown on label map", () => {
    const actor = ownerActor(STAFF_JOHN);
    const legacy = { ...actor, linkedAuthUserId: null };
    expect(authOperatorRole(legacy)).toBe("owner");
    expect(resolveVisibleHomeMetrics(authOperatorRole(legacy)).scope).toBe("shop_wide");
    const map = buildSoldByNameByUserId({
      staffAccounts: staffPrefs(STAFF_JOHN).staffAccounts,
      ownerUserId: OWNER_UUID,
      shopDisplayName: "Waka Shop",
    });
    expect(() =>
      resolveSoldByUserId("en", `staff:${STAFF_JOHN}`, map, "Waka Shop"),
    ).not.toThrow();
    expect(resolveSoldByUserId("en", `staff:${STAFF_JOHN}`, map, "Waka Shop")).toBe("John");
  });
});
